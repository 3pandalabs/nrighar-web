import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireTenantRole } from "../auth/plugin.js";
import { sendWorkflow } from "../temporal/runWorkflow.js";

const createBody = z.object({
  propertyId: z.string().uuid(),
  baseRentAsk: z.number().positive(),
});

// Owner-side listing management (implicit owner scope, same pattern as
// properties.ts/tenants.ts) plus a tenant-facing browse endpoint. Applying
// to a listing is POST /listings/:id/applications — see routes/applications.ts.
export async function listingRoutes(app: FastifyInstance) {
  app.get("/listings", { preHandler: requireAuth }, async (req, reply) => {
    return sendWorkflow(reply, "listOwnListingsWorkflow", [{ ownerId: req.userId! }]);
  });

  app.post("/listings", { preHandler: requireAuth, schema: { body: createBody } }, async (req, reply) => {
    const body = req.body as z.infer<typeof createBody>;
    return sendWorkflow(
      reply,
      "createListingWorkflow",
      [{ ownerId: req.userId!, propertyId: body.propertyId, baseRentAsk: body.baseRentAsk }],
      201,
    );
  });

  app.patch("/listings/:id", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendWorkflow(reply, "closeListingWorkflow", [{ id, ownerId: req.userId! }]);
  });

  app.get("/listings/browse", { preHandler: [requireAuth, requireTenantRole] }, async (_req, reply) => {
    return sendWorkflow(reply, "browseOpenListingsWorkflow", []);
  });
}
