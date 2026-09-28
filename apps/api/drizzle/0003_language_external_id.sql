CREATE TYPE "public"."language" AS ENUM('pl', 'en');--> statement-breakpoint
ALTER TABLE "trades" ADD COLUMN "external_id" text;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "language" "language" DEFAULT 'pl' NOT NULL;--> statement-breakpoint
CREATE UNIQUE INDEX "trades_user_external_idx" ON "trades" USING btree ("user_id","external_id");