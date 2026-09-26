# CLAUDE.md

Web app for day traders: a trading journal, daily instrument analysis, an economic calendar and signals from educators. The web client comes first. A mobile app (Expo/React Native) will later use the same API. The owner communicates in Polish, and all user-facing strings (API error messages, labels) are in Polish.

## Working agreement

- Work in stages and show the result after each one before moving on. Order: 1) data model + API skeleton (done, extended with CFD/futures, spreads and FX), 2) visual direction, 3) journal + stats UI, 4) daily analysis + swing/equal high-low detection from OHLC, 5) economic calendar (Forex Factory feed), later: accounts, e-mail, push.
- The frontend must look distinctive, not like a generic AI-generated app. Ask the owner before deciding how tiles and buttons look. The chosen style is a "modern cockpit", direction **A · Awionika**: a HUD look with hairline frames and accent corner brackets, chamfered (clip-path) buttons, Chakra Petch for UI text and IBM Plex Mono for numbers, default accent #FFB020. The mockup is at https://claude.ai/artifact/BHAQoWCwjLictunAe4oJRC. Keep every visual decision in design tokens (CSS variables) and shared components so the look can be swapped later. There will be dark and light themes, and the user picks one accent color. Buy/long is green and sell/short is red.

## Layout

npm workspaces monorepo:

- `packages/shared`: code shared by the API, web and mobile clients. It holds enums, Zod request schemas (`schemas.ts`), pip/tick/R math (`trade-math.ts`), the signal text parser (`signal-parser.ts`) and date helpers. It is consumed as TypeScript source with no build step.
- `apps/api`: Fastify 5 + `fastify-type-provider-zod` + Drizzle ORM on PostgreSQL.
  - `src/db/schema.ts`: all tables. Migrations are in `apps/api/drizzle/`.
  - `src/routes/*`: HTTP routes. Business logic lives in `src/services/` (the trade logic is in `services/trades.ts`).
  - `src/plugins/current-user.ts`: resolves `req.user`, plus the `requireRole()` helper.
- `apps/web` and `apps/mobile` come in later stages.

## Commands

```sh
npm install
npm run dev:api        # API on http://127.0.0.1:3001, OpenAPI docs at /docs
npm test               # vitest: shared unit tests + API integration tests (in-memory DB)
npm run typecheck
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
- **Checklist:** one per user × instrument × day. It is created on first read with the default items, and the response also includes higher-timeframe levels (H4+) and that day's economic events for the instrument's currencies.

## Auth (temporary)

There is no login yet. Every request acts as `DEV_USER_EMAIL` (the seeded admin). Outside production, the `x-user-id: <uuid>` header acts as another user, for example an educator. Replace this with real sessions (Better Auth is planned) when accounts are added.

## Conventions

- Validate every request with a Zod schema from `@trading/shared` so clients can reuse it.
- Throw `HttpError` / `notFound()` / `badRequest()` from `src/errors.ts`. Validation errors come back as `{ error, issues[] }` with status 400.
- Every query on user data must filter by `req.user.id`.
- Screenshots are saved to `UPLOAD_DIR` and served at `/files/<key>`. They should move to S3/R2 later.
