ALTER TABLE "trading_accounts" ADD COLUMN "max_trades_per_day" smallint;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "loss_streak_alert" smallint;