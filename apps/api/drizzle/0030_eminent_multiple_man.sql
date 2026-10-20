ALTER TABLE "trades" ADD COLUMN "copy_of" uuid;--> statement-breakpoint
ALTER TABLE "trading_accounts" ADD COLUMN "link_group" uuid;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "chart_style" jsonb;--> statement-breakpoint
ALTER TABLE "trades" ADD CONSTRAINT "trades_copy_of_trades_id_fk" FOREIGN KEY ("copy_of") REFERENCES "public"."trades"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "trades_copy_of_idx" ON "trades" USING btree ("copy_of");