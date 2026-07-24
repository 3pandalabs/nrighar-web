import { sql } from "drizzle-orm";
import {
  boolean,
  check,
  date,
  index,
  integer,
  jsonb,
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
    notes: text("notes"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_properties_owner").on(t.ownerId),
    check(
      "properties_type_check",
      sql`${t.propertyType} in ('apartment','independent_house','villa','plot','commercial')`,
    ),
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

// One row per automated KYC extraction/verification run against a document
// or tenant_document row. documentSource + documentId point at whichever of
// those two tables the file's metadata row lives in (they're separate
// tables, so this can't be a normal FK). extractedFields never contains a
// raw Aadhaar number — that's masked to its last 4 digits before this row
// is ever written (see lib/kyc/mask.ts) — so this table is safe to read back
// over the API without extra redaction.
export const kycVerifications = pgTable(
  "kyc_verifications",
  {
    id: uuid("id").primaryKey().defaultRandom(),
    documentSource: text("document_source").notNull(),
    documentId: uuid("document_id").notNull(),
    ownerId: uuid("owner_id").references(() => users.id, { onDelete: "cascade" }),
    tenantId: uuid("tenant_id").references(() => tenants.id, { onDelete: "cascade" }),
    tenantUserId: uuid("tenant_user_id").references(() => users.id, { onDelete: "cascade" }),
    docType: text("doc_type"),
    status: text("status").notNull().default("pending"),
    isValidDocument: boolean("is_valid_document"),
    extractedFields: jsonb("extracted_fields"),
    qualityFlags: jsonb("quality_flags"),
    officialCheckStatus: text("official_check_status"),
    officialCheckDetail: jsonb("official_check_detail"),
    errorMessage: text("error_message"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => [
    index("idx_kyc_verifications_document").on(t.documentSource, t.documentId),
    index("idx_kyc_verifications_tenant").on(t.tenantId),
    index("idx_kyc_verifications_tenant_user").on(t.tenantUserId),
    check("kyc_verifications_source_check", sql`${t.documentSource} in ('document','tenant_document')`),
    check(
      "kyc_verifications_status_check",
      sql`${t.status} in ('pending','extracted','verified','manual_review','rejected','failed')`,
    ),
    check(
      "kyc_verifications_doc_type_check",
      sql`${t.docType} is null or ${t.docType} in ('pan_card','aadhaar_card','passport','unknown')`,
    ),
    check(
      "kyc_verifications_official_check_status_check",
      sql`${t.officialCheckStatus} is null or ${t.officialCheckStatus} in ('verified','mismatch','not_configured','error')`,
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
