import { and, eq, isNull, or, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

// Ports migration 0008's find_or_link_owner_tenant exactly: when a tenant
// profile is shared with an owner (via profile-share claim or intake
// acceptance), link it to the owner's EXISTING tenant record instead of
// creating a duplicate — match by tenant_user_id first, then by phone (last
// 10 digits) or email (case-insensitive) among the owner's unlinked records.
// Only create a fresh record when nothing matches. Called from both
// claimProfileShare and acceptIntakeAsTenant — do not duplicate this logic.
export async function findOrLinkOwnerTenant(
  ownerId: string,
  tenantUserId: string,
  note: string,
): Promise<string | null> {
  const [tenantProfile] = await db
    .select()
    .from(schema.tenantProfiles)
    .where(eq(schema.tenantProfiles.userId, tenantUserId));
  if (!tenantProfile) return null;

  // 1. Already linked?
  const [existing] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.ownerId, ownerId), eq(schema.tenants.tenantUserId, tenantUserId)));
  if (existing) return existing.id;

  // 2. Match an unlinked record by phone (last 10 digits) or email.
  const phoneDigits = (tenantProfile.phone ?? "").replace(/\D/g, "").slice(-10);
  const candidates = await db
    .select()
    .from(schema.tenants)
    .where(
      and(
        eq(schema.tenants.ownerId, ownerId),
        isNull(schema.tenants.tenantUserId),
        or(
          phoneDigits.length === 10
            ? sql`right(regexp_replace(coalesce(${schema.tenants.phone}, ''), '\\D', '', 'g'), 10) = ${phoneDigits}`
            : sql`false`,
          tenantProfile.email
            ? sql`lower(coalesce(${schema.tenants.email}, '')) = lower(${tenantProfile.email})`
            : sql`false`,
        ),
      ),
    )
    .orderBy(schema.tenants.createdAt)
    .limit(1);

  const match = candidates[0];
  if (match) {
    await db
      .update(schema.tenants)
      .set({
        tenantUserId,
        kycStatus: tenantProfile.kycStatus,
        phone: match.phone ?? tenantProfile.phone,
        email: match.email ?? tenantProfile.email,
      })
      .where(eq(schema.tenants.id, match.id));
    return match.id;
  }

  // 3. Nothing matches: create.
  const [created] = await db
    .insert(schema.tenants)
    .values({
      ownerId,
      fullName: tenantProfile.fullName,
      phone: tenantProfile.phone,
      email: tenantProfile.email,
      kycStatus: tenantProfile.kycStatus,
      tenantUserId,
      notes: note,
    })
    .returning({ id: schema.tenants.id });
  return created.id;
}
