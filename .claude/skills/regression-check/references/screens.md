# What must work, and what is linked

Read this after `impact.mjs`. Only check the sections it names, plus whatever the links below add.

## Runtime links that imports do not show

- **A trade's save, edit or delete** feeds: trade list, statistics, dashboard (all widgets), trading monitor, account balance and drawdown, daily numbering, day summary e-mail, Standard's limit of 5. Linked accounts copy it to each linked account and count it as one setup.
- **`trade-math.ts` / `computeTradeMetrics()`** changes results everywhere above, plus the trade form's summary strip and backtesting. Parts of a position and breakeven have their own rules.
- **Account fields and balance corrections** feed balance curve, EOD floor, target, risk %, monitor limits.
- **Plans and roles (`shared/plans.ts`, `PLAN_ROUTES`)**: menu locks, `PlanGate` screens, API 403s, billing role changes, the demo's locks.
- **`/me` or user settings**: theme, accent, candle colours, language, currency, time zone, dates on every screen.
- **Time zone or date helpers**: daily numbering, trade date, calendar, session clock, dashboard calendar, digests.
- **`TradingChart`**: analysis, trade form chart (line dragging, by mouse and by finger), calculator PRO (two synced charts), backtesting.
- **`Select`, `DateTimePicker`, `Field`, `Button`, `Panel`**: forms everywhere; test typing, keyboard and phone, not only a click.
- **Sign-up, auth, invites**: activation, invitation code link, terms tick, sign-in lock, 2FA, the first-run introduction.
- **Candles / market data**: analysis, overview, trade chart, calculator PRO, backtesting, live prices, demo rebuild.
- **Calendar / news**: checklist, News's side column, red news mark on trades, week-ahead e-mail, session clock holidays.

## Screens

| Screen | Path | Must work |
|---|---|---|
| Landing | `/` | hero, call to action per `REGISTRATION`, "See the demo", legal links, footer |
| Sign in, sign up, reset | `/logowanie`, `/rejestracja`, `/reset-hasla`, `/nowe-haslo`, `/aktywacja` | sign in, wrong password message, terms tick required, code from `?kod=`, activation |
| Legal | `/regulamin`, `/prywatnosc` | both languages, table, links |
| Dashboard | `/dashboard` | account switcher, period, all widgets, customize, "?" cards, empty state preview |
| Trades | `/transakcje` | add a trade (direction, instrument, account, size presets, ×2, +step, from risk), SL sets direction, TP/SL/BE/other price, close in parts, screenshot paste, signal paste, open a row and edit, delete, filters, CSV, MT5 and Tradovate import preview |
| Trade chart | `/transakcje` | Pro only; timeframes, + Entry / SL / TP, dragging each line writes into the form and back, phones behind "Add from the chart" |
| Statistics | `/statystyki` | filters, charts, balance curve with one account, empty period message |
| Calculator | `/kalkulator` | pair switch, source, converter and swap, level tiles, copy; PRO: candle match, synced charts |
| Analysis | `/analiza` | instrument, all timeframes, indicator switches, live price, levels, sentiment, "not investment advice" warning |
| Backtesting | `/analiza/backtesting` | new session, play, step, back, order with SL/TP, close, summary, finish, resume |
| Strategies | `/strategie` | create, rules add/edit/drag/delete, ticks |
| Calendar | `/kalendarz` | tiles, filters, day/week/month, event details and history |
| News | `/news` | feed, filters, stream, keyword alerts, menu dot |
| Plans | `/plany` | prices per language, month/year, terms tick, Checkout opens (test mode), locked links lead here |
| Settings | `/ustawienia/<section>` | autosave on every row, accounts (add, edit, delete's question, link, correct balance), subscription, 2FA, API keys, e-mails |
| Admin | `/admin/<section>` | users and their actions, statistics, system status, instruments, invitations; admin only |
| Shell | every screen | side menu folding, phone drawer, session clock and panel, theme switch, help card, loss banner |
| Demo | `POST /demo` from the landing | bar on every screen, writes refused with the notice, locked screens show the lock |
| Onboarding | first sign-in | every step saves, skip |
| Unsubscribe | `/wypisz` | signed link works, a tampered one does not |

## Route file to screens

`trades`: Trades, Dashboard, Statistics. `accounts`: Settings, Dashboard, Trades, Statistics. `me`, `auth`: every screen. `billing`: Plans, Settings. `analysis`: Analysis, Trades chart. `basis`: Calculator. `backtest`: Backtesting. `calendar`: Calendar, News, clock. `news`: News, Trades mark. `strategies`: Strategies, Trades, Backtesting, onboarding. `instruments`: every instrument drop-down. `admin`, `invites`: Admin, sign-up. `demo`: Demo. `api-keys`, `bot`: Settings. If a route file is not listed here, find its screens with a search for its path in `apps/web/src/api/hooks.ts`, and add it.
