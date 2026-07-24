CREATE TABLE IF NOT EXISTS "application_messages" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"application_id" uuid NOT NULL,
	"sender_user_id" uuid NOT NULL,
	"sender_role" text NOT NULL,
	"body" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	CONSTRAINT "application_messages_sender_role_check" CHECK ("application_messages"."sender_role" in ('owner','tenant')),
	CONSTRAINT "application_messages_body_check" CHECK (length("application_messages"."body") > 0)
);
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_messages" ADD CONSTRAINT "application_messages_application_id_property_applications_id_fk" FOREIGN KEY ("application_id") REFERENCES "public"."property_applications"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
 ALTER TABLE "application_messages" ADD CONSTRAINT "application_messages_sender_user_id_users_id_fk" FOREIGN KEY ("sender_user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
 WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_application_messages_application" ON "application_messages" USING btree ("application_id");