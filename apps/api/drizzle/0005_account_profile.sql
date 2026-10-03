CREATE TYPE "public"."account_type" AS ENUM('live', 'prop');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_type" "account_type";--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_size" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "max_drawdown_pct" numeric(5, 2);--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "account_start_date" date;