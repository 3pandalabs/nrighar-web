import { and, eq, sql } from "drizzle-orm";
import { db, schema } from "../db/index.js";

// THE security-critical check. Mirrors the Supabase RLS predicate used by
// tenant_profiles_select_shared / tenant_documents_select_shared /
// documents_bucket_select_shared verbatim:
//   EXISTS (SELECT 1 FROM profile_shares WHERE tenant_user_id = :tenantUserId
//           AND owner_id = :callerId AND status = 'claimed')
//
// Call this from every place that lets an owner read a tenant's data across
// the share boundary — metadata routes AND the storage presign-download
// route. Do not re-derive this predicate inline elsewhere: a drifted copy is
// exactly how this kind of check silently breaks (a missed check on the
// storage route alone would leak files even if the metadata route is right).
export async function hasClaimedShare(tenantUserId: string, callerId: string): Promise<boolean> {
  const [row] = await db
    .select({ one: sql<number>`1` })
    .from(schema.profileShares)
    .where(
      and(
        eq(schema.profileShares.tenantUserId, tenantUserId),
        eq(schema.profileShares.ownerId, callerId),
        eq(schema.profileShares.status, "claimed"),
      ),
    )
    .limit(1);
  return row !== undefined;
}
