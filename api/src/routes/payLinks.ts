import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const createBody = z.object({
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amountDue: z.number().nonnegative(),
});

// Ports 0005_upi_pay_links.sql's three SECURITY DEFINER RPCs. The pay_links
// table itself has no anon grants in the old schema — here that's just "no
// requireAuth on these three routes" plus the id being an unguessable UUID.
// Anonymous callers can only ever hit these narrow routes, never a generic
// pay_links CRUD endpoint (there isn't one).
export async function payLinkRoutes(app: FastifyInstance) {
  // Owner-scoped list — the old Supabase RLS policy (pay_links_all_own) let an
  // owner SELECT all their own rows, not just fetch one by token; there was no
  // single-item-only restriction to preserve. Dashboard/mobile "rent ledger"
  // views need this to show sent/opened/claimed status without already
  // knowing every token.
  app.get("/pay-links", { preHandler: requireAuth }, async (req, reply) => {
    const { leaseId } = req.query as { leaseId?: string };
    const conditions = [eq(schema.payLinks.ownerId, req.userId!)];
    if (leaseId) conditions.push(eq(schema.payLinks.leaseId, leaseId));
    const rows = await db
      .select()
      .from(schema.payLinks)
      .where(and(...conditions));
    return reply.send(rows);
  });

  app.post(
    "/leases/:leaseId/pay-links",
    { preHandler: requireAuth, schema: { body: createBody } },
    async (req, reply) => {
      const { leaseId } = req.params as { leaseId: string };
      const body = req.body as z.infer<typeof createBody>;
      const [lease] = await db
        .select()
        .from(schema.leases)
        .where(and(eq(schema.leases.id, leaseId), eq(schema.leases.ownerId, req.userId!)));
      if (!lease) return reply.code(404).send({ error: "not_found" });

      const [row] = await db
        .insert(schema.payLinks)
        .values({
          ownerId: req.userId!,
          leaseId,
          periodYear: body.periodYear,
          periodMonth: body.periodMonth,
          amountDue: String(body.amountDue),
        })
        .onConflictDoUpdate({
          target: [schema.payLinks.leaseId, schema.payLinks.periodYear, schema.payLinks.periodMonth],
          set: { amountDue: String(body.amountDue) },
        })
        .returning();
      return reply.code(201).send(row);
    },
  );

  // Mirrors get_pay_link(p_token): join lease -> property/tenant, left-join
  // profiles for the owner's UPI details.
  app.get("/pay-links/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    const [row] = await db
      .select({
        amountDue: schema.payLinks.amountDue,
        periodYear: schema.payLinks.periodYear,
        periodMonth: schema.payLinks.periodMonth,
        propertyNickname: schema.properties.nickname,
        propertyCity: schema.properties.city,
        tenantName: schema.tenants.fullName,
        ownerUpiVpa: schema.profiles.upiVpa,
        ownerUpiName: schema.profiles.upiName,
        ownerDisplayName: schema.profiles.displayName,
        claimedPaidAt: schema.payLinks.claimedPaidAt,
      })
      .from(schema.payLinks)
      .innerJoin(schema.leases, eq(schema.leases.id, schema.payLinks.leaseId))
      .innerJoin(schema.properties, eq(schema.properties.id, schema.leases.propertyId))
      .innerJoin(schema.tenants, eq(schema.tenants.id, schema.leases.tenantId))
      .leftJoin(schema.profiles, eq(schema.profiles.id, schema.payLinks.ownerId))
      .where(eq(schema.payLinks.id, token));
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.send({ ...row, ownerUpiName: row.ownerUpiName ?? row.ownerDisplayName });
  });

  app.post("/pay-links/:token/open", async (req, reply) => {
    const { token } = req.params as { token: string };
    const [row] = await db.select({ openedAt: schema.payLinks.openedAt }).from(schema.payLinks).where(eq(schema.payLinks.id, token));
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (!row.openedAt) {
      await db.update(schema.payLinks).set({ openedAt: new Date() }).where(eq(schema.payLinks.id, token));
    }
    return reply.code(204).send();
  });

  app.post("/pay-links/:token/claim-paid", async (req, reply) => {
    const { token } = req.params as { token: string };
    const [row] = await db.select({ claimedPaidAt: schema.payLinks.claimedPaidAt }).from(schema.payLinks).where(eq(schema.payLinks.id, token));
    if (!row) return reply.code(404).send({ error: "not_found" });
    if (!row.claimedPaidAt) {
      await db.update(schema.payLinks).set({ claimedPaidAt: new Date() }).where(eq(schema.payLinks.id, token));
    }
    return reply.code(204).send();
  });
}
