CREATE TYPE "public"."drawdown_type" AS ENUM('static', 'eod');--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "drawdown_type" "drawdown_type" DEFAULT 'static' NOT NULL;