import type { FastifyInstance } from "fastify";
import { and, eq } from "drizzle-orm";
import { z } from "zod";
import { db, schema } from "../db/index.js";
import { requireAuth } from "../auth/plugin.js";

const upsertBody = z.object({
  leaseId: z.string().uuid(),
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
  amountDue: z.number().nonnegative(),
  amountPaid: z.number().nonnegative().optional(),
  paidOn: z.string().optional(),
  method: z.enum(["bank_transfer", "upi", "cash", "other"]).optional(),
  status: z.enum(["due", "paid", "partial"]).default("due"),
  notes: z.string().optional(),
});

async function assertOwnsLease(ownerId: string, leaseId: string) {
  const [lease] = await db
    .select({ id: schema.leases.id })
    .from(schema.leases)
    .where(and(eq(schema.leases.id, leaseId), eq(schema.leases.ownerId, ownerId)));
  return Boolean(lease);
}

// One row per lease per month; the original app upserts rather than doing
// separate create/update flows — mirror that with onConflictDoUpdate on the
// (lease_id, period_year, period_month) unique constraint.
export async function rentPaymentRoutes(app: FastifyInstance) {
  app.get("/rent-payments", { preHandler: requireAuth }, async (req, reply) => {
    const rows = await db.select().from(schema.rentPayments).where(eq(schema.rentPayments.ownerId, req.userId!));
    return reply.send(rows);
  });

  app.put("/rent-payments", { preHandler: requireAuth, schema: { body: upsertBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof upsertBody>;
    if (!(await assertOwnsLease(req.userId!, body.leaseId))) {
      return reply.code(404).send({ error: "not_found" });
    }
    const values = {
      ownerId: req.userId!,
      leaseId: body.leaseId,
      periodYear: body.periodYear,
      periodMonth: body.periodMonth,
      amountDue: String(body.amountDue),
      amountPaid: body.amountPaid !== undefined ? String(body.amountPaid) : undefined,
      paidOn: body.paidOn,
      method: body.method,
      status: body.status,
      notes: body.notes,
    };
    const [row] = await db
      .insert(schema.rentPayments)
      .values(values)
      .onConflictDoUpdate({
        target: [schema.rentPayments.leaseId, schema.rentPayments.periodYear, schema.rentPayments.periodMonth],
        set: values,
      })
      .returning();
    return reply.send(row);
  });

  app.delete("/rent-payments/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    const [row] = await db
      .delete(schema.rentPayments)
      .where(and(eq(schema.rentPayments.id, id), eq(schema.rentPayments.ownerId, req.userId!)))
      .returning({ id: schema.rentPayments.id });
    if (!row) return reply.code(404).send({ error: "not_found" });
    return reply.code(204).send();
  });
}
