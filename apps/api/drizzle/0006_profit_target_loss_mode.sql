CREATE TYPE "public"."loss_alert_mode" AS ENUM('streak', 'day');--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "loss_alert_mode" "loss_alert_mode" DEFAULT 'streak' NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "profit_target_pct" numeric(6, 2);