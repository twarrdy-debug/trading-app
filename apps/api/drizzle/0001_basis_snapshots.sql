CREATE TABLE "basis_snapshots" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"pair_key" text NOT NULL,
	"cfd_price" numeric(18, 6) NOT NULL,
	"futures_price" numeric(18, 6) NOT NULL,
	"difference" numeric(18, 6) NOT NULL,
	"cfd_quoted_at" timestamp with time zone NOT NULL,
	"futures_quoted_at" timestamp with time zone NOT NULL,
	"live" boolean NOT NULL,
	"measured_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE INDEX "basis_pair_measured_idx" ON "basis_snapshots" USING btree ("pair_key","measured_at");