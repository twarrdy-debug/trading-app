ALTER TABLE "invites" ADD COLUMN "multi_use" boolean DEFAULT false NOT NULL;--> statement-breakpoint
ALTER TABLE "invites" ADD COLUMN "use_count" integer DEFAULT 0 NOT NULL;