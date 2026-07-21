import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth, requireTenantRole } from "../auth/plugin.js";
import { deleteObject } from "../plugins/r2.js";

const patchBody = z.object({
  fullName: z.string().min(1).optional(),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  currentCity: z.string().optional(),
  employer: z.string().optional(),
  kycStatus: z.enum(["pending", "submitted", "verified"]).optional(),
});

const docBody = z.object({
  docType: z.enum(["agreement", "kyc", "property_paper", "tax", "other"]).default("other"),
  title: z.string().min(1),
  storagePath: z.string().min(1),
});

// Tenant's own profile + documents — "self" pattern, keyed on user_id = me
// rather than owner_id = me (tenant_profiles_all_own / tenant_documents_all_own).
export async function tenantProfileRoutes(app: FastifyInstance) {
  app.get(
    "/tenant-profile",
    { preHandler: [requireAuth, requireTenantRole] },
    async (req, reply) => {
      const [row] = await db.select().from(schema.tenantProfiles).where(eq(schema.tenantProfiles.userId, req.userId!));
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );

  app.patch(
    "/tenant-profile",
    { preHandler: [requireAuth, requireTenantRole], schema: { body: patchBody } },
    async (req, reply) => {
      const [row] = await db
        .update(schema.tenantProfiles)
        .set(req.body as z.infer<typeof patchBody>)
        .where(eq(schema.tenantProfiles.userId, req.userId!))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );

  app.get(
    "/tenant-documents",
    { preHandler: [requireAuth, requireTenantRole] },
    async (req, reply) => {
      const rows = await db
        .select()
        .from(schema.tenantDocuments)
        .where(eq(schema.tenantDocuments.tenantUserId, req.userId!));
      return reply.send(rows);
    },
  );

  app.post(
    "/tenant-documents",
    { preHandler: [requireAuth, requireTenantRole], schema: { body: docBody } },
    async (req, reply) => {
      const [row] = await db
        .insert(schema.tenantDocuments)
        .values({ ...(req.body as z.infer<typeof docBody>), tenantUserId: req.userId! })
        .returning();
      return reply.code(201).send(row);
    },
  );

  app.delete(
    "/tenant-documents/:id",
    { preHandler: [requireAuth, requireTenantRole] },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [existing] = await db
        .select({ storagePath: schema.tenantDocuments.storagePath })
        .from(schema.tenantDocuments)
        .where(and(eq(schema.tenantDocuments.id, id), eq(schema.tenantDocuments.tenantUserId, req.userId!)));
      if (!existing) return reply.code(404).send({ error: "not_found" });
      try {
        await deleteObject(existing.storagePath);
      } catch (err) {
        req.log.warn({ err, id }, "failed to delete R2 object for tenant document");
      }
      await db
        .delete(schema.tenantDocuments)
        .where(and(eq(schema.tenantDocuments.id, id), eq(schema.tenantDocuments.tenantUserId, req.userId!)));
      return reply.code(204).send();
    },
  );
}
