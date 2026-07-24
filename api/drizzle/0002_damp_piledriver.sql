ALTER TABLE "properties" ADD COLUMN "bedrooms" integer;--> statement-breakpoint
ALTER TABLE "property_listings" ADD COLUMN "min_lease_months" integer;--> statement-breakpoint
ALTER TABLE "properties" ADD CONSTRAINT "properties_bedrooms_check" CHECK ("properties"."bedrooms" is null or "properties"."bedrooms" > 0);--> statement-breakpoint
ALTER TABLE "property_listings" ADD CONSTRAINT "property_listings_min_lease_check" CHECK ("property_listings"."min_lease_months" is null or "property_listings"."min_lease_months" > 0);