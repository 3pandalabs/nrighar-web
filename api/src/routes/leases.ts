import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const leaseBody = z.object({
  propertyId: z.string().uuid(),
  tenantId: z.string().uuid(),
  rentAmount: z.number().positive(),
  depositAmount: z.number().nonnegative().optional(),
  startDate: z.string(),
  endDate: z.string().optional(),
  rentDueDay: z.number().int().min(1).max(28).default(1),
  status: z.enum(["active", "ended"]).default("active"),
});

// Note beyond the original RLS: the Supabase policy only ever checked
// `owner_id = auth.uid()` on the leases row itself, not that propertyId/
// tenantId actually belong to that owner (no such FK-content check existed).
// We close that gap here since it's a one-query addition — verify both
// references are the caller's own before creating a lease.
async function assertOwnsPropertyAndTenant(ownerId: string, propertyId: string, tenantId: string) {
  const [property] = await db
    .select({ id: schema.properties.id })
    .from(schema.properties)
    .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.ownerId, ownerId)));
  const [tenant] = await db
    .select({ id: schema.tenants.id })
    .from(schema.tenants)
    .where(and(eq(schema.tenants.id, tenantId), eq(schema.tenants.ownerId, ownerId)));
  return Boolean(property) && Boolean(tenant);
}

export async function leaseRoutes(app: FastifyInstance) {
  app.get("/leases", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db.select().from(schema.leases).where(eq(schema.leases.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.post("/leases", { preHandler: requireAuth, schema: { body: leaseBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof leaseBody>;
    if (!(await assertOwnsPropertyAndTenant(req.userId!, body.propertyId, body.tenantId))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const [row] = await db
      .insert(schema.leases)
      .values({
        ...body,
        rentAmount: String(body.rentAmount),
        depositAmount: body.depositAmount !== undefined ? String(body.depositAmount) : undefined,
        ownerId: req.userId!,
      })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/leases/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select()
      .from(schema.leases)
      .where(and(eq(schema.leases.id, id), eq(schema.leases.ownerId, req.userId!)));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  app.patch(
    "/leases/:id",
    { preHandler: requireAuth, schema: { body: leaseBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as Partial<z.infer<typeof leaseBody>>;
      const { rentAmount, depositAmount, ...rest } = body;
      const [row] = await db
        .update(schema.leases)
        .set({
          ...rest,
          ...(rentAmount !== undefined ? { rentAmount: String(rentAmount) } : {}),
          ...(depositAmount !== undefined ? { depositAmount: String(depositAmount) } : {}),
        })
        .where(and(eq(schema.leases.id, id), eq(schema.leases.ownerId, req.userId!)))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );

  app.delete("/leases/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .delete(schema.leases)
      .where(and(eq(schema.leases.id, id), eq(schema.leases.ownerId, req.userId!)))
      .returning({ id: schema.leases.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
