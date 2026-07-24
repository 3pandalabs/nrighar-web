import { proxyActivities, startChild } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { kycVerificationWorkflow } from "./kyc.js";

const { validateIntakeLinkForSubmission, finalizeIntakeSubmission } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

export const validateIntakeLinkForSubmissionWorkflow = (
  input: Parameters<typeof validateIntakeLinkForSubmission>[0],
) => validateIntakeLinkForSubmission(input);

export const finalizeIntakeSubmissionWorkflow = async (input: Parameters<typeof finalizeIntakeSubmission>[0]) => {
  const result = await finalizeIntakeSubmission(input);
  for (const doc of result.documents) {
    await startChild(kycVerificationWorkflow, {
      workflowId: `kyc-verify-document-${doc.id}`,
      args: [
        { documentSource: "document", documentId: doc.id, storagePath: doc.storagePath, ownerId: result.ownerId, tenantId: result.tenantId },
      ],
      parentClosePolicy: "ABANDON",
    });
  }
  // Keep the anonymous caller's response shape unchanged — internal ids
  // (tenantId, per-file storagePath) stay server-side.
  return { ok: result.ok };
};
