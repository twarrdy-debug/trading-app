# CLAUDE.md

Web app for day traders: a trading journal, daily instrument analysis, an economic calendar and signals from educators. The web client comes first. A mobile app (Expo/React Native) will later use the same API. The owner communicates in Polish, and all user-facing strings (API error messages, labels) are in Polish.

## Working agreement

- Work in stages and show the result after each one before moving on. Order: 1) data model + API skeleton (done, extended with CFD/futures, spreads and FX), 2) visual direction (done: Chmura), 3) journal + stats UI (done), 4) daily analysis + swing/equal high-low detection from OHLC, 5) economic calendar (done early), later: accounts, e-mail, push.
- The frontend must look distinctive, not like a generic AI-generated app. Ask the owner before deciding how tiles and buttons look. The chosen style is **Chmura** ("cloud", chosen 2026-09-27 to replace the heavier "A · Awionika" HUD look): white cards with a soft shadow on a cool grey ground (`card` utility), generous radii, sentence-case labels with no letter-spacing, pill toggles and nav, soft-tinted BUY/SELL and long/short badges, Manrope for UI text and DM Mono for numbers, default accent #FFB020. The mockups are at https://claude.ai/artifact/LFP9zYDRzM8Eyin1CP4voN (board 4). On the light theme the accent is darkened into `--accent-ink` wherever it is a line or text. Keep every visual decision in design tokens (CSS variables) and shared components so the look can be swapped later. There will be dark and light themes, and the user picks one accent color. Buy/long is green and sell/short is red.

## Layout

npm workspaces monorepo:

- `packages/shared`: code shared by the API, web and mobile clients. It holds enums, Zod request schemas (`schemas.ts`), pip/tick/R math (`trade-math.ts`), the signal text parser (`signal-parser.ts`) and date helpers. It is consumed as TypeScript source with no build step.
- `apps/api`: Fastify 5 + `fastify-type-provider-zod` + Drizzle ORM on PostgreSQL.
  - `src/db/schema.ts`: all tables. Migrations are in `apps/api/drizzle/`.
  - `src/routes/*`: HTTP routes. Business logic lives in `src/services/` (the trade logic is in `services/trades.ts`).
  - `src/plugins/current-user.ts`: resolves `req.user`, plus the `requireRole()` helper.
- `apps/api/src/types.ts`: JSON response types for clients (`import type { Trade } from '@trading/api/types'`). They are derived from the service return types, so an API change surfaces as a type error in the web app. The Fastify decorations live in `src/fastify-context.ts` so this import doesn't pull in the whole app.
- `apps/api/src/i18n.ts`: API messages in Polish and English (see Language below).
- `apps/web`: React 19 + Vite + TanStack Query/Router + Tailwind v4.
  - `src/styles.css`: **all design tokens** (colors per theme, fonts, radii, shadows) as CSS variables mapped into Tailwind (`bg-panel`, `text-dim`, `bg-accent`, `text-accent-ink`…). `--accent` and `--on-accent` are set at runtime from the user's settings (`lib/theme.ts`), and index.html applies the last used theme before the first paint.
  - `src/components/ui/`: Button, Panel, Field/Input/Textarea/Segmented/`toggleClass`, Select (themed list), Stat/Gauge/Segments. Screens use only these components and tokens, never raw colors, so the look can be swapped in one place.
  - `src/components/charts/`: EquityChart (d3-scale/d3-shape SVG with crosshair tooltip) and BarList (HTML bars that double as the table view).
  - `src/features/*`: the screens (journal, stats, calculator, calendar, settings, account). `src/api/hooks.ts` holds all React Query hooks. `src/i18n/` holds the UI strings.
  - In development Vite proxies `/api/*` (prefix stripped) and `/files/*` to the API on port 3001.
- `apps/mobile` comes in a later stage.

## Commands

```sh
npm install
npm run dev            # API (http://127.0.0.1:3001, docs at /docs) + web app (http://localhost:5173)
npm run dev:api        # API only
npm run dev:lan        # same as dev, but the web app is also reachable from other devices on the network (no login yet!)
npm test               # vitest: shared unit tests + API integration tests (in-memory DB)
npm run typecheck
npm run build          # production build of the web app
npm run db:generate    # after editing schema.ts: create a new SQL migration
npm run user:login -- --user <e-mail> [--email <new>] --password '<password>'   # give an existing user a login
```

In development the server applies migrations and seeds (roles, emotions, instruments, admin user) on startup, and both steps are idempotent. `npm run db:migrate` and `npm run db:seed` do the same without starting the server.

## Database

- `DATABASE_URL` set to `postgres://…` uses a real Postgres server through postgres.js. Any other value is a PGlite data directory: embedded Postgres in WASM, with no Docker or install needed. The default is `apps/api/.data/pglite`, and `memory://` is used in tests. Docker is not installed on this machine, so development runs on PGlite.
- Only one process can open a PGlite directory, so stop the dev server before running `db:migrate` or `db:seed`.
- Never edit an applied migration. Change `schema.ts` and run `npm run db:generate`. The running dev server (tsx watch) can apply a freshly generated migration right away, so never plan to edit a generated migration afterwards: when data has to be moved, first add it as its own migration (`npx drizzle-kit generate --custom`) and stop the dev server while generating.
- Numeric columns use `mode: 'number'`, so prices and money come back as JS numbers.

## Domain rules

- **Markets:** the app supports CFD and futures (E-mini and Micro). An instrument has `market` (cfd: sized in lots, futures: in contracts), `measureUnit` (pip for forex/metals, point for CFD indices, tick for futures), `unitSize` (the price move of one unit) and `unitValue` (quote-currency value per unit per lot or contract). The defaults are in `src/db/seed-data.ts`, for example XAUUSD pip 0.1 = $10/lot, US100/US30/US500 point = $1/lot (this varies by broker), NQ1 tick 0.25 = $5 and MNQ1 = $0.50. Signal symbols are normalized through aliases (`normalizeSymbol`: NAS100 → US100, NQ1! → NQ1…).
- **Derived trade columns** (`resultUnits`, `pnlQuote`, `pnlAccount`, `riskUnits`, `rMultiple`, `plannedRR`, `tradeDate`) are always recomputed by `computeTradeMetrics()` on create and update. Never write them directly.
- **Account currency** is set per user. `fxRate` (quote → account) is 1 for the same currency. For EUR/USD/GBP/PLN it is fetched automatically: the ECB rate from the day the trade closed, via Frankfurter (`services/fx.ts`), with past days cached in `fx_rates`. Other currencies need a manual rate, and until one is entered `pnlAccount` stays null and the API returns a warning. `fxRateSource` is `manual` or `auto`. A manual rate survives edits, and sending `fxRate: null` switches back to automatic. Tests inject a fake `FxProvider` through `buildApp({ fx })`, so they never call the network.
- **Daily spreads (CFD):** `daily_spreads` stores the spread per user × instrument × day. Before the first trade of a day, the client calls `GET /spreads/:instrumentId/:date`. If `askUser` is true, it asks for the spread, pre-filled with `suggestion` (the latest earlier day), and saves it with `PUT`. A trade copies that day's spread into `spreadUnits` and computes `spreadCost`. This is informational only: fill prices already include the spread, so P&L isn't reduced.
- **Daily numbering** ("2/26.09.2025 – SHORT") counts all of the user's trades on that local day in the user's time zone, across instruments, ordered by `openedAt`. It is computed with a window function (`selectNumbered`), never stored, and it doesn't change when the list is filtered. `maxTradesPerDay` flags overtrading (`overDailyLimit`).
- **Emotions** are a fixed seeded list (`DEFAULT_EMOTIONS`), and a trade can have several.
- **Signals** have 1..n take-profit levels (TP1, TP2…). Signals with prices on the wrong side are rejected, while trades only get warnings. A trade linked to a signal gets `source = educator` and inherits the signal's educator.
- **Roles:** admin, educator, user, vip. Permissions per role are still to be designed. For now only publishing signals (educator/admin) and managing instruments or educators (admin) are restricted.
- **CFD ↔ futures calculator** (web `/kalkulator`, logic in `packages/shared/src/instruments.ts`): **the UI covers only XAUUSD ↔ GC1** (the owner's choice), with a single-price converter and IN/SL/TP1/TP2 levels. The shared helpers and basis measurements still support all pairs in `CFD_FUTURES_PAIRS` (US100↔NQ1/MNQ1, US500↔ES1/MES1, US30↔YM1/MYM1, XAUUSD↔GC1/MGC1). The difference between the markets comes from server measurements ("Auto"), from two current prices, converted by point difference (`offset`) or price ratio (`ratio`), or from a point offset the user types. Futures prices are rounded to the tick, and risk and reward per contract come from the instruments' `unitSize`/`unitValue`. `services/basis.ts` fetches the reference price (Yahoo ^NDX/^GSPC/^DJI, spot gold from gold-api.com) and the futures (Yahoo NQ=F/ES=F/YM=F/GC=F) every `BASIS_INTERVAL_HOURS` (default 4, 0 = off) and on `POST /basis/refresh`, into `basis_snapshots`. A snapshot is `live` only when both quotes are fresh and within 20 minutes of each other. Alerts compare the last two live snapshots against `alertPoints` per pair (gold 2, US100 10, US500 3, US30 30). These sources are unofficial: fine for personal use, but they must be replaced by a licensed feed before other users rely on them. Tests inject a fake `QuoteProvider` through `buildApp({ quotes })`.
- **Position size:** CFD lots can be fractional (the form offers 0.01 / 0.1 / 0.5 / 1, ×2 and a step button). Futures must be whole contracts, which the API enforces. The journal form has no fees field, but the API still accepts `fees`.
- **Trading monitor** (`GET /trades/monitor`, `tradingMonitor()`): per trading account (`groups`, plus a group for trades without an account when there are some today, or no accounts at all), today's trades against `maxTradesPerDay` and today's losses counted as described under "Losses warning"; the limits from the settings apply to each account separately. One selected account gets the full monitor, "all accounts" a compact row per account. When any group reaches the threshold the web app shows a page-wide banner naming the accounts. Dismissing it is stored per set of `alertKey`s, so the banner returns after the next loss.
- **Economic calendar** (`services/calendar.ts`, web `/kalendarz`): the free Forex Factory feed (`ff_calendar_thisweek.json`) only covers the current week and has no actual values. It is fetched every `CALENDAR_INTERVAL_HOURS` (default 2, 0 = off) and on `POST /calendar/refresh` (at most once every 10 minutes, because FF blocks aggressive polling). Each import replaces that FF week (Sunday to Sunday, New York time) in `economic_events`, so rescheduled events don't duplicate, and older weeks are kept, so history builds up over time. `category` comes from `categorizeEvent(title)` (shared/calendar.ts). Affected instruments come from `instrument_currencies`. Impact flags use FF colors. The views are day, week and month, filtered by currency, impact, category and instrument.
- **Language:** each user picks `pl` or `en` (`users.language`, settings dialog). The API translates errors, warnings, emotion labels, stats labels and new checklist items into that language: throw `badRequest('key', params)` with a key from `apps/api/src/i18n.ts`, and custom Zod messages are keys too (`validation.*`). The web client keeps all UI strings in `apps/web/src/i18n/pl.ts` and `en.ts` (same shape, checked by TypeScript) and reads them with `useT()`. Numbers and dates are formatted in the language's locale (`lib/format.ts`). Instrument names are English in every language.
- **MT5 import** (`POST /trades/import/mt5`, `services/mt5-import.ts`, parser in `shared/mt5-report.ts`): reads the MT5 account history report, as HTML (UTF-16) or Open XML (.xlsx). Only the Positions section is used, and rows are recognised by shape, so reports in any terminal language work. Times are platform server time: `broker-ny7` (New York + 7 h, GMT+2/+3, most brokers) or an IANA zone. Broker symbols are matched with `matchBrokerSymbol` (suffixes such as `.cash` or `m`, aliases, futures month codes), and the rest are assigned by the user (`symbolMap`). `commit=false` only previews. Imported trades get `externalId` `mt5:<account>:<position>` (unique per user), so re-importing skips them. Commission and swap become `fees`.
- **Signal direction:** `detectDirection()` (shared/trade-math.ts) reads BUY/SELL from the levels: a stop above the entry is a SELL, below is a BUY, and without a stop TP1 decides. The calculator uses it and shows the converted signal as stat tiles (direction + IN/SL/TP1/TP2).
- **Trading accounts (optional):** a user can have several accounts (`trading_accounts`, managed in the settings dialog through `/accounts`): name, `live` or `prop`, size, CFD leverage, and for prop accounts a market (`cfd`/`futures`, required), a maximum drawdown % (required) with a `drawdownType`, and an optional profit target %. A `static` floor is size × (1 − maxDrawdownPct); an `eod` floor trails the highest closing balance of a finished day (days in the user's time zone) minus the limit and stops at the starting size. A trade belongs to one account or none (`trades.accountId`); a prop account only accepts trades from its market, and deleting an account keeps its trades. Balances are the size plus the results of the account's closed trades (`services/accounts.ts`). The journal and stats take an `account` filter (an id, `none`, or omitted for all), chosen with the shared switcher (`lib/account-filter.ts`). Stats return `accounts` (every account's figures), `account` (the selected one) and `summary.returnPct`/`maxDrawdownPct` against it. A daily loss limit and intraday trailing drawdown are not implemented. `summary.maxDrawdown` (money) is always reported.
- **Risk and margin:** each trade in the API has `riskAccount` (stop distance × unit value × size × FX, `riskQuote()`) and `riskPct` (against its account's balance when the trade was opened; null without an account). The journal table shows both (risk % and SL in money). An account's `leverage` (1:10 … 1:1000, optional) makes the trade form show the CFD margin (`marginQuote()` = notional / leverage); futures margins are set by the exchange and are not calculated.
- **Equity chart against the account:** with one account selected and no instrument filter, stats return `balanceCurve` (that account's balance before the first day and after each day), and the chart plots the balance with reference lines for the start, the prop drawdown floor and the profit target.
- **Losses warning:** the threshold is per user (`users.lossStreakAlert`, 1–20, default 3) and `lossAlertMode` decides what is counted: losses in a row (`streak`, default) or every losing trade of the day (`day`, a checkbox in the settings). The monitor returns `lossMode` and `lossLimit`, and per group `lossCount`, `alert` and `alertKey`.
- **Drop-down lists** use the themed `components/ui/Select.tsx` (select-only combobox), never a native `<select>` or `<datalist>`, whose menus follow the operating system instead of the app theme.
- **Statistics** no longer report a spread cost total (the owner found it unnecessary). Trades still store `spreadUnits`/`spreadCost`.
- **Checklist:** one per user × instrument × day. It is created on first read with the default items, and the response also includes higher-timeframe levels (H4+) and that day's economic events for the instrument's currencies.

## Accounts and login

- **Better Auth** (`apps/api/src/auth.ts`) handles e-mail + password accounts, cookie sessions (30 days), password reset and rate limits (production). It uses our tables: `users` is the Better Auth user (`name` ↔ `displayName`), plus `auth_sessions`, `auth_accounts` (the password hash sits in `providerId = 'credential'`) and `auth_verifications`. It is mounted at `/auth/*` in the API (`routes/auth.ts`), so the web app calls `/api/auth/*`. `PUBLIC_URL` must be the web app's address, and `AUTH_SECRET` (32+ characters) is required in production.
- **Registration** follows `REGISTRATION`: `invite` (default: sign-up needs a code from `/invites`, created by an admin in the settings; the code sets the new user's role), `open`, or `closed`. Sign-up also stores the browser's language and time zone.
- **Current user** (`plugins/current-user.ts`): from the session cookie; without one the API answers 401 and the web app sends the user to `/logowanie` (and back afterwards). In development `AUTH_DEV_BYPASS=true` (default) keeps the old behaviour: without a session every request acts as `DEV_USER_EMAIL`, and `x-user-id` switches user. The bypass is always off in production, and the API docs (`/docs`) are only served outside production.
- **E-mail** goes through `services/mailer.ts`. Until a provider is configured, messages (including reset links) are written to the API log. Tests inject a fake mailer through `buildApp({ mailer })`.
- **Existing data:** the seeded admin owns the data created before login existed. Give it a login with `npm run user:login -- --user admin@trading.local --email <your e-mail> --password '<password>'` (stop the dev server first, PGlite allows one process).
- Screenshots under `/files/` are still public (unguessable names); protect them when moving to S3/R2.

## Conventions

- Validate every request with a Zod schema from `@trading/shared` so clients can reuse it.
- Throw `HttpError` / `notFound()` / `badRequest()` from `src/errors.ts`. Validation errors come back as `{ error, issues[] }` with status 400.
- Every query on user data must filter by `req.user.id`.
- Screenshots are saved to `UPLOAD_DIR` and served at `/files/<key>`. They should move to S3/R2 later.
