CREATE TABLE IF NOT EXISTS "kyc_verifications" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"document_source" text NOT NULL,
	"document_id" uuid NOT NULL,
	"owner_id" uuid,
	"tenant_id" uuid,
	"tenant_user_id" uuid,
	"doc_type" text,
	"status" text DEFAULT 'pending' NOT NULL,
	"is_valid_document" boolean,
	"extracted_fields" jsonb,
	"quality_flags" jsonb,
	"official_check_status" text,
	"official_check_detail" jsonb,
	"error_message" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "kyc_verifications_source_check" CHECK ("kyc_verifications"."document_source" in ('document','tenant_document')),
	CONSTRAINT "kyc_verifications_status_check" CHECK ("kyc_verifications"."status" in ('pending','extracted','verified','manual_review','rejected','failed')),
	CONSTRAINT "kyc_verifications_doc_type_check" CHECK ("kyc_verifications"."doc_type" is null or "kyc_verifications"."doc_type" in ('pan_card','aadhaar_card','passport','unknown')),
	CONSTRAINT "kyc_verifications_official_check_status_check" CHECK ("kyc_verifications"."official_check_status" is null or "kyc_verifications"."official_check_status" in ('verified','mismatch','not_configured','error'))
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_owner_id_users_id_fk" FOREIGN KEY ("owner_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_tenant_id_tenants_id_fk" FOREIGN KEY ("tenant_id") REFERENCES "public"."tenants"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "kyc_verifications" ADD CONSTRAINT "kyc_verifications_tenant_user_id_users_id_fk" FOREIGN KEY ("tenant_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_document" ON "kyc_verifications" USING btree ("document_source","document_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_tenant" ON "kyc_verifications" USING btree ("tenant_id");--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_kyc_verifications_tenant_user" ON "kyc_verifications" USING btree ("tenant_user_id");