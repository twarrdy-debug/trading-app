-- Plans (2026-10-20): every existing user keeps all features, so `user` becomes `pro`; the
-- withdrawn educator role's users and invites become Pro too; `standard` is new for sign-ups.
-- The enum is rebuilt through text (drizzle's way), so the data can be moved in between.
ALTER TABLE "users" DROP CONSTRAINT "users_role_roles_key_fk";--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "key" SET DATA TYPE text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE text;--> statement-breakpoint
INSERT INTO "roles" ("key", "name") VALUES ('pro', 'Pro'), ('standard', 'Standard') ON CONFLICT ("key") DO NOTHING;--> statement-breakpoint
UPDATE "users" SET "role" = 'pro' WHERE "role" IN ('user', 'educator');--> statement-breakpoint
UPDATE "invites" SET "role" = 'pro' WHERE "role" IN ('user', 'educator');--> statement-breakpoint
DELETE FROM "roles" WHERE "key" = 'user';--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "role" SET DEFAULT 'pro'::text;--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'pro'::text;--> statement-breakpoint
DROP TYPE "public"."role_key";--> statement-breakpoint
CREATE TYPE "public"."role_key" AS ENUM('admin', 'educator', 'pro', 'vip', 'standard');--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "role" SET DEFAULT 'pro'::"public"."role_key";--> statement-breakpoint
ALTER TABLE "invites" ALTER COLUMN "role" SET DATA TYPE "public"."role_key" USING "role"::"public"."role_key";--> statement-breakpoint
ALTER TABLE "roles" ALTER COLUMN "key" SET DATA TYPE "public"."role_key" USING "key"::"public"."role_key";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DEFAULT 'pro'::"public"."role_key";--> statement-breakpoint
ALTER TABLE "users" ALTER COLUMN "role" SET DATA TYPE "public"."role_key" USING "role"::"public"."role_key";--> statement-breakpoint
ALTER TABLE "users" ADD CONSTRAINT "users_role_roles_key_fk" FOREIGN KEY ("role") REFERENCES "public"."roles"("key") ON DELETE no action ON UPDATE no action;
