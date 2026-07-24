import { sql } from "drizzle-orm";
import {
  check,
  date,
  index,
  integer,
  numeric,
  pgTable,
  text,
  timestamp,
  unique,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";

// Replaces Supabase's auth.users + GoTrue. password_hash is bcrypt — chosen
// specifically so hashes dumped from the old Supabase auth.users.encrypted_password
// column keep verifying unchanged after migration (see scripts/migrate-data.ts).
export const users = pgTable("users", {
  id: uuid("id").primaryKey().defaultRandom(),
  email: text("email").notNull().unique(),
  passwordHash: text("password_hash").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

// Revocable refresh tokens. Only the bcrypt hash is stored, so a DB leak alone
// doesn't yield usable tokens.
export const sessions = pgTable(
  "sessions",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    userId: uuid("user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    refreshTokenHash: text("refresh_token_hash").notNull(),
    expiresAt: timestamp("expires_at", { withTimezone: true }).notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [index("idx_sessions_user").on(t.userId)],
);

export const profiles = pgTable(
  "profiles",
  {
    id: uuid("id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    displayName: text("display_name"),
    countryOfResidence: text("country_of_residence"),
    preferredCurrency: text("preferred_currency").notNull().default("USD"),
    role: text("role").notNull().default("owner"),
    upiVpa: text("upi_vpa"),
    upiName: text("upi_name"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("profiles_role_check", sql`${t.role} in ('owner','tenant')`)],
);

export const properties = pgTable(
  "properties",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    nickname: text("nickname").notNull(),
    addressLine1: text("address_line1").notNull(),
    addressLine2: text("address_line2"),
    city: text("city").notNull(),
    state: text("state").notNull(),
    pincode: text("pincode").notNull(),
    propertyType: text("property_type").notNull().default("apartment"),
    // Bedroom count ("BHK" in Indian rental listings) — nullable since
    // properties created before this column existed don't have one; the
    // marketplace browse filter treats a null as "unspecified", not "0".
    bedrooms: integer("bedrooms"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_properties_owner").on(t.ownerId),
    check(
      "properties_type_check",
      sql`${t.propertyType} in ('apartment','independent_house','villa','plot','commercial')`,
    ),
    check("properties_bedrooms_check", sql`${t.bedrooms} is null or ${t.bedrooms} > 0`),
  ],
);

export const tenants = pgTable(
  "tenants",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    kycStatus: text("kyc_status").notNull().default("pending"),
    notes: text("notes"),
    // Bridges an owner-side tenant record to a real tenant-user account once linked
    // (via profile-share claim or intake acceptance) — added in migration 0007.
    tenantUserId: uuid("tenant_user_id").references(() => users.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_tenants_owner").on(t.ownerId),
    check("tenants_kyc_check", sql`${t.kycStatus} in ('pending','submitted','verified')`),
  ],
);

export const leases = pgTable(
  "leases",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id")
      .notNull()
      .references(() => tenants.id, { onDelete: "cascade" }),
    rentAmount: numeric("rent_amount", { precision: 12, scale: 2 }).notNull(),
    depositAmount: numeric("deposit_amount", { precision: 12, scale: 2 }),
    startDate: date("start_date").notNull(),
    endDate: date("end_date"),
    rentDueDay: integer("rent_due_day").notNull().default(1),
    status: text("status").notNull().default("active"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_leases_owner").on(t.ownerId),
    index("idx_leases_property").on(t.propertyId),
    // At most one active lease per property — mirrors the Supabase partial unique index.
    uniqueIndex("uq_leases_one_active_per_property")
      .on(t.propertyId)
      .where(sql`${t.status} = 'active'`),
    check("leases_status_check", sql`${t.status} in ('active','ended')`),
    check("leases_rent_amount_check", sql`${t.rentAmount} > 0`),
    check("leases_due_day_check", sql`${t.rentDueDay} between 1 and 28`),
  ],
);

// An owner opens ONE listing per property at a time (partial unique index
// below) to invite competing applications. baseRentAsk is the asking rent
// applications are compared against — rentVariancePct in propertyApplications
// is always derived from this at read/write time, never trusted from a
// client.
export const propertyListings = pgTable(
  "property_listings",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id")
      .notNull()
      .references(() => properties.id, { onDelete: "cascade" }),
    baseRentAsk: numeric("base_rent_ask", { precision: 12, scale: 2 }).notNull(),
    // Desired minimum lease length in months, set when the listing is
    // opened — separate from leases.startDate/endDate, which only exist
    // once an actual lease is created post-approval.
    minLeaseMonths: integer("min_lease_months"),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    closedAt: timestamp("closed_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_property_listings_owner").on(t.ownerId),
    index("idx_property_listings_property").on(t.propertyId),
    uniqueIndex("uq_property_listings_one_open_per_property")
      .on(t.propertyId)
      .where(sql`${t.status} = 'open'`),
    check("property_listings_status_check", sql`${t.status} in ('open','closed')`),
    check("property_listings_base_rent_check", sql`${t.baseRentAsk} > 0`),
    check("property_listings_min_lease_check", sql`${t.minLeaseMonths} is null or ${t.minLeaseMonths} > 0`),
  ],
);

// One row per tenant-user's offer on a listing. No protected-class fields
// exist here (or anywhere in this schema) by design — Fair Housing
// compliance for the owner-facing comparison view is enforced by having
// nothing but financial/timeline/verification data to sort or filter on in
// the first place, not by a runtime filter. monthlyIncome is self-reported
// and optional; there's no credit-score field — no bureau integration
// exists to populate one (see ROUTES.md).
export const propertyApplications = pgTable(
  "property_applications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    listingId: uuid("listing_id")
      .notNull()
      .references(() => propertyListings.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    applicantUserId: uuid("applicant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    proposedRent: numeric("proposed_rent", { precision: 12, scale: 2 }).notNull(),
    moveInDate: date("move_in_date").notNull(),
    monthlyIncome: numeric("monthly_income", { precision: 12, scale: 2 }),
    profileHighlights: text("profile_highlights"),
    status: text("status").notNull().default("under_review"),
    // Set by the request-kyc action — points at the intakeLinks row minted
    // to reuse the existing document-verification pipeline (see
    // temporal/activities/applications.ts).
    intakeLinkId: uuid("intake_link_id").references(() => intakeLinks.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_property_applications_listing").on(t.listingId),
    index("idx_property_applications_owner").on(t.ownerId),
    index("idx_property_applications_applicant").on(t.applicantUserId),
    // One active (not yet decided) application per applicant per listing —
    // they can re-apply after a rejection/withdrawal, just not stack offers.
    uniqueIndex("uq_property_applications_active_per_applicant")
      .on(t.listingId, t.applicantUserId)
      .where(sql`${t.status} in ('under_review','kyc_requested')`),
    check(
      "property_applications_status_check",
      sql`${t.status} in ('under_review','kyc_requested','approved','rejected','withdrawn')`,
    ),
    check("property_applications_rent_check", sql`${t.proposedRent} > 0`),
  ],
);

// Async message thread between an owner and the tenant on one application —
// deliberately not real-time (no WebSocket/Durable Object infra in this
// app); messages show up on the next page load, matching every other
// mutation here. senderRole is denormalized rather than derived from
// comparing senderUserId to the application's ownerId/applicantUserId at
// read time — cheaper to query and stays correct even if that ever changes.
export const applicationMessages = pgTable(
  "application_messages",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    applicationId: uuid("application_id")
      .notNull()
      .references(() => propertyApplications.id, { onDelete: "cascade" }),
    senderUserId: uuid("sender_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    senderRole: text("sender_role").notNull(),
    body: text("body").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_application_messages_application").on(t.applicationId),
    check("application_messages_sender_role_check", sql`${t.senderRole} in ('owner','tenant')`),
    check("application_messages_body_check", sql`length(${t.body}) > 0`),
  ],
);

export const rentPayments = pgTable(
  "rent_payments",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }).notNull(),
    amountPaid: numeric("amount_paid", { precision: 12, scale: 2 }),
    paidOn: date("paid_on"),
    method: text("method"),
    status: text("status").notNull().default("due"),
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_rent_payments_owner").on(t.ownerId),
    index("idx_rent_payments_period").on(t.periodYear, t.periodMonth),
    unique("uq_rent_payments_lease_period").on(t.leaseId, t.periodYear, t.periodMonth),
    check("rent_payments_status_check", sql`${t.status} in ('due','paid','partial')`),
    check(
      "rent_payments_method_check",
      sql`${t.method} is null or ${t.method} in ('bank_transfer','upi','cash','other')`,
    ),
  ],
);

export const documents = pgTable(
  "documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    leaseId: uuid("lease_id").references(() => leases.id, { onDelete: "set null" }),
    docType: text("doc_type").notNull().default("other"),
    title: text("title").notNull(),
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_documents_owner").on(t.ownerId),
    check(
      "documents_type_check",
      sql`${t.docType} in ('agreement','kyc','property_paper','tax','other')`,
    ),
  ],
);

export const payLinks = pgTable(
  "pay_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    leaseId: uuid("lease_id")
      .notNull()
      .references(() => leases.id, { onDelete: "cascade" }),
    periodYear: integer("period_year").notNull(),
    periodMonth: integer("period_month").notNull(),
    amountDue: numeric("amount_due", { precision: 12, scale: 2 }).notNull(),
    openedAt: timestamp("opened_at", { withTimezone: true }),
    claimedPaidAt: timestamp("claimed_paid_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_pay_links_owner").on(t.ownerId),
    unique("uq_pay_links_lease_period").on(t.leaseId, t.periodYear, t.periodMonth),
  ],
);

export const intakeLinks = pgTable(
  "intake_links",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    ownerId: uuid("owner_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    propertyId: uuid("property_id").references(() => properties.id, { onDelete: "set null" }),
    status: text("status").notNull().default("pending"),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "set null" }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    submittedAt: timestamp("submitted_at", { withTimezone: true }),
    expiresAt: timestamp("expires_at", { withTimezone: true })
      .notNull()
      .default(sql`now() + interval '14 days'`),
  },
  (t) => [
    index("idx_intake_links_owner").on(t.ownerId),
    check("intake_links_status_check", sql`${t.status} in ('pending','submitted')`),
  ],
);

export const tenantProfiles = pgTable(
  "tenant_profiles",
  {
    userId: uuid("user_id")
      .primaryKey()
      .references(() => users.id, { onDelete: "cascade" }),
    fullName: text("full_name").notNull(),
    phone: text("phone"),
    email: text("email"),
    currentCity: text("current_city"),
    employer: text("employer"),
    kycStatus: text("kyc_status").notNull().default("pending"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [check("tenant_profiles_kyc_check", sql`${t.kycStatus} in ('pending','submitted','verified')`)],
);

export const tenantDocuments = pgTable(
  "tenant_documents",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantUserId: uuid("tenant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    docType: text("doc_type").notNull().default("other"),
    title: text("title").notNull(),
    storagePath: text("storage_path").notNull(),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_tenant_documents_user").on(t.tenantUserId),
    check(
      "tenant_documents_type_check",
      sql`${t.docType} in ('agreement','kyc','property_paper','tax','other')`,
    ),
  ],
);

// id doubles as the unguessable share token handed out in share links.
export const profileShares = pgTable(
  "profile_shares",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    tenantUserId: uuid("tenant_user_id")
      .notNull()
      .references(() => users.id, { onDelete: "cascade" }),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    status: text("status").notNull().default("open"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    claimedAt: timestamp("claimed_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
  },
  (t) => [
    index("idx_profile_shares_tenant").on(t.tenantUserId),
    index("idx_profile_shares_owner").on(t.ownerId),
    check("profile_shares_status_check", sql`${t.status} in ('open','claimed','revoked')`),
  ],
);
