import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const patchBody = z.object({
  displayName: z.string().optional(),
  countryOfResidence: z.string().optional(),
  preferredCurrency: z.string().optional(),
  upiVpa: z.string().optional(),
  upiName: z.string().optional(),
});

export async function profileRoutes(app: FastifyInstance) {
  app.get("/profile", { preHandler: requireAuth }, async (req, reply) => {
    const [profile] = await db.select().from(schema.profiles).where(eq(schema.profiles.id, req.userId!));
    if (!profile) return reply.code(404).send({ error: "not_found" });
    return reply.send(profile);
  });

  app.patch("/profile", { preHandler: requireAuth, schema: { body: patchBody } }, async (req, reply) => {
    const [updated] = await db
      .update(schema.profiles)
      .set(req.body as z.infer<typeof patchBody>)
      .where(eq(schema.profiles.id, req.userId!))
      .returning();
    if (!updated) return reply.code(404).send({ error: "not_found" });
    return reply.send(updated);
  });
}
