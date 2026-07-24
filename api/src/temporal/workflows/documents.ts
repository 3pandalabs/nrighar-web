import { proxyActivities, startChild } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { kycVerificationWorkflow } from "./kyc.js";

const { listDocuments, createDocument, deleteDocument } = proxyActivities<typeof activities>({
  startToCloseTimeout: "10 seconds",
  retry: { maximumAttempts: 3 },
});

export const listDocumentsWorkflow = (input: Parameters<typeof listDocuments>[0]) => listDocuments(input);

export const createDocumentWorkflow = async (input: Parameters<typeof createDocument>[0]) => {
  const row = await createDocument(input);
  // Fire-and-forget: ABANDON so the child keeps running (and its result
  // lands in kyc_verifications) even after this workflow returns the
  // create response to the HTTP caller.
  if (row.docType === "kyc") {
    await startChild(kycVerificationWorkflow, {
      workflowId: `kyc-verify-document-${row.id}`,
      args: [{ documentSource: "document", documentId: row.id, storagePath: row.storagePath, ownerId: row.ownerId }],
      parentClosePolicy: "ABANDON",
    });
  }
  return row;
};

export const deleteDocumentWorkflow = (input: Parameters<typeof deleteDocument>[0]) => deleteDocument(input);
