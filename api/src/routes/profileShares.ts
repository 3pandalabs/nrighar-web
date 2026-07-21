import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth, requireTenantRole } from "../auth/plugin.js";
import { findOrLinkOwnerTenant } from "../lib/findOrLinkOwnerTenant.js";

export async function profileShareRoutes(app: FastifyInstance) {
  // Tenant-scoped list, mirroring profile_shares_tenant_all's full-CRUD RLS
  // (tenant could always SELECT all their own share rows, claimed or not) —
  // the tenant "Sharing" page needs this to show history and let the tenant
  // revoke a previously-created share without already holding its id.
  app.get("/profile-shares", { preHandler: [requireAuth, requireTenantRole] }, async (req, reply) => {
    const rows = await db
      .select()
      .from(schema.profileShares)
      .where(eq(schema.profileShares.tenantUserId, req.userId!));
    return reply.send(rows);
  });

  // Tenant mints a reusable 'open' share link (used both for the link handed
  // out after intake and for tenant-initiated sharing).
  app.post("/profile-shares", { preHandler: [requireAuth, requireTenantRole] }, async (req, reply) => {
    const [row] = await db.insert(schema.profileShares).values({ tenantUserId: req.userId! }).returning();
    return reply.code(201).send(row);
  });

  // Mirrors get_profile_share_preview: status + name/city/kyc_status ONLY —
  // never documents, before the share is claimed.
  app.get("/profile-shares/:token/preview", { preHandler: requireAuth }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const [row] = await db
      .select({
        status: schema.profileShares.status,
        fullName: schema.tenantProfiles.fullName,
        currentCity: schema.tenantProfiles.currentCity,
        kycStatus: schema.tenantProfiles.kycStatus,
      })
      .from(schema.profileShares)
      .innerJoin(schema.tenantProfiles, eq(schema.tenantProfiles.userId, schema.profileShares.tenantUserId))
      .where(eq(schema.profileShares.id, token));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  // Mirrors 0008's claim_profile_share: validate not revoked / not already
  // claimed by someone else / not a self-claim, flip to claimed with
  // owner_id = caller, bridge via findOrLinkOwnerTenant.
  app.post("/profile-shares/:token/claim", { preHandler: requireAuth }, async (req, reply) => {
    const { token } = req.params as { token: string };
    const [share] = await db.select().from(schema.profileShares).where(eq(schema.profileShares.id, token));
    if (!share) return reply.code(404).send({ error: "not_found" });
    if (share.status === "revoked") return reply.code(409).send({ error: "revoked" });
    if (share.status === "claimed" && share.ownerId !== req.userId) {
      return reply.code(409).send({ error: "already_claimed" });
    }
    if (share.tenantUserId === req.userId) return reply.code(400).send({ error: "own_profile" });

    if (share.status === "open") {
      await db
        .update(schema.profileShares)
        .set({ ownerId: req.userId!, status: "claimed", claimedAt: new Date() })
        .where(eq(schema.profileShares.id, token));
    }

    const tenantId = await findOrLinkOwnerTenant(req.userId!, share.tenantUserId, "Linked from shared tenant profile");
    if (!tenantId) return reply.code(404).send({ error: "not_found" });

    return reply.send({ ok: true, tenantId, tenantUserId: share.tenantUserId });
  });

  // Tenant revokes a share they issued — instantly cuts the owner's read
  // access via hasClaimedShare() re-evaluating false on the next request.
  app.post(
    "/profile-shares/:id/revoke",
    { preHandler: [requireAuth, requireTenantRole] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db
        .update(schema.profileShares)
        .set({ status: "revoked", revokedAt: new Date() })
        .where(and(eq(schema.profileShares.id, id), eq(schema.profileShares.tenantUserId, req.userId!)))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );
}
