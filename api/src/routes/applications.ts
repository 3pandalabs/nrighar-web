import type { FastifyInstance } from "fastify";
import { z } from "zod";
import { requireAuth, requireTenantRole } from "../auth/plugin.js";
import { sendWorkflow } from "../temporal/runWorkflow.js";

const submitBody = z.object({
  proposedRent: z.number().positive(),
  moveInDate: z.string(),
  monthlyIncome: z.number().positive().optional(),
  profileHighlights: z.string().max(2000).optional(),
});

const decideBody = z.object({ status: z.enum(["approved", "rejected"]) });

export async function applicationRoutes(app: FastifyInstance) {
  // submit_property_application
  app.post(
    "/listings/:id/applications",
    { preHandler: [requireAuth, requireTenantRole], schema: { body: submitBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const body = req.body as z.infer<typeof submitBody>;
      return sendWorkflow(
        reply,
        "submitApplicationWorkflow",
        [{ applicantUserId: req.userId!, listingId: id, ...body }],
        201,
      );
    },
  );

  // Applicant's own status tracking across every listing they've applied to.
  app.get("/applications", { preHandler: [requireAuth, requireTenantRole] }, async (req, reply) => {
    return sendWorkflow(reply, "listOwnApplicationsWorkflow", [{ applicantUserId: req.userId! }]);
  });

  // get_property_applications
  app.get("/listings/:id/applications", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendWorkflow(reply, "getListingApplicationsWorkflow", [{ listingId: id, ownerId: req.userId! }]);
  });

  // trigger_tenant_kyc_flow
  app.post("/applications/:id/request-kyc", { preHandler: requireAuth }, async (req, reply) => {
    const { id } = req.params as { id: string };
    return sendWorkflow(reply, "requestKycForApplicationWorkflow", [{ applicationId: id, ownerId: req.userId! }]);
  });

  app.patch(
    "/applications/:id",
    { preHandler: requireAuth, schema: { body: decideBody } },
    async (req, reply) => {
      const { id } = req.params as { id: string };
      const { status } = req.body as z.infer<typeof decideBody>;
      return sendWorkflow(reply, "decideApplicationWorkflow", [{ applicationId: id, ownerId: req.userId!, status }]);
    },
  );
}
