CREATE TABLE "trading_accounts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"name" text NOT NULL,
	"type" "account_type" NOT NULL,
	"market" "market",
	"size" numeric(18, 2) NOT NULL,
	"max_drawdown_pct" numeric(5, 2),
	"profit_target_pct" numeric(6, 2),
	"leverage" smallint,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "account_id" uuid;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD CONSTRAINT "trading_accounts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trading_accounts_user_idx" ON "trading_accounts" USING btree ("user_id");--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_account_id_trading_accounts_id_fk" FOREIGN KEY ("account_id") REFERENCES "public"."trading_accounts"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_account_idx" ON "trades" USING btree ("account_id");--> statement-breakpoint
-- Existing single account profiles become the first trading account, with their trades since the start date.
INSERT INTO "trading_accounts" ("user_id", "name", "type", "market", "size", "max_drawdown_pct", "profit_target_pct", "leverage")
SELECT "id",
  CASE WHEN "account_type" = 'prop' THEN 'Prop' ELSE 'Live' END,
  "account_type",
  CASE WHEN "account_type" = 'prop' THEN 'cfd'::"market" ELSE NULL END,
  "account_size", "max_drawdown_pct", "profit_target_pct", "leverage"
FROM "users"
WHERE "account_type" IS NOT NULL AND "account_size" IS NOT NULL;--> statement-breakpoint
UPDATE "trades" SET "account_id" = a."id"
FROM "trading_accounts" a JOIN "users" u ON u."id" = a."user_id"
WHERE "trades"."user_id" = a."user_id"
  AND (u."account_start_date" IS NULL OR "trades"."trade_date" >= u."account_start_date");--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_type";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_size";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "max_drawdown_pct";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "profit_target_pct";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "leverage";--> statement-breakpoint
ALTER TABLE "users" DROP COLUMN "account_start_date";