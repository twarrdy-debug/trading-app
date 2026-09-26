import { AUTO_FX_CURRENCIES } from '@trading/shared';
import { and, eq } from 'drizzle-orm';
import type { DB } from '../db/client.ts';
import { fxRates } from '../db/schema.ts';

export interface FxQuote {
  rate: number;
  /** ECB publication day; earlier than requested on weekends and holidays. */
  rateDate: string;
}

export interface FxProvider {
  fetchRate(date: string, base: string, quote: string): Promise<FxQuote>;
}

/** Daily ECB reference rates via Frankfurter (free, no API key). */
export const frankfurterProvider: FxProvider = {
  async fetchRate(date, base, quote) {
    const res = await fetch(`https://api.frankfurter.dev/v1/${date}?base=${base}&symbols=${quote}`, {
      signal: AbortSignal.timeout(5_000),
    });
    if (!res.ok) throw new Error(`Frankfurter ${res.status}`);
    const body = (await res.json()) as { date: string; rates: Record<string, number> };
    const rate = body.rates[quote];
    if (rate == null) throw new Error(`Frankfurter: no ${base}/${quote} rate`);
    return { rate, rateDate: body.date };
  },
};

const isAuto = (currency: string) => (AUTO_FX_CURRENCIES as readonly string[]).includes(currency);

export const supportsAutoRate = (base: string, quote: string) => base === quote || (isAuto(base) && isAuto(quote));

/**
 * Rate converting `base` into `quote` on `date` (YYYY-MM-DD), or null when it is unavailable
 * (unsupported currency or the provider is down). Past days are cached in `fx_rates`;
 * today's rate is fetched each time because the ECB publishes it only in the afternoon.
 */
export async function getFxRate(db: DB, provider: FxProvider, base: string, quote: string, date: string): Promise<FxQuote | null> {
  if (base === quote) return { rate: 1, rateDate: date };
  if (!supportsAutoRate(base, quote)) return null;

  const [cached] = await db
    .select()
    .from(fxRates)
    .where(and(eq(fxRates.date, date), eq(fxRates.base, base), eq(fxRates.quote, quote)));
  if (cached) return { rate: cached.rate, rateDate: cached.rateDate };

  let fetched: FxQuote;
  try {
    fetched = await provider.fetchRate(date, base, quote);
  } catch {
    return null;
  }
  const today = new Date().toISOString().slice(0, 10);
  if (date < today) {
    await db
      .insert(fxRates)
      .values({ date, base, quote, rate: fetched.rate, rateDate: fetched.rateDate })
      .onConflictDoNothing();
  }
  return fetched;
}
