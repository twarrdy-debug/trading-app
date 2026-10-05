CREATE TYPE "public"."exit_kind" AS ENUM('tp', 'be', 'sl', 'manual');--> statement-breakpoint
CREATE TABLE "trade_exits" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"trade_id" uuid NOT NULL,
	"kind" "exit_kind" NOT NULL,
	"tp_index" smallint,
	"price" numeric(18, 6) NOT NULL,
	"size" numeric(18, 4) NOT NULL,
	"closed_at" timestamp with time zone,
	"sort_order" smallint DEFAULT 0 NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "take_profits" numeric(18, 6)[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "strategy_id" uuid;--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "checked_rule_ids" uuid[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD CONSTRAINT "trade_exits_trade_id_trades_id_fk" FOREIGN KEY ("trade_id") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trade_exits_trade_idx" ON "trade_exits" USING btree ("trade_id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_strategy_id_strategies_id_fk" FOREIGN KEY ("strategy_id") REFERENCES "public"."strategies"("id") ON DELETE set null ON UPDATE no action;