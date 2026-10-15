ALTER TABLE "trading_accounts" ADD COLUMN "max_drawdown_amount" numeric(18, 2);--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "profit_target_amount" numeric(18, 2);