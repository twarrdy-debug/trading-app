ALTER TABLE "trade_exits" ALTER COLUMN "kind" SET DATA TYPE text;--> statement-breakpoint
DROP TYPE "public"."exit_kind";--> statement-breakpoint
CREATE TYPE "public"."exit_kind" AS ENUM('tp', 'sl', 'be', 'manual', 'open');--> statement-breakpoint
ALTER TABLE "trade_exits" ALTER COLUMN "kind" SET DATA TYPE "public"."exit_kind" USING "kind"::"public"."exit_kind";--> statement-breakpoint
ALTER TABLE "trade_exits" ALTER COLUMN "price" DROP NOT NULL;--> statement-breakpoint
ALTER TABLE "trade_exits" ADD COLUMN "take_profit" numeric(18, 6);--> statement-breakpoint
ALTER TABLE "trade_exits" ADD COLUMN "stop_loss" numeric(18, 6);