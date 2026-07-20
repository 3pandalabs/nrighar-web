import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth } from "../auth/plugin.js";
import { hasClaimedShare } from "../plugins/authz.js";
import { keyOwnerUserId, presignDownload, presignUpload } from "../plugins/r2.js";

const keyBody = z.object({ key: z.string().min(1) });

export async function storageRoutes(app: FastifyInstance) {
  app.post("/storage/presign-upload", { preHandler: requireAuth, schema: { body: keyBody } }, async (req, reply) => {
    const { key } = req.body as z.infer<typeof keyBody>;
    if (!key.startsWith(`${req.userId}/`)) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const url = await presignUpload(key);
    return reply.send({ url });
  });

  // Mirrors documents_bucket_select_own + documents_bucket_select_shared: the
  // caller may read a key under their own prefix, or under a tenant's prefix
  // if they hold a claimed share for that tenant. This is the storage-layer
  // half of the same check tenantShared.ts applies to metadata — both must
  // stay in sync via hasClaimedShare(), never a re-derived condition.
  app.post("/storage/presign-download", { preHandler: requireAuth, schema: { body: keyBody } }, async (req, reply) => {
    const { key } = req.body as z.infer<typeof keyBody>;
    const ownerUserId = keyOwnerUserId(key);
    if (!ownerUserId) return reply.code(400).send({ error: "invalid_key" });

    const isOwnKey = ownerUserId === req.userId;
    const isSharedTenantKey = !isOwnKey && (await hasClaimedShare(ownerUserId, req.userId!));
    if (!isOwnKey && !isSharedTenantKey) {
      return reply.code(403).send({ error: "forbidden" });
    }
    const url = await presignDownload(key);
    return reply.send({ url });
  });
}
