import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth, requireTenantRole } from "../auth/plugin.js";
import { findOrLinkOwnerTenant } from "../lib/findOrLinkOwnerTenant.js";

const createBody = z.object({ propertyId: z.string().uuid().optional() });

export async function intakeLinkRoutes(app: FastifyInstance) {
  // Owner-scoped list, mirroring intake_links_all_own's full-CRUD-including-
  // SELECT RLS policy — dashboard "pending invites" view needs this.
  app.get("/intake-links", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db
      .select()
      .from(schema.intakeLinks)
      .where(eq(schema.intakeLinks.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.post("/intake-links", { preHandler: requireAuth, schema: { body: createBody } }, async (req, reply) => {
    const { propertyId } = req.body as z.infer<typeof createBody>;
    if (propertyId) {
      const [property] = await db
        .select({ id: schema.properties.id })
        .from(schema.properties)
        .where(and(eq(schema.properties.id, propertyId), eq(schema.properties.ownerId, req.userId!)));
      if (!property) return reply.code(404).send({ error: "not_found" });
    }
    const [row] = await db.insert(schema.intakeLinks).values({ ownerId: req.userId!, propertyId }).returning();
    return reply.code(201).send(row);
  });

  // Mirrors get_intake_link(p_token): status/expired/owner+property display data.
  app.get("/intake-links/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const [row] = await db
      .select({
        status: schema.intakeLinks.status,
        expiresAt: schema.intakeLinks.expiresAt,
        ownerDisplayName: schema.profiles.displayName,
        propertyNickname: schema.properties.nickname,
        propertyCity: schema.properties.city,
      })
      .from(schema.intakeLinks)
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.intakeLinks.ownerId))
      .leftJoin(schema.properties, eq(schema.properties.id, schema.intakeLinks.propertyId))
      .where(eq(schema.intakeLinks.id, token));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send({
      status: row.status,
      expired: row.expiresAt < new Date(),
      ownerName: row.ownerDisplayName ?? "Your landlord",
      propertyNickname: row.propertyNickname,
      propertyCity: row.propertyCity,
    });
  });

  // Mirrors 0008's accept_intake_as_tenant: validate pending+not-expired,
  // insert a pre-claimed profile_shares row (accepting the invite IS the
  // consent), bridge via findOrLinkOwnerTenant, mark the link submitted.
  app.post(
    "/intake-links/:token/accept",
    { preHandler: [requireAuth, requireTenantRole] },
    async (req, reply) => {
      const { token } = req.params as { token: string };
      const [link] = await db.select().from(schema.intakeLinks).where(eq(schema.intakeLinks.id, token));
      if (!link) return reply.code(404).send({ error: "not_found" });
      if (link.status !== "pending") return reply.code(409).send({ error: "already_used" });
      if (link.expiresAt < new Date()) return reply.code(410).send({ error: "expired" });

      const [tenantProfile] = await db
        .select({ userId: schema.tenantProfiles.userId })
        .from(schema.tenantProfiles)
        .where(eq(schema.tenantProfiles.userId, req.userId!));
      if (!tenantProfile) return reply.code(422).send({ error: "no_tenant_profile" });

      await db.insert(schema.profileShares).values({
        tenantUserId: req.userId!,
        ownerId: link.ownerId,
        status: "claimed",
        claimedAt: new Date(),
      });

      const tenantId = await findOrLinkOwnerTenant(link.ownerId, req.userId!, "Self-registered via intake link");

      await db
        .update(schema.intakeLinks)
        .set({ status: "submitted", tenantId, submittedAt: new Date() })
        .where(eq(schema.intakeLinks.id, token));

      return reply.send({ ok: true });
    },
  );

  app.delete("/intake-links/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .delete(schema.intakeLinks)
      .where(and(eq(schema.intakeLinks.id, id), eq(schema.intakeLinks.ownerId, req.userId!)))
      .returning({ id: schema.intakeLinks.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
