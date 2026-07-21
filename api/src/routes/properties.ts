import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const propertyBody = z.object({
  nickname: z.string().min(1),
  addressLine1: z.string().min(1),
  addressLine2: z.string().optional(),
  city: z.string().min(1),
  state: z.string().min(1),
  pincode: z.string().min(1),
  propertyType: z
    .enum(["apartment", "independent_house", "villa", "plot", "commercial"])
    .default("apartment"),
  notes: z.string().optional(),
});

// Every route here is scoped `WHERE owner_id = req.userId` — this is the
// "owner_id = me" RLS-policy pattern, reproduced consistently across
// properties/tenants/leases/rent_payments/documents/pay_links/intake_links.
// A row that exists but belongs to someone else 404s, not 403s (don't leak
// existence).
export async function propertyRoutes(app: FastifyInstance) {
  app.get("/properties", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db.select().from(schema.properties).where(eq(schema.properties.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.post("/properties", { preHandler: requireAuth, schema: { body: propertyBody } }, async (req, reply) => {
    const [row] = await db
      .insert(schema.properties)
      .values({ ...(req.body as z.infer<typeof propertyBody>), ownerId: req.userId! })
      .returning();
    return reply.code(201).send(row);
  });

  app.get("/properties/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .select()
      .from(schema.properties)
      .where(and(eq(schema.properties.id, id), eq(schema.properties.ownerId, req.userId!)));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send(row);
  });

  app.patch(
    "/properties/:id",
    { preHandler: requireAuth, schema: { body: propertyBody.partial() } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const [row] = await db
        .update(schema.properties)
        .set(req.body as Partial<z.infer<typeof propertyBody>>)
        .where(and(eq(schema.properties.id, id), eq(schema.properties.ownerId, req.userId!)))
        .returning();
      if (!row) return reply.code(404).send({ error: "not_found" });
      return reply.send(row);
    },
  );

  app.delete("/properties/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .delete(schema.properties)
      .where(and(eq(schema.properties.id, id), eq(schema.properties.ownerId, req.userId!)))
      .returning({ id: schema.properties.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
