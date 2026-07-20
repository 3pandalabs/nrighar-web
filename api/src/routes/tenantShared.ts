import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";
import { hasClaimedShare } from "../plugins/authz.js";

// The two share-conditional owner-reads (tenant_profiles_select_shared /
// tenant_documents_select_shared). An owner may read a tenant's profile/docs
// ONLY while a claimed profile_shares row links them — checked via the single
// shared hasClaimedShare() predicate, never re-derived inline here.
export async function tenantSharedRoutes(app: FastifyInstance) {
  app.get("/tenant-profiles/by-owner/:tenantUserId", { preHandler: requireAuth }, async (req, reply) => {
    const { tenantUserId } = req.params as { tenantUserId: string };
    if (!(await hasClaimedShare(tenantUserId, req.userId!))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const [row] = await db.select().from(schema.tenantProfiles).where(eq(schema.tenantProfiles.userId, tenantUserId));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  app.get("/tenant-documents/by-owner/:tenantUserId", { preHandler: requireAuth }, async (req, reply) => {
    const { tenantUserId } = req.params as { tenantUserId: string };
    if (!(await hasClaimedShare(tenantUserId, req.userId!))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const rows = await db.select().from(schema.tenantDocuments).where(eq(schema.tenantDocuments.tenantUserId, tenantUserId));
    return reply.send(rows);
  });
}
