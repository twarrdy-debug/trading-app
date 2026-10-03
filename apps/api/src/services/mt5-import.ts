import {
  brokerTimeToUtc,
  computeTradeMetrics,
  decodeReportText,
  matchBrokerSymbol,
  parseMt5Html,
  parseMt5Rows,
  type Mt5ImportFields,
  type Mt5Report,
} from '@trading/shared';
import { and, eq, inArray } from 'drizzle-orm';
import { instruments, trades } from '../db/schema.ts';
import { badRequest } from '../errors.ts';
import { t } from '../i18n.ts';
import type { CurrentUser } from '../plugins/current-user.ts';
import { getAccount } from './accounts.ts';
import { createTrade, type TradeContext } from './trades.ts';
import { isZip, xlsxRows } from './xlsx.ts';

/** MT5 account history report, as HTML (UTF-16) or Open XML (.xlsx). */
function readReport(bytes: Uint8Array): Mt5Report {
  try {
    if (isZip(bytes)) return parseMt5Rows(xlsxRows(bytes));
    const text = decodeReportText(bytes);
    if (/<t[dr]\b/i.test(text)) return parseMt5Html(text);
  } catch {
    // A broken archive or unreadable text: reported below as an unsupported file.
  }
  throw badRequest('mt5UnsupportedFile');
}

export type ImportStatus = 'ready' | 'duplicate' | 'unknownSymbol' | 'invalidSize' | 'wrongMarket' | 'imported';

const round2 = (n: number) => Math.round(n * 100) / 100;

/**
 * Previews (commit = false) or imports the closed positions of an MT5 report into the journal.
 * Positions already imported (same account and position number) are skipped, so importing an
 * overlapping period twice is safe. Broker symbols are matched to instruments automatically;
 * `symbolMap` covers the rest. Commission and swap become the trade's fees.
 */
export async function importMt5(ctx: TradeContext, user: CurrentUser, bytes: Uint8Array, fields: Mt5ImportFields) {
  const report = readReport(bytes);
  if (report.positions.length === 0) throw badRequest('mt5NoPositions');

  const list = await ctx.db.select().from(instruments).where(eq(instruments.active, true));
  const account = fields.accountId ? await getAccount(ctx.db, user, fields.accountId) : null;
  const prefix = report.account ? `mt5:${report.account}:` : 'mt5:';
  const externalIds = report.positions.map((p) => prefix + p.position);
  const existing = new Set(
    (
      await ctx.db
        .select({ externalId: trades.externalId })
        .from(trades)
        .where(and(eq(trades.userId, user.id), inArray(trades.externalId, externalIds)))
    ).map((r) => r.externalId),
  );

  const rows = report.positions.map((p) => {
    const externalId = prefix + p.position;
    const mapped = fields.symbolMap[p.symbol];
    const instrument = mapped ? list.find((i) => i.id === mapped) : matchBrokerSymbol(p.symbol, list);
    const status = (existing.has(externalId)
      ? 'duplicate'
      : !instrument
        ? 'unknownSymbol'
        : account?.market && account.market !== instrument.market
          ? 'wrongMarket'
          : instrument.market === 'futures' && !Number.isInteger(p.volume)
            ? 'invalidSize'
            : 'ready') as ImportStatus;
    const metrics = instrument
      ? computeTradeMetrics(instrument, { direction: p.direction, entryPrice: p.openPrice, exitPrice: p.closePrice, positionSize: p.volume })
      : null;
    return {
      externalId,
      position: p.position,
      symbol: p.symbol,
      instrumentId: instrument?.id ?? null,
      instrumentSymbol: instrument?.symbol ?? null,
      measureUnit: instrument?.measureUnit ?? null,
      direction: p.direction,
      volume: p.volume,
      openedAt: brokerTimeToUtc(p.openTime, fields.timezone).toISOString(),
      closedAt: brokerTimeToUtc(p.closeTime, fields.timezone).toISOString(),
      openPrice: p.openPrice,
      closePrice: p.closePrice,
      stopLoss: p.stopLoss,
      takeProfit: p.takeProfit,
      commission: p.commission,
      swap: p.swap,
      profit: p.profit,
      resultUnits: metrics?.resultUnits ?? null,
      status,
    };
  });

  const warnings = new Set<string>();
  if (report.currency && report.currency !== user.accountCurrency) {
    warnings.add(t(user.language, 'mt5CurrencyMismatch', { report: report.currency, account: user.accountCurrency }));
  }

  if (fields.commit) {
    for (const row of rows) {
      if (row.status !== 'ready') continue;
      const fees = round2(-(row.commission + row.swap));
      const result = await createTrade(
        ctx,
        user,
        {
          instrumentId: row.instrumentId!,
          direction: row.direction,
          openedAt: row.openedAt,
          closedAt: row.closedAt,
          entryPrice: row.openPrice,
          exitPrice: row.closePrice,
          stopLoss: row.stopLoss,
          takeProfit: row.takeProfit,
          positionSize: row.volume,
          fees: fees === 0 ? null : fees,
          notes: t(user.language, 'mt5Note', {
            position: row.position,
            profit: row.profit.toFixed(2),
            currency: report.currency ?? '',
          }).trim(),
          source: 'own',
          emotionKeys: [],
          accountId: account?.id ?? null,
        },
        { externalId: row.externalId },
      );
      // Price-side warnings are skipped: in MT5 the stop is often moved past the entry later on.
      if (result.fxWarning) warnings.add(result.fxWarning);
      row.status = 'imported';
    }
  }

  const count = (status: ImportStatus) => rows.filter((r) => r.status === status).length;
  return {
    account: report.account,
    currency: report.currency,
    timezone: fields.timezone,
    positions: rows,
    summary: {
      total: rows.length,
      ready: count('ready'),
      imported: count('imported'),
      duplicate: count('duplicate'),
      unknownSymbol: count('unknownSymbol'),
      invalidSize: count('invalidSize'),
      wrongMarket: count('wrongMarket'),
    },
    unknownSymbols: [...new Set(rows.filter((r) => r.status === 'unknownSymbol').map((r) => r.symbol))],
    warnings: [...warnings],
  };
}
