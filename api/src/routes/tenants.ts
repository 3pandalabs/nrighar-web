import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const tenantBody = z.object({
  fullName: z.string().min(1),
  phone: z.string().optional(),
  email: z.string().email().optional(),
  kycStatus: z.enum(["pending", "submitted", "verified"]).default("pending"),
  notes: z.string().optional(),
});

// Owner-side tenant records — owner_id = me pattern, same as properties.ts.
export async function tenantRoutes(app: FastifyInstance) {
  app.get("/tenants", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db.select().from(schema.tenants).where(eq(schema.tenants.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.post("/tenants", { preHandler: requireAuth, schema: { body: tenantBody } }, async (req, reply) => {
    const [row] = await db
      .insert(schema.tenants)
      .values({ ...(req.body as z.infer<typeof tenantBody>), ownerId: req.userId! })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/tenants/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select()
      .from(schema.tenants)
      .where(and(eq(schema.tenants.id, id), eq(schema.tenants.ownerId, req.userId!)));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  app.patch(
    "/tenants/:id",
    { preHandler: requireAuth, schema: { body: tenantBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db
        .update(schema.tenants)
        .set(req.body as Partial<z.infer<typeof tenantBody>>)
        .where(and(eq(schema.tenants.id, id), eq(schema.tenants.ownerId, req.userId!)))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );

  app.delete("/tenants/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .delete(schema.tenants)
      .where(and(eq(schema.tenants.id, id), eq(schema.tenants.ownerId, req.userId!)))
      .returning({ id: schema.tenants.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
