CREATE TYPE "public"."asset_class" AS ENUM('forex', 'metal', 'index', 'energy', 'crypto', 'other');--> statement-breakpoint
CREATE TYPE "public"."bias" AS ENUM('bullish', 'bearish', 'neutral');--> statement-breakpoint
CREATE TYPE "public"."direction" AS ENUM('long', 'short');--> statement-breakpoint
CREATE TYPE "public"."event_impact" AS ENUM('low', 'medium', 'high', 'holiday');--> statement-breakpoint
CREATE TYPE "public"."fx_rate_source" AS ENUM('auto', 'manual');--> statement-breakpoint
CREATE TYPE "public"."level_source" AS ENUM('manual', 'auto');--> statement-breakpoint
CREATE TYPE "public"."level_type" AS ENUM('support', 'resistance', 'equal_highs', 'equal_lows', 'swing_high', 'swing_low');--> statement-breakpoint
CREATE TYPE "public"."market" AS ENUM('cfd', 'futures');--> statement-breakpoint
CREATE TYPE "public"."measure_unit" AS ENUM('pip', 'tick', 'point');--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('admin', 'educator', 'user', 'vip');--> statement-breakpoint
CREATE TYPE "public"."signal_status" AS ENUM('active', 'closed', 'cancelled');--> statement-breakpoint
CREATE TYPE "public"."theme" AS ENUM('dark', 'light', 'system');--> statement-breakpoint
CREATE TYPE "public"."timeframe" AS ENUM('M1', 'M5', 'M15', 'M30', 'H1', 'H4', 'D1', 'W1', 'MN');--> statement-breakpoint
CREATE TYPE "public"."trade_source" AS ENUM('own', 'educator');--> statement-breakpoint
CREATE TABLE "checklist_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"checklist_id" uuid NOT NULL,
	"label" text NOT NULL,
	"checked" boolean DEFAULT false NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "daily_spreads" (
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"date" date NOT NULL,
	"spread_units" numeric(12, 2) NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "daily_spreads_user_id_instrument_id_date_pk" PRIMARY KEY("user_id","instrument_id","date")
);
--> statement-breakpoint
CREATE TABLE "economic_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'forexfactory' NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"currency" char(3) NOT NULL,
	"impact" "event_impact" NOT NULL,
	"event_time" timestamp with time zone NOT NULL,
	"forecast" text,
	"previous" text,
	"actual" text,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "emotions" (
	"key" text PRIMARY KEY NOT NULL,
	"label" text NOT NULL,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
CREATE TABLE "fx_rates" (
	"date" date NOT NULL,
	"base" char(3) NOT NULL,
	"quote" char(3) NOT NULL,
	"rate" numeric(18, 8) NOT NULL,
	"rate_date" date NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "fx_rates_date_base_quote_pk" PRIMARY KEY("date","base","quote")
);
--> statement-breakpoint
CREATE TABLE "instrument_currencies" (
	"instrument_id" uuid NOT NULL,
	"currency" char(3) NOT NULL,
	CONSTRAINT "instrument_currencies_instrument_id_currency_pk" PRIMARY KEY("instrument_id","currency")
);
--> statement-breakpoint
CREATE TABLE "instruments" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"symbol" text NOT NULL,
	"name" text NOT NULL,
	"market" "market" NOT NULL,
	"asset_class" "asset_class" NOT NULL,
	"measure_unit" "measure_unit" NOT NULL,
	"unit_size" numeric(18, 8) NOT NULL,
	"unit_value" numeric(18, 6) NOT NULL,
	"quote_currency" char(3) NOT NULL,
	"active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "instruments_symbol_unique" UNIQUE("symbol")
);
--> statement-breakpoint
CREATE TABLE "liquidity_levels" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"type" "level_type" NOT NULL,
	"timeframe" timeframe NOT NULL,
	"source" "level_source" DEFAULT 'manual' NOT NULL,
	"note" text,
	"valid_from" date NOT NULL,
	"valid_until" date,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "ohlc_candles" (
	"instrument_id" uuid NOT NULL,
	"timeframe" timeframe NOT NULL,
	"ts" timestamp with time zone NOT NULL,
	"open" numeric(18, 6) NOT NULL,
	"high" numeric(18, 6) NOT NULL,
	"low" numeric(18, 6) NOT NULL,
	"close" numeric(18, 6) NOT NULL,
	"volume" numeric(20, 4),
	CONSTRAINT "ohlc_candles_instrument_id_timeframe_ts_pk" PRIMARY KEY("instrument_id","timeframe","ts")
);
--> statement-breakpoint
CREATE TABLE "roles" (
	"key" "role_key" PRIMARY KEY NOT NULL,
	"name" text NOT NULL
);
--> statement-breakpoint
CREATE TABLE "session_checklists" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"date" date NOT NULL,
	"bias" "bias",
	"bias_note" text,
	"htf_notes" text,
	"news_notes" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "signal_take_profits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"signal_id" uuid NOT NULL,
	"level" smallint NOT NULL,
	"price" numeric(18, 6) NOT NULL,
	"hit_at" timestamp with time zone
);
--> statement-breakpoint
CREATE TABLE "signals" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"educator_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"entry_price" numeric(18, 6) NOT NULL,
	"stop_loss" numeric(18, 6) NOT NULL,
	"notes" text,
	"status" "signal_status" DEFAULT 'active' NOT NULL,
	"published_at" timestamp with time zone DEFAULT now() NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "trade_emotions" (
	"trade_id" uuid NOT NULL,
	"emotion_key" text NOT NULL,
	CONSTRAINT "trade_emotions_trade_id_emotion_key_pk" PRIMARY KEY("trade_id","emotion_key")
);
--> statement-breakpoint
CREATE TABLE "trade_screenshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"storage_key" text NOT NULL,
	"mime_type" text NOT NULL,
	"size_bytes" integer NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "trade_screenshots_storage_key_unique" UNIQUE("storage_key")
);
--> statement-breakpoint
CREATE TABLE "trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"trade_date" date NOT NULL,
	"entry_price" numeric(18, 6) NOT NULL,
	"exit_price" numeric(18, 6),
	"stop_loss" numeric(18, 6),
	"take_profit" numeric(18, 6),
	"position_size" numeric(18, 4) NOT NULL,
	"fees" numeric(18, 2),
	"fx_rate" numeric(18, 8),
	"fx_rate_source" "fx_rate_source",
	"spread_units" numeric(12, 2),
	"result_units" numeric(18, 2),
	"pnl_quote" numeric(18, 2),
	"pnl_account" numeric(18, 2),
	"account_currency" char(3) NOT NULL,
	"risk_units" numeric(18, 2),
	"r_multiple" numeric(10, 2),
	"planned_rr" numeric(10, 2),
	"spread_cost" numeric(18, 2),
	"notes" text,
	"source" "trade_source" DEFAULT 'own' NOT NULL,
	"educator_id" uuid,
	"signal_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "users" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"email" text,
	"display_name" text NOT NULL,
	"role" "role_key" DEFAULT 'user' NOT NULL,
	"account_currency" char(3) DEFAULT 'USD' NOT NULL,
	"theme" "theme" DEFAULT 'dark' NOT NULL,
	"accent_color" text,
	"timezone" text DEFAULT 'Europe/Warsaw' NOT NULL,
	"max_trades_per_day" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "users_email_unique" UNIQUE("email")
);
--> statement-breakpoint
ALTER TABLE "checklist_items" ADD CONSTRAINT "checklist_items_checklist_id_session_checklists_id_fk" FOREIGN KEY ("checklist_id") REFERENCES "public"."session_checklists"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_spreads" ADD CONSTRAINT "daily_spreads_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "daily_spreads" ADD CONSTRAINT "daily_spreads_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "instrument_currencies" ADD CONSTRAINT "instrument_currencies_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidity_levels" ADD CONSTRAINT "liquidity_levels_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "liquidity_levels" ADD CONSTRAINT "liquidity_levels_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "ohlc_candles" ADD CONSTRAINT "ohlc_candles_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checklists" ADD CONSTRAINT "session_checklists_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "session_checklists" ADD CONSTRAINT "session_checklists_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signal_take_profits" ADD CONSTRAINT "signal_take_profits_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_educator_id_users_id_fk" FOREIGN KEY ("educator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "signals" ADD CONSTRAINT "signals_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_emotions" ADD CONSTRAINT "trade_emotions_emotion_key_emotions_key_fk" FOREIGN KEY ("emotion_key") REFERENCES "public"."emotions"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trade_screenshots" ADD CONSTRAINT "trade_screenshots_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_educator_id_users_id_fk" FOREIGN KEY ("educator_id") REFERENCES "public"."users"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_signal_id_signals_id_fk" FOREIGN KEY ("signal_id") REFERENCES "public"."signals"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "events_source_external_idx" ON "economic_events" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "events_time_idx" ON "economic_events" USING btree ("event_time");--> statement-breakpoint
CREATE INDEX "levels_user_instrument_idx" ON "liquidity_levels" USING btree ("user_id","instrument_id","valid_from");--> statement-breakpoint
CREATE UNIQUE INDEX "checklist_user_instrument_date_idx" ON "session_checklists" USING btree ("user_id","instrument_id","date");--> statement-breakpoint
CREATE UNIQUE INDEX "signal_tp_level_idx" ON "signal_take_profits" USING btree ("signal_id","level");--> statement-breakpoint
CREATE INDEX "signals_published_idx" ON "signals" USING btree ("published_at");--> statement-breakpoint
CREATE INDEX "trades_user_date_idx" ON "trades" USING btree ("user_id","trade_date","opened_at");--> statement-breakpoint
CREATE INDEX "trades_user_instrument_idx" ON "trades" USING btree ("user_id","instrument_id");