import { proxyActivities, startChild } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";
import { kycVerificationWorkflow } from "./kyc.js";

const { getTenantProfile, updateTenantProfile, listTenantDocuments, createTenantDocument, deleteTenantDocument } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "10 seconds",
    retry: { maximumAttempts: 3 },
  });

export const getTenantProfileWorkflow = (input: Parameters<typeof getTenantProfile>[0]) => getTenantProfile(input);
export const updateTenantProfileWorkflow = (input: Parameters<typeof updateTenantProfile>[0]) =>
  updateTenantProfile(input);
export const listTenantDocumentsWorkflow = (input: Parameters<typeof listTenantDocuments>[0]) =>
  listTenantDocuments(input);

export const createTenantDocumentWorkflow = async (input: Parameters<typeof createTenantDocument>[0]) => {
  const row = await createTenantDocument(input);
  if (row.docType === "kyc") {
    await startChild(kycVerificationWorkflow, {
      workflowId: `kyc-verify-tenant-document-${row.id}`,
      args: [
        {
          documentSource: "tenant_document",
          documentId: row.id,
          storagePath: row.storagePath,
          tenantUserId: row.tenantUserId,
        },
      ],
      parentClosePolicy: "ABANDON",
    });
  }
  return row;
};

export const deleteTenantDocumentWorkflow = (input: Parameters<typeof deleteTenantDocument>[0]) =>
  deleteTenantDocument(input);
