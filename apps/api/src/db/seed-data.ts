import { DEFAULT_EMOTIONS, ROLE_KEYS, ROLE_NAMES, type CreateInstrumentInput } from '@trading/shared';
import { eq, sql } from 'drizzle-orm';
import type { DB } from './client.ts';
import { emotions, instrumentCurrencies, instruments, roles, users } from './schema.ts';

/**
 * Default instruments.
 * CFD: 1 lot of XAUUSD = 100 oz (1 pip = 0.10 move = 10 USD). Index CFDs use points with
 * 1 USD per point per lot, which differs between brokers; admins can adjust via the API.
 * Futures: CME E-mini and Micro contracts, continuous symbols as on TradingView (NQ1!).
 */
const cfd = (symbol: string, name: string, extra: Partial<CreateInstrumentInput>): CreateInstrumentInput => ({
  symbol,
  name,
  market: 'cfd',
  assetClass: 'index',
  measureUnit: 'point',
  unitSize: 1,
  unitValue: 1,
  quoteCurrency: 'USD',
  currencies: ['USD'],
  ...extra,
});

/**
 * Forex major: 1 lot = 100 000 units of the base currency, 1 pip = 0.0001 (0.01 for JPY pairs), so a
 * pip is worth 10 units of the quote currency per lot (1000 JPY). Both currencies move it in the
 * calendar and the news.
 */
const forex = (symbol: string, name: string): CreateInstrumentInput => {
  const base = symbol.slice(0, 3);
  const quote = symbol.slice(3);
  const pip = quote === 'JPY' ? 0.01 : 0.0001;
  return cfd(symbol, name, {
    assetClass: 'forex',
    measureUnit: 'pip',
    unitSize: pip,
    unitValue: Math.round(pip * 100_000),
    quoteCurrency: quote,
    currencies: [base, quote],
  });
};

// Gold futures count in pips like XAUUSD (their 0.10 tick is the gold pip); the others in ticks.
const future = (symbol: string, name: string, assetClass: 'index' | 'metal' | 'crypto', unitSize: number, unitValue: number): CreateInstrumentInput => ({
  symbol,
  name,
  market: 'futures',
  assetClass,
  measureUnit: assetClass === 'metal' ? 'pip' : 'tick',
  unitSize,
  unitValue,
  quoteCurrency: 'USD',
  currencies: ['USD'],
});

export const DEFAULT_INSTRUMENTS: CreateInstrumentInput[] = [
  cfd('XAUUSD', 'Gold / USD', { assetClass: 'metal', measureUnit: 'pip', unitSize: 0.1, unitValue: 10 }),
  cfd('US100', 'Nasdaq 100 CFD', {}),
  cfd('US30', 'Dow Jones 30 CFD', {}),
  cfd('US500', 'S&P 500 CFD', {}),
  future('NQ1', 'Nasdaq 100 E-mini', 'index', 0.25, 5),
  future('MNQ1', 'Nasdaq 100 Micro', 'index', 0.25, 0.5),
  future('ES1', 'S&P 500 E-mini', 'index', 0.25, 12.5),
  future('MES1', 'S&P 500 Micro', 'index', 0.25, 1.25),
  future('YM1', 'Dow Jones E-mini', 'index', 1, 5),
  future('MYM1', 'Dow Jones Micro', 'index', 1, 0.5),
  future('GC1', 'Gold (COMEX)', 'metal', 0.1, 10),
  future('MGC1', 'Gold Micro (COMEX)', 'metal', 0.1, 1),
  forex('EURUSD', 'Euro / US Dollar'),
  forex('GBPUSD', 'British Pound / US Dollar'),
  forex('USDJPY', 'US Dollar / Japanese Yen'),
  forex('USDCHF', 'US Dollar / Swiss Franc'),
  forex('AUDUSD', 'Australian Dollar / US Dollar'),
  forex('USDCAD', 'US Dollar / Canadian Dollar'),
  forex('NZDUSD', 'New Zealand Dollar / US Dollar'),
  // Crypto CFDs: 1 lot = 1 coin, so a 1 USD move is 1 USD per lot (brokers differ; admins can adjust).
  cfd('BTCUSD', 'Bitcoin / USD CFD', { assetClass: 'crypto' }),
  cfd('ETHUSD', 'Ethereum / USD CFD', { assetClass: 'crypto' }),
  // CME: bitcoin 5 BTC with a 5 USD tick (25 USD), micro 0.1 BTC (0.50 USD); ether 50 ETH with a
  // 0.50 tick (25 USD), micro 0.1 ETH (0.05 USD).
  future('BTC1', 'Bitcoin (CME)', 'crypto', 5, 25),
  future('MBT1', 'Bitcoin Micro (CME)', 'crypto', 5, 0.5),
  future('ETH1', 'Ether (CME)', 'crypto', 0.5, 25),
  future('MET1', 'Ether Micro (CME)', 'crypto', 0.5, 0.05),
  // Exchange perpetuals (Binance, Bybit, OKX…): sized in coins, 1 USD per coin per 1 USD move.
  // Settled in USDT, counted as USD.
  { ...cfd('BTCUSDT', 'Bitcoin perpetual (USDT)', { assetClass: 'crypto' }), market: 'crypto' },
  { ...cfd('ETHUSDT', 'Ethereum perpetual (USDT)', { assetClass: 'crypto' }), market: 'crypto' },
];

const RENAMED_INSTRUMENTS = [
  ['Złoto / USD', 'Gold / USD'],
  ['Złoto (COMEX)', 'Gold (COMEX)'],
  ['Złoto Micro (COMEX)', 'Gold Micro (COMEX)'],
] as const;

/** Idempotent: safe to run on every start. */
export async function seed(db: DB, adminEmail: string) {
  await db
    .insert(roles)
    .values(ROLE_KEYS.map((key) => ({ key, name: ROLE_NAMES[key] })))
    .onConflictDoUpdate({ target: roles.key, set: { name: sql`excluded.name` } });

  await db
    .insert(emotions)
    .values(DEFAULT_EMOTIONS.map((e, i) => ({ key: e.key, label: e.label, sortOrder: i })))
    .onConflictDoUpdate({
      target: emotions.key,
      set: { label: sql`excluded.label`, sortOrder: sql`excluded.sort_order` },
    });

  for (const { currencies, ...instrument } of DEFAULT_INSTRUMENTS) {
    const [row] = await db
      .insert(instruments)
      .values(instrument)
      .onConflictDoNothing({ target: instruments.symbol })
      .returning({ id: instruments.id });
    if (row && currencies.length > 0) {
      await db.insert(instrumentCurrencies).values(currencies.map((currency) => ({ instrumentId: row.id, currency })));
    }
  }

  // Instrument names are shown in every language, so the seeded ones are in English.
  for (const [from, to] of RENAMED_INSTRUMENTS) {
    await db.update(instruments).set({ name: to }).where(eq(instruments.name, from));
  }

  // The first admin, only while there is none: after its address is changed (user:login --email),
  // a restart must not create another one.
  const [admin] = await db.select({ id: users.id }).from(users).where(eq(users.role, 'admin')).limit(1);
  if (!admin) {
    await db
      .insert(users)
      .values({ email: adminEmail, displayName: 'Administrator', role: 'admin' })
      .onConflictDoNothing({ target: users.email });
  }
}
