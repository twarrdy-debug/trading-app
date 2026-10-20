import {
  brokerTimeToUtc,
  computeTradeMetrics,
  decodeReportText,
  isTradovateReport,
  matchBrokerSymbol,
  MAX_PARTS,
  parseMt5Html,
  parseMt5Rows,
  parseTradovateReport,
  type Direction,
  type Mt5ImportFields,
  type Mt5Report,
  type TradePartInput,
  type TradovateTrade,
} from '@trading/shared';
import { and, eq, gte, inArray, isNull, like, lte } from 'drizzle-orm';
import { instruments, trades } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { t } from '../i18n.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { getAccount, linkedAccounts } from './accounts.ts';
import { assertTradeRoom, createTrade, type TradeContext } from './trades.ts';
import { isZip, xlsxRows } from './xlsx.ts';

type Report = { format: 'mt5'; report: Mt5Report } | { format: 'tradovate'; trades: TradovateTrade[] };

/** MT5 account history report (HTML in UTF-16 or Open XML .xlsx) or Tradovate's Position History or Performance CSV. */
function readReport(bytes: Uint8Array): Report {
  try {
    if (isZip(bytes)) return { format: 'mt5', report: parseMt5Rows(xlsxRows(bytes)) };
    const text = decodeReportText(bytes);
    if (isTradovateReport(text)) return { format: 'tradovate', trades: parseTradovateReport(text) };
    if (/<t[dr]\b/i.test(text)) return { format: 'mt5', report: parseMt5Html(text) };
  } catch {
    // A broken archive or unreadable text: reported below as an unsupported file.
  }
  throw badRequest('mt5UnsupportedFile');
}

export type ImportStatus = 'ready' | 'duplicate' | 'similar' | 'unknownSymbol' | 'invalidSize' | 'wrongMarket' | 'imported';

const round2 = (n: number) => Math.round(n * 100) / 100;
/** A trade entered by hand counts as the same one when opened within this time. */
const SIMILAR_MS = 15 * 60_000;

/** One position of the file, the same shape for every platform. */
interface Position {
  externalId: string;
  /** Platform's position number (MT5) or first entry fill (Tradovate). */
  position: string;
  symbol: string;
  direction: Direction;
  volume: number;
  openedAt: string;
  closedAt: string;
  openPrice: number;
  /** Size-weighted when closed in parts. */
  closePrice: number;
  stopLoss: number | null;
  takeProfit: number | null;
  commission: number;
  swap: number;
  profit: number;
  /** Entry fills (more than one: added to the position). */
  entries: number;
  /** Exits at different prices or times become the trade's parts. */
  exits: { size: number; price: number; closedAt: string }[];
}

function mt5Positions(report: Mt5Report, timezone: string): Position[] {
  const prefix = report.account ? `mt5:${report.account}:` : 'mt5:';
  return report.positions.map((p) => {
    const closedAt = brokerTimeToUtc(p.closeTime, timezone).toISOString();
    return {
      externalId: prefix + p.position,
      position: p.position,
      symbol: p.symbol,
      direction: p.direction,
      volume: p.volume,
      openedAt: brokerTimeToUtc(p.openTime, timezone).toISOString(),
      closedAt,
      openPrice: p.openPrice,
      closePrice: p.closePrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      commission: p.commission,
      swap: p.swap,
      profit: p.profit,
      entries: 1,
      exits: [{ size: p.volume, price: p.closePrice, closedAt }],
    };
  });
}

function tradovatePositions(list: TradovateTrade[], timezone: string): Position[] {
  return list.map((tr) => {
    let exits = tr.exits.map((e) => ({ size: e.qty, price: e.price, closedAt: brokerTimeToUtc(e.time, timezone).toISOString() }));
    const closePrice = Math.round((exits.reduce((sum, e) => sum + e.size * e.price, 0) / tr.size) * 1e6) / 1e6;
    const closedAt = exits.at(-1)!.closedAt;
    // More exits than a trade can hold parts: one exit at their average price.
    if (exits.length > MAX_PARTS) exits = [{ size: tr.size, price: closePrice, closedAt }];
    return {
      externalId: `tradovate:${tr.account}:${tr.id}`,
      position: tr.id,
      symbol: tr.contract,
      direction: tr.direction,
      volume: tr.size,
      openedAt: brokerTimeToUtc(tr.openTime, timezone).toISOString(),
      closedAt,
      openPrice: tr.entryPrice,
      closePrice,
      stopLoss: null,
      takeProfit: null,
      // Position History has no commissions.
      commission: 0,
      swap: 0,
      profit: tr.profit,
      entries: tr.entries,
      exits,
    };
  });
}

/**
 * Previews (commit = false) or imports the closed positions of an MT5 report or a Tradovate
 * Position History into the journal. Positions already imported (same account and position) are
 * skipped, so importing an overlapping period twice is safe; trades that look like ones entered by
 * hand are skipped unless `includeSimilar`. Broker symbols are matched to instruments
 * automatically; `symbolMap` covers the rest. MT5 commission and swap become the trade's fees.
 */
export async function importMt5(ctx: TradeContext, user: CurrentUser, bytes: Uint8Array, fields: Mt5ImportFields) {
  const file = readReport(bytes);
  const timezone = fields.timezone ?? (file.format === 'tradovate' ? user.timezone : 'broker-ny7');
  const positions = file.format === 'mt5' ? mt5Positions(file.report, timezone) : tradovatePositions(file.trades, timezone);
  if (positions.length === 0) throw badRequest('mt5NoPositions');
  const platformAccount = file.format === 'mt5' ? file.report.account : file.trades[0]?.account || null;
  const currency = file.format === 'mt5' ? file.report.currency : (file.trades[0]?.currency ?? null);

  const list = await ctx.db.select().from(instruments).where(eq(instruments.active, true));
  const account = await getAccount(ctx.db, user, fields.accountId);
  if (account.type === 'backtest') throw badRequest('backtestAccountTrade');
  const existing = new Set(
    (
      await ctx.db
        .select({ externalId: trades.externalId })
        .from(trades)
        .where(and(eq(trades.userId, user.id), inArray(trades.externalId, positions.map((p) => p.externalId))))
    ).map((r) => r.externalId),
  );
  // Tradovate fill ids are unique across accounts, and the Performance export has no account
  // number: a trade counts as imported when its first fill is, whichever export brought it in.
  const tradovateFills =
    file.format === 'tradovate'
      ? new Set(
          (
            await ctx.db
              .select({ externalId: trades.externalId })
              .from(trades)
              .where(and(eq(trades.userId, user.id), like(trades.externalId, 'tradovate:%')))
          ).map((r) => r.externalId!.split(':').at(-1)),
        )
      : new Set<string>();
  const imported = (externalId: string) => existing.has(externalId) || (file.format === 'tradovate' && tradovateFills.has(externalId.split(':').at(-1)));

  // Trades entered by hand in the file's period, to spot the same trade imported again.
  // A loop, not Math.min(...times): a huge file would overflow the call stack.
  let first = Infinity;
  let last = -Infinity;
  for (const p of positions) {
    const time = Date.parse(p.openedAt);
    first = Math.min(first, time);
    last = Math.max(last, time);
  }
  const manual = await ctx.db
    .select({ instrumentId: trades.instrumentId, direction: trades.direction, openedAt: trades.openedAt })
    .from(trades)
    .where(
      and(
        eq(trades.userId, user.id),
        eq(trades.accountId, account.id),
        isNull(trades.externalId),
        gte(trades.openedAt, new Date(first - SIMILAR_MS)),
        lte(trades.openedAt, new Date(last + SIMILAR_MS)),
      ),
    );

  const rows = positions.map((p) => {
    const mapped = fields.symbolMap[p.symbol];
    const instrument = mapped ? list.find((i) => i.id === mapped) : matchBrokerSymbol(p.symbol, list);
    const similar =
      !!instrument &&
      manual.some((m) => m.instrumentId === instrument.id && m.direction === p.direction && Math.abs(m.openedAt.getTime() - Date.parse(p.openedAt)) <= SIMILAR_MS);
    const status = (imported(p.externalId)
      ? 'duplicate'
      : !instrument
        ? 'unknownSymbol'
        : account?.market && account.market !== instrument.market
          ? 'wrongMarket'
          : instrument.market === 'futures' && !Number.isInteger(p.volume)
            ? 'invalidSize'
            : similar && !fields.includeSimilar
              ? 'similar'
              : 'ready') as ImportStatus;
    const metrics = instrument
      ? computeTradeMetrics(instrument, { direction: p.direction, entryPrice: p.openPrice, exitPrice: p.closePrice, positionSize: p.volume })
      : null;
    const { exits, ...rest } = p;
    return {
      ...rest,
      parts: exits.length,
      instrumentId: instrument?.id ?? null,
      instrumentSymbol: instrument?.symbol ?? null,
      measureUnit: instrument?.measureUnit ?? null,
      resultUnits: metrics?.resultUnits ?? null,
      /** Matches a trade entered by hand (imported only with `includeSimilar`). */
      similar,
      status,
      exits,
    };
  });

  const warnings = new Set<string>();
  if (currency && currency !== user.accountCurrency) {
    warnings.add(t(user.language, 'mt5CurrencyMismatch', { report: currency, account: user.accountCurrency }));
  }

  if (fields.commit) {
    // The Standard plan's limit: the whole import fits, or nothing is saved.
    await assertTradeRoom(ctx.db, user, rows.filter((r) => r.status === 'ready').length);
    for (const row of rows) {
      if (row.status !== 'ready') continue;
      const fees = round2(-(row.commission + row.swap));
      const parts: TradePartInput[] | undefined =
        row.exits.length > 1 ? row.exits.map((e) => ({ size: e.size, result: 'manual', price: e.price, closedAt: e.closedAt })) : undefined;
      const result = await createTrade(
        ctx,
        user,
        {
          instrumentId: row.instrumentId!,
          direction: row.direction,
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          entryPrice: row.openPrice,
          ...(parts ? { parts } : { exitPrice: row.closePrice }),
          stopLoss: row.stopLoss,
          takeProfit: row.takeProfit,
          positionSize: row.volume,
          fees: fees === 0 ? null : fees,
          notes:
            file.format === 'mt5'
              ? t(user.language, 'mt5Note', { position: row.position, profit: row.profit.toFixed(2), currency: currency ?? '' }).trim()
              : t(user.language, 'tradovateNote', { account: platformAccount ? t(user.language, 'tradovateAccount', { account: platformAccount }) : '', entries: row.entries, profit: row.profit.toFixed(2), currency: currency ?? '' }),
          source: 'own',
          emotionKeys: [],
          accountId: account.id,
        },
        { externalId: row.externalId, linked: fields.copyToLinked },
      );
      // Price-side warnings are skipped: in MT5 the stop is often moved past the entry later on.
      if (result.fxWarning) warnings.add(result.fxWarning);
      row.status = 'imported';
    }
  }

  const count = (status: ImportStatus) => rows.filter((r) => r.status === status).length;
  return {
    format: file.format,
    account: platformAccount,
    /** The app account's linked accounts: the dialog asks whether the trades came from a trade copier. */
    linkedAccounts: (await linkedAccounts(ctx.db, user, account)).map((a) => ({ id: a.id, name: a.name })),
    currency,
    timezone,
    positions: rows.map(({ exits: _exits, ...row }) => row),
    summary: {
      total: rows.length,
      ready: count('ready'),
      imported: count('imported'),
      duplicate: count('duplicate'),
      similar: rows.filter((r) => r.similar && r.status !== 'duplicate').length,
      unknownSymbol: count('unknownSymbol'),
      invalidSize: count('invalidSize'),
      wrongMarket: count('wrongMarket'),
    },
    unknownSymbols: [...new Set(rows.filter((r) => r.status === 'unknownSymbol').map((r) => r.symbol))],
    warnings: [...warnings],
  };
}
