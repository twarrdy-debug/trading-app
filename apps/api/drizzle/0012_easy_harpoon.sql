ALTER TABLE "news_items" ADD COLUMN "important" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "news_items" ADD COLUMN "labels" text[] DEFAULT '{}' NOT NULL;