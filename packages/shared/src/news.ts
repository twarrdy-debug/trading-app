import type { AssetClass, NewsCategory } from './enums.ts';

// FinancialJuice headlines come as plain titles ("FinancialJuice: ECB's Kazimir: Rate hike was
// unavoidable."), with no category, currency or importance. Everything below is derived from the
// title, so it works for any headline feed in the same style.

/** A release in the headline: "Spanish CPI YoY Flash Actual 4.9% (Forecast 4.6%, Previous 4.3%)". */
export interface NewsData {
  name: string;
  actual: string;
  forecast: string | null;
  previous: string | null;
  revision: string | null;
}

export interface ParsedNews {
  /** Headline without the feed prefix and the trailing "- Source". */
  title: string;
  /** Who is quoted, from "ECB's Kazimir: …" (the part before the first colon). */
  speaker: string | null;
  /** Outlet named at the end: "… - Guardian". */
  sourceName: string | null;
  data: NewsData | null;
  category: NewsCategory;
  currencies: string[];
  /** Markets the headline is about beyond currencies (gold, oil, stock indices, crypto). */
  assets: AssetClass[];
  /** Paywalled or image-only posts that say nothing in the title (FJElite, charts, probabilities). */
  noise: boolean;
}

const NOISE = [
  /-\s*FJElite$/i,
  /Interest Rate Probabilities$/i,
  /Correlation Matrix$/i,
  /Implied Volatility$/i,
  /^Economic Calendar/i,
];

// Short or ambiguous words (US, EU, NZ, Xi) are matched case-sensitively so "us" or "Lane" in a
// sentence don't count; unambiguous names and acronyms ignore case ("Rba:", "uk base").
const CURRENCY_RULES: [string, RegExp, RegExp][] = [
  ['USD', /\b(US|U\.S\.|USA|US\d\w*)\b/, /\b(american|fed|fomc|powell|treasury|treasuries|white house|trump|bessent|vance|congress|senate|wall street|dollar|dxy|beige book|nfp|nonfarm)\b/i],
  ['EUR', /\b(EU|EZ|Lane)\b/, /\b(euro(zone|pe|pean)?|euro area|ecb|lagarde|german[y]?|french|france|ital(y|ian)|spa(in|nish)|dutch|netherlands|belgi(um|an)|austria[n]?|portug(al|uese)|irish|ireland|greek|greece|finnish|buba|bundesbank|bunds?|merz|macron|meloni|schnabel|nagel|villeroy|kazimir)\b/i],
  ['GBP', /\b(MPC)\b/, /\b(uk|u\.k\.|british|britain|england|boe|bailey|gilts?|reeves|starmer|sterling|pound)\b/i],
  ['JPY', /\b(Kato)\b/, /\b(japan|japanese|boj|ueda|jgbs?|yen|tokyo|katayama|ishiba|takaichi)\b/i],
  ['CAD', /\b(BoC|BOC)\b/, /\b(canada|canadian|macklem|carney|loonie)\b/i],
  ['AUD', /\b(ABS)\b/, /\b(australia[n]?|rba|bullock|aussie)\b/i],
  ['NZD', /\b(NZ|Orr)\b/, /\b(new zealand|rbnz|kiwi)\b/i],
  ['CHF', /\b(Franc)\b/, /\b(swiss|switzerland|snb|schlegel|kof)\b/i],
  ['CNY', /\b(Xi)\b/, /\b(china|chinese|pboc|yuan|renminbi|beijing|hong kong)\b/i],
];

/** Currencies a headline can be tagged with. */
export const NEWS_CURRENCIES = CURRENCY_RULES.map(([c]) => c);

const ASSET_RULES: [AssetClass, RegExp][] = [
  ['metal', /\b(gold|silver|bullion|XAU|XAG|platinum|palladium|precious metals?)\b/i],
  ['energy', /\b(oil|crude|brent|WTI|OPEC\+?|natural gas|LNG|gasoline|refiner(y|ies)|barrels?|Strait of Hormuz)\b/i],
  ['index', /\b(S&P|Nasdaq|Dow|Russell|stocks?|equit(y|ies)|shares|index futures|Nvidia|NVIDIA|Apple|Microsoft|Tesla|Amazon|Meta|Alphabet|Google|AMD|earnings|IPO|DAX|FTSE|Nikkei|Hang Seng)\b/i],
  ['crypto', /\b(bitcoin|BTC|ethereum|ETH|crypto(currenc(y|ies))?|stablecoins?)\b/i],
];

const CENTRAL_BANK = /\b(Fed|FOMC|ECB|BoE|BoJ|BoC|RBA|RBNZ|SNB|PBoC|Buba|Bundesbank|central bank|rate (hike|cut|decision)|interest rate|cash rate|policy rate|monetary policy|Powell|Lagarde|Bailey|Ueda|Macklem|Bullock|Schlegel|Governor|Gov\.)/i;
const GEOPOLITICS = /\b(Iran|Iranian|IRGC|Israel|Israeli|Gaza|Hamas|Hezbollah|Houthi[s]?|Russia[n]?|Ukrain(e|ian)|Kremlin|Putin|Zelensky|NATO|missile[s]?|drone[s]?|military|troops|war|attack(s|ed)?|strike[s]?|ceasefire|sanction[s]?|North Korea|Pyongyang|Red Sea|Hormuz|nuclear)\b/i;
const POLITICS = /\b(tariff[s]?|trade (deal|war|talks)|election[s]?|electoral|parliament|government|shutdown|PM|Prime Minister|President|White House|Congress|Senate|minister|finmin|budget|fiscal|Trump|Starmer|Macron|Merz|Carney|Ishiba|Takaichi|politic(s|al)|lobbying|debt ceiling)\b/i;

const DATA_RE = /^(.*?)\s+Actual\s+(\S+)\s*\(\s*Forecast\s+([^,]*?)\s*,\s*Previous\s+([^,)]*?)\s*(?:,\s*Revis(?:ion|ed)\s+([^)]*?)\s*)?\)/i;
const SOURCE_RE = /\s+-\s+([A-Z][\w.&' ]{1,28})$/;
/** Words that end a headline after a dash without being an outlet. */
const NOT_SOURCES = new Set(['Weakest', 'Strongest']);

const orNull = (v: string | undefined) => {
  const t = v?.trim();
  return !t || t === '-' ? null : t;
};

export function parseNewsTitle(raw: string): ParsedNews {
  let title = raw.replace(/^FinancialJuice:\s*/i, '').replace(/\s+/g, ' ').trim();
  const noise = NOISE.some((re) => re.test(title));

  const match = DATA_RE.exec(title);
  const data: NewsData | null = match
    ? {
        name: match[1]!.trim(),
        actual: match[2]!.trim(),
        forecast: orNull(match[3]),
        previous: orNull(match[4]),
        revision: orNull(match[5]),
      }
    : null;

  let sourceName: string | null = null;
  const source = !data && !noise ? SOURCE_RE.exec(title) : null;
  if (source && !NOT_SOURCES.has(source[1]!.trim())) {
    sourceName = source[1]!.trim();
    title = title.slice(0, source.index).trim();
  }

  const colon = !data ? /^([^:]{2,60}):\s/.exec(title) : null;
  const speaker = colon ? colon[1]!.trim() : null;

  const currencies = CURRENCY_RULES.filter(([, exact, loose]) => exact.test(title) || loose.test(title)).map(([c]) => c);
  const assets = ASSET_RULES.filter(([, re]) => re.test(title)).map(([a]) => a);

  const category: NewsCategory = data
    ? 'data'
    : CENTRAL_BANK.test(title)
      ? 'central_bank'
      : GEOPOLITICS.test(title)
        ? 'geopolitics'
        : POLITICS.test(title)
          ? 'politics'
          : assets.length > 0 || /\b(FX|yields?|bonds?|futures|volatility|VIX)\b/i.test(title)
            ? 'markets'
            : 'other';

  return { title, speaker, sourceName, data, category, currencies, assets, noise };
}

/** "54.918k" → 54918, "4.6%" → 4.6, "-" → null. */
export function parseReleaseValue(value: string | null): number | null {
  if (!value) return null;
  const m = /^([+-]?\d+(?:\.\d+)?)\s*([kmbt%]?)/i.exec(value.replace(/,/g, '').trim());
  if (!m) return null;
  const scale = { k: 1e3, m: 1e6, b: 1e9, t: 1e12 }[m[2]!.toLowerCase() as 'k'] ?? 1;
  return Number(m[1]) * scale;
}

/** Releases where a higher number is bad for the currency. */
const LOWER_IS_BETTER = /unemploy|jobless|claimant|claims|inventor/i;

/**
 * How the actual compares to the forecast (or the previous value without a forecast), from the
 * currency's point of view: `better` when a higher number usually lifts it, except for
 * unemployment-type releases.
 */
export function releaseSurprise(data: NewsData): 'better' | 'worse' | 'inline' | null {
  const actual = parseReleaseValue(data.actual);
  const expected = parseReleaseValue(data.forecast) ?? parseReleaseValue(data.previous);
  if (actual == null || expected == null) return null;
  // Compare at the precision the release is published in (0.3% vs 0.30% is in line).
  if (Math.abs(actual - expected) < 1e-9 * Math.max(1, Math.abs(expected))) return 'inline';
  const higher = actual > expected;
  return higher !== LOWER_IS_BETTER.test(data.name) ? 'better' : 'worse';
}

// --- Relevance to an instrument ---------------------------------------------------------

/** Markets that react to geopolitics without a currency in the headline (safe havens). */
export const GEOPOLITICS_ASSETS: readonly AssetClass[] = ['metal'];

/**
 * Whether a headline concerns an instrument: one of its currencies (the calendar mapping, e.g.
 * XAUUSD → USD), its market (gold ↔ metal headlines, indices ↔ stocks, oil ↔ energy), or, for gold,
 * geopolitics. Forex pairs are covered by their currencies only.
 */
export function newsAffectsInstrument(
  news: { currencies: readonly string[]; assets: readonly AssetClass[]; category: NewsCategory },
  instrument: { currencies: readonly string[]; assetClass: AssetClass },
): boolean {
  if (news.currencies.some((c) => instrument.currencies.includes(c))) return true;
  if (instrument.assetClass === 'forex' || instrument.assetClass === 'other') return false;
  if (news.assets.includes(instrument.assetClass)) return true;
  return news.category === 'geopolitics' && GEOPOLITICS_ASSETS.includes(instrument.assetClass);
}

// --- Matching releases to calendar events ----------------------------------------

const COUNTRY_WORDS =
  /\b(us|u\.s\.|uk|ez|eurozone|euro area|german|germany|french|france|italian|italy|spanish|spain|dutch|swiss|japanese|japan|canadian|canada|australian|australia|nz|new zealand|chinese|china)\b/g;
const STOP_WORDS = new Set(['the', 'of', 'and', 'sa', 'nsa', 'rev', 'final', 'prelim', 'preliminary', 'flash', 'change', 'indicator', 'index', 'rate']);
const PERIODS = ['yoy', 'mom', 'qoq'];

/** Lowercase tokens of an event title with countries, filler words and period spellings normalised. */
export function eventTitleTokens(title: string): string[] {
  const text = title
    .toLowerCase()
    .replace(/\by\/y\b/g, ' yoy ')
    .replace(/\bm\/m\b/g, ' mom ')
    .replace(/\bq\/q\b/g, ' qoq ')
    .replace(/\b10-y\b|\b10 yr\b/g, ' 10y ')
    .replace(COUNTRY_WORDS, ' ')
    .replace(/[^a-z0-9 ]+/g, ' ');
  return [...new Set(text.split(/\s+/).filter((w) => w && !STOP_WORDS.has(w)))];
}

/**
 * How well a released value's name ("Spanish CPI YoY Flash") fits a calendar title
 * ("Spanish Flash CPI y/y"), 0..1 (1 for the same words). Different periods (y/y vs m/m) never match.
 */
export function eventTitleScore(release: string, event: string): number {
  const a = eventTitleTokens(release);
  const b = eventTitleTokens(event);
  const periodA = a.filter((w) => PERIODS.includes(w));
  const periodB = b.filter((w) => PERIODS.includes(w));
  if (periodA.length && periodB.length && !periodA.some((p) => periodB.includes(p))) return 0;
  const wordsA = a.filter((w) => !PERIODS.includes(w));
  const wordsB = b.filter((w) => !PERIODS.includes(w));
  if (!wordsA.length || !wordsB.length) return 0;
  const shared = wordsA.filter((w) => wordsB.includes(w)).length;
  // Mostly the overlap of the shorter title; the Jaccard part prefers "CPI m/m" over
  // "Core CPI m/m" for "US CPI MoM".
  const overlap = shared / Math.min(wordsA.length, wordsB.length);
  const jaccard = shared / (wordsA.length + wordsB.length - shared);
  return 0.9 * overlap + 0.1 * jaccard;
}

/** Same number once units and trailing zeros are ignored ("56.1k" vs "56K" is not, "4.60%" vs "4.6%" is). */
export function sameReleaseValue(a: string | null, b: string | null): boolean {
  const x = parseReleaseValue(a);
  const y = parseReleaseValue(b);
  return x != null && y != null && Math.abs(x - y) <= 1e-9 * Math.max(1, Math.abs(x));
}

// --- Keyword alerts ------------------------------------------------------------------

const escapeRe = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** The user's keywords found in a headline (case-insensitive, from the start of a word). */
export function matchKeywords(title: string, keywords: readonly string[]): string[] {
  return keywords.filter((k) => k.trim() && new RegExp(`(^|[^\\p{L}\\p{N}])${escapeRe(k.trim())}`, 'iu').test(title));
}
