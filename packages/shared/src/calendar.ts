import type { EventCategory } from './enums.ts';

// Forex Factory has no event type, so it is derived from the title. Order matters:
// "Unemployment Rate" is labor, not a central bank rate; "HPI" is housing, not inflation.
const RULES: [EventCategory, RegExp][] = [
  ['holiday', /holiday/i],
  ['labor', /employment|unemployment|non-?farm|payroll|jobless|claimant|jolts|job openings|\badp\b|hourly earnings|wage|labou?r/i],
  ['housing', /housing|home|building|construction|\bhpi\b|mortgage|starts|permits/i],
  ['inflation', /\bcpi\b|\bppi\b|\bpce\b|inflation|price index|hicp|\brpi\b/i],
  // Speeches count only when a central banker speaks, not any politician.
  ['central_bank', /rate statement|policy rate|cash rate|interest rate|federal funds|fomc|monetary policy|press conference|minutes|\bmpc\b|\bboj\b|\bboe\b|\becb\b|\bsnb\b|\brba\b|\brbnz\b|\bboc\b|\bfed\b|\bbuba\b|\bgov\b|governor/i],
  ['growth', /\bgdp\b|growth/i],
  ['consumer', /retail|consumer|spending|sales/i],
  ['business', /\bpmi\b|\bism\b|sentiment|confidence|\bzew\b|\bifo\b|tankan|business|manufacturing|empire state|philly|richmond|industrial/i],
  ['energy', /crude|\boil\b|natural gas|api weekly|inventories/i],
  ['trade', /trade balance|current account|import|export/i],
  ['bonds', /auction|bond|\bnote\b|\bbill\b/i],
];

export function categorizeEvent(title: string): EventCategory {
  return RULES.find(([, re]) => re.test(title))?.[0] ?? 'other';
}
