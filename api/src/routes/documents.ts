import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";
import { deleteObject } from "../plugins/r2.js";

const documentBody = z.object({
  propertyId: z.string().uuid().optional(),
  leaseId: z.string().uuid().optional(),
  docType: z.enum(["agreement", "kyc", "property_paper", "tax", "other"]).default("other"),
  title: z.string().min(1),
  storagePath: z.string().min(1),
});

// Owner-side document metadata rows. storagePath must be under the caller's
// own R2 key prefix — enforced by /storage/presign-upload requiring the same
// prefix, so a row here can only ever point at a file the caller could upload.
export async function documentRoutes(app: FastifyInstance) {
  app.get("/documents", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db.select().from(schema.documents).where(eq(schema.documents.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.post("/documents", { preHandler: requireAuth, schema: { body: documentBody } }, async (req, reply) => {
    const [row] = await db
      .insert(schema.documents)
      .values({ ...(req.body as z.infer<typeof documentBody>), ownerId: req.userId! })
      .returning();
    return reply.code(201).send(row);
  });

  app.delete("/documents/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [existing] = await db
      .select({ storagePath: schema.documents.storagePath })
      .from(schema.documents)
      .where(and(eq(schema.documents.id, id), eq(schema.documents.ownerId, req.userId!)));
    if (!existing) return reply.code(404).send({ error: "not_found" });
    try {
      await deleteObject(existing.storagePath);
    } catch (err) {
      req.log.warn({ err, id }, "failed to delete R2 object for document");
    }
    await db.delete(schema.documents).where(and(eq(schema.documents.id, id), eq(schema.documents.ownerId, req.userId!)));
    return reply.code(204).send();
  });
}
