CREATE TABLE IF NOT EXISTS "property_applications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"listing_id" uuid NOT NULL,
	"owner_id" uuid NOT NULL,
	"applicant_user_id" uuid NOT NULL,
	"proposed_rent" numeric(12, 2) NOT NULL,
	"move_in_date" date NOT NULL,
	"monthly_income" numeric(12, 2),
	"profile_highlights" text,
	"status" text DEFAULT 'under_review' NOT NULL,
	"intake_link_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "property_applications_status_check" CHECK ("property_applications"."status" in ('under_review','kyc_requested','approved','rejected','withdrawn')),
	CONSTRAINT "property_applications_rent_check" CHECK ("property_applications"."proposed_rent" > 0)
);
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "property_listings" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"owner_id" uuid NOT NULL,
	"property_id" uuid NOT NULL,
	"base_rent_ask" numeric(12, 2) NOT NULL,
	"status" text DEFAULT 'open' NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"closed_at" timestamp with time zone,
	CONSTRAINT "property_listings_status_check" CHECK ("property_listings"."status" in ('open','closed')),
	CONSTRAINT "property_listings_base_rent_check" CHECK ("property_listings"."base_rent_ask" > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_applications" ADD CONSTRAINT "property_applications_listing_id_property_listings_id_fk" FOREIGN KEY ("listing_id") REFERENCES "public"."property_listings"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_applications" ADD CONSTRAINT "property_applications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_applications" ADD CONSTRAINT "property_applications_applicant_user_id_users_id_fk" FOREIGN KEY ("applicant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_applications" ADD CONSTRAINT "property_applications_intake_link_id_intake_links_id_fk" FOREIGN KEY ("intake_link_id") REFERENCES "public"."intake_links"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_property_id_properties_id_fk" FOREIGN KEY ("property_id") REFERENCES "public"."properties"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_applications_listing" ON "property_applications" USING btree ("listing_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_applications_owner" ON "property_applications" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_applications_applicant" ON "property_applications" USING btree ("applicant_user_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_property_applications_active_per_applicant" ON "property_applications" USING btree ("listing_id","applicant_user_id") WHERE "property_applications"."status" in ('under_review','kyc_requested');--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_listings_owner" ON "property_listings" USING btree ("owner_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_property_listings_property" ON "property_listings" USING btree ("property_id");--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_property_listings_one_open_per_property" ON "property_listings" USING btree ("property_id") WHERE "property_listings"."status" = 'open';