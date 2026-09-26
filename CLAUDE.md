# CLAUDE.md

Web app for day traders: a trading journal, daily instrument analysis, an economic calendar and signals from educators. The web client comes first. A mobile app (Expo/React Native) will later use the same API. The owner communicates in Polish, and all user-facing strings (API error messages, labels) are in Polish.

## Working agreement

- Work in stages and show the result after each one before moving on. Order: 1) data model + API skeleton (done, extended with CFD/futures, spreads and FX), 2) visual direction (done: A), 3) journal + stats UI (done), 4) daily analysis + swing/equal high-low detection from OHLC, 5) economic calendar (done early), later: accounts, e-mail, push.
- The frontend must look distinctive, not like a generic AI-generated app. Ask the owner before deciding how tiles and buttons look. The chosen style is a "modern cockpit", direction **A · Awionika**: a HUD look with hairline frames and accent corner brackets, chamfered (clip-path) buttons, Chakra Petch for UI text and IBM Plex Mono for numbers, default accent #FFB020. The mockup is at https://claude.ai/artifact/BHAQoWCwjLictunAe4oJRC. Keep every visual decision in design tokens (CSS variables) and shared components so the look can be swapped later. There will be dark and light themes, and the user picks one accent color. Buy/long is green and sell/short is red.

## Layout

npm workspaces monorepo:

- `packages/shared`: code shared by the API, web and mobile clients. It holds enums, Zod request schemas (`schemas.ts`), pip/tick/R math (`trade-math.ts`), the signal text parser (`signal-parser.ts`) and date helpers. It is consumed as TypeScript source with no build step.
- `apps/api`: Fastify 5 + `fastify-type-provider-zod` + Drizzle ORM on PostgreSQL.
  - `src/db/schema.ts`: all tables. Migrations are in `apps/api/drizzle/`.
  - `src/routes/*`: HTTP routes. Business logic lives in `src/services/` (the trade logic is in `services/trades.ts`).
  - `src/plugins/current-user.ts`: resolves `req.user`, plus the `requireRole()` helper.
- `apps/api/src/types.ts`: JSON response types for clients (`import type { Trade } from '@trading/api/types'`). They are derived from the service return types, so an API change surfaces as a type error in the web app. The Fastify decorations live in `src/fastify-context.ts` so this import doesn't pull in the whole app.
- `apps/web`: React 19 + Vite + TanStack Query/Router + Tailwind v4.
  - `src/styles.css`: **all design tokens** (colors per theme, fonts, chamfer/bracket sizes) as CSS variables mapped into Tailwind (`bg-panel`, `text-dim`, `bg-accent`…). `--accent` and `--on-accent` are set at runtime from the user's settings (`lib/theme.ts`).
  - `src/components/ui/`: Button (chamfered primary/buy/sell), Panel + Brackets (HUD corners), Field/Input/Select/Segmented, Stat/Gauge/Segments. Screens use only these components and tokens, never raw colors, so the look can be swapped in one place.
  - `src/components/charts/`: EquityChart (d3-scale/d3-shape SVG with crosshair tooltip) and BarList (HTML bars that double as the table view).
  - `src/features/journal|stats|settings`: the screens. `src/api/hooks.ts` holds all React Query hooks.
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
```

In development the server applies migrations and seeds (roles, emotions, instruments, admin user) on startup, and both steps are idempotent. `npm run db:migrate` and `npm run db:seed` do the same without starting the server.

## Database

- `DATABASE_URL` set to `postgres://…` uses a real Postgres server through postgres.js. Any other value is a PGlite data directory: embedded Postgres in WASM, with no Docker or install needed. The default is `apps/api/.data/pglite`, and `memory://` is used in tests. Docker is not installed on this machine, so development runs on PGlite.
- Only one process can open a PGlite directory, so stop the dev server before running `db:migrate` or `db:seed`.
- Never edit an applied migration. Change `schema.ts` and run `npm run db:generate`.
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
- **CFD ↔ futures calculator** (web `/kalkulator`, logic in `packages/shared/src/instruments.ts`): **the UI covers only XAUUSD ↔ GC1** (the owner's choice). It has a single-price converter and manual IN/SL/TP1/TP2 fields, with no signal paste. The shared helpers and basis measurements still support all pairs, which are US100↔NQ1/MNQ1, US500↔ES1/MES1, US30↔YM1/MYM1 and XAUUSD↔GC1/MGC1 (`CFD_FUTURES_PAIRS`). The page has an instrument select (any CFD, mini or micro symbol) with a price field that shows every counterpart: CFD → both futures contracts, futures → the CFD plus its mini/micro sibling (same price) and a whole-signal converter. The difference between the markets comes either from two current prices, converted by point difference (`offset`) or price ratio (`ratio`), or from a point offset (futures − CFD) the user types directly. Futures prices are rounded to the tick. Risk and reward per contract come from the instruments' `unitSize`/`unitValue`. It runs entirely in the client, and the last basis per pair is kept in localStorage. The default mode "Auto" uses server measurements: `services/basis.ts` fetches the reference price (cash index from Yahoo ^NDX/^GSPC/^DJI, spot gold from gold-api.com) and the futures (Yahoo NQ=F/ES=F/YM=F/GC=F) every `BASIS_INTERVAL_HOURS` (default 4, 0 = off) and on `POST /basis/refresh`, and stores them in `basis_snapshots`. A snapshot is `live` only when both quotes are fresh and within 20 minutes of each other (cash indices trade only in the US session). Alerts (`alert` in `GET /basis`, red marker on the nav tab) compare the last two live snapshots against `alertPoints` per pair (gold 2, US100 10, US500 3, US30 30). These sources are unofficial: fine for personal use, but they must be replaced by a licensed feed before other users rely on them. Tests inject a fake `QuoteProvider` through `buildApp({ quotes })`.
- **Position size:** CFD lots can be fractional (the form offers 0.01 / 0.1 / 0.5 / 1). Futures must be whole contracts, which the API enforces. The journal form no longer has a fees field, but the API still accepts `fees`.
- **Trading monitor** (`GET /trades/monitor`, `tradingMonitor()`): today's trades against `maxTradesPerDay`, plus losing trades in a row today, counted back from the latest closed trade by `resultUnits < 0`. At `LOSS_STREAK_ALERT` (3) the web app shows a page-wide banner. Dismissing it is stored per streak (`streakKey`), so the banner returns after the next loss.
- **Economic calendar** (`services/calendar.ts`, web `/kalendarz`): the free Forex Factory feed (`ff_calendar_thisweek.json`) only covers the current week and has no actual values. It is fetched every `CALENDAR_INTERVAL_HOURS` (default 2, 0 = off) and on `POST /calendar/refresh` (at most once every 10 minutes, because FF blocks aggressive polling). Each import replaces that FF week (Sunday to Sunday, New York time) in `economic_events`, so rescheduled events don't duplicate, and older weeks are kept, so history builds up over time. `category` comes from `categorizeEvent(title)` (shared/calendar.ts), because FF has no event type. Affected instruments come from `instrument_currencies`. Impact flags use FF colors (red/orange/yellow, grey for holidays). The views are day, week and month, filtered by currency, impact, category and instrument.
- **Checklist:** one per user × instrument × day. It is created on first read with the default items, and the response also includes higher-timeframe levels (H4+) and that day's economic events for the instrument's currencies.

## Auth (temporary)

There is no login yet. Every request acts as `DEV_USER_EMAIL` (the seeded admin). Outside production, the `x-user-id: <uuid>` header acts as another user, for example an educator. Replace this with real sessions (Better Auth is planned) when accounts are added.

## Conventions

- Validate every request with a Zod schema from `@trading/shared` so clients can reuse it.
- Throw `HttpError` / `notFound()` / `badRequest()` from `src/errors.ts`. Validation errors come back as `{ error, issues[] }` with status 400.
- Every query on user data must filter by `req.user.id`.
- Screenshots are saved to `UPLOAD_DIR` and served at `/files/<key>`. They should move to S3/R2 later.
