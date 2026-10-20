ALTER TYPE "public"."account_type" ADD VALUE 'backtest';--> statement-breakpoint
CREATE TABLE "backtest_sessions" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"account_id" uuid NOT NULL,
	"instrument_id" uuid NOT NULL,
	"resolution" text NOT NULL,
	"start_at" timestamp with time zone NOT NULL,
	"cursor_at" timestamp with time zone NOT NULL,
	"strategy_id" uuid,
	"finished_at" timestamp with time zone,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "backtest_trades" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"session_id" uuid NOT NULL,
	"user_id" uuid NOT NULL,
	"direction" "direction" NOT NULL,
	"size" numeric(18, 4) NOT NULL,
	"entry_price" numeric(18, 6) NOT NULL,
	"stop_loss" numeric(18, 6),
	"take_profit" numeric(18, 6),
	"initial_stop_loss" numeric(18, 6),
	"opened_at" timestamp with time zone NOT NULL,
	"closed_at" timestamp with time zone,
	"exit_price" numeric(18, 6),
	"exit_reason" text,
	"result_units" numeric(18, 2),
	"pnl" numeric(18, 2),
	"r_multiple" numeric(10, 2),
	"checked_rule_ids" uuid[] DEFAULT '{}' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_instrument_id_instruments_id_fk" FOREIGN KEY ("instrument_id") REFERENCES "public"."instruments"("id") ON DELETE no action ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_sessions" ADD CONSTRAINT "backtest_sessions_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_session_id_backtest_sessions_id_fk" FOREIGN KEY ("session_id") REFERENCES "public"."backtest_sessions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "backtest_trades" ADD CONSTRAINT "backtest_trades_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "backtest_sessions_user_idx" ON "backtest_sessions" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "backtest_sessions_account_idx" ON "backtest_sessions" USING btree ("account_id");--> statement-breakpoint
CREATE INDEX "backtest_trades_session_idx" ON "backtest_trades" USING btree ("session_id");