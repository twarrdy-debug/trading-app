ALTER TABLE "users" ADD COLUMN "failed_sign_ins" smallint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "users" ADD COLUMN "sign_in_locked_at" timestamp with time zone;