CREATE TYPE "public"."news_category" AS ENUM('data', 'central_bank', 'politics', 'geopolitics', 'markets', 'other');--> statement-breakpoint
CREATE TABLE "news_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"source" text DEFAULT 'financialjuice' NOT NULL,
	"external_id" text NOT NULL,
	"title" text NOT NULL,
	"url" text,
	"speaker" text,
	"source_name" text,
	"category" "news_category" DEFAULT 'other' NOT NULL,
	"currencies" text[] DEFAULT '{}' NOT NULL,
	"assets" "asset_class"[] DEFAULT '{}' NOT NULL,
	"data" jsonb,
	"event_id" uuid,
	"noise" boolean DEFAULT false NOT NULL,
	"published_at" timestamp with time zone NOT NULL,
	"fetched_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "news_keywords" text[] DEFAULT '{}' NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD CONSTRAINT "news_items_event_id_economic_events_id_fk" FOREIGN KEY ("event_id") REFERENCES "public"."economic_events"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE UNIQUE INDEX "news_source_external_idx" ON "news_items" USING btree ("source","external_id");--> statement-breakpoint
CREATE INDEX "news_published_idx" ON "news_items" USING btree ("published_at");