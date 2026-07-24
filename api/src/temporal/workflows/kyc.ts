import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/index.js";

const {
  extractKycDocument,
  runOfficialKycCheck,
  persistKycVerification,
  getDocumentKycVerification,
  getTenantDocumentKycVerification,
} = proxyActivities<typeof activities>({
  // Generous timeout: a vision-model call reading a scanned document can
  // run tens of seconds. Only 2 attempts — repeated retries on a genuinely
  // bad/expensive call aren't worth the extra Anthropic spend; a permanent
  // failure just lands the document in "failed" for someone to re-trigger.
  startToCloseTimeout: "90 seconds",
  retry: { maximumAttempts: 2 },
});

export interface KycVerificationWorkflowInput {
  documentSource: "document" | "tenant_document";
  documentId: string;
  storagePath: string;
  ownerId?: string;
  tenantId?: string;
  tenantUserId?: string;
}

// Started as an ABANDON-policy child from documents.ts / tenantProfile.ts /
// tenantIntake.ts right after a kyc-typed document row is created, so the
// upload request itself never waits on a vision-model round trip.
export async function kycVerificationWorkflow(input: KycVerificationWorkflowInput) {
  const base = {
    documentSource: input.documentSource,
    documentId: input.documentId,
    ownerId: input.ownerId ?? null,
    tenantId: input.tenantId ?? null,
    tenantUserId: input.tenantUserId ?? null,
  };

  try {
    const outcome = await extractKycDocument({ storagePath: input.storagePath });

    if (outcome.kind === "unsupported_file_type") {
      return persistKycVerification({
        ...base,
        docType: null,
        status: "manual_review",
        isValidDocument: null,
        extractedFields: null,
        qualityFlags: null,
        officialCheckStatus: null,
        officialCheckDetail: null,
        errorMessage: "File type isn't supported for automated extraction; needs manual review.",
      });
    }

    const { extraction } = outcome;

    if (!extraction.is_valid_document) {
      return persistKycVerification({
        ...base,
        docType: extraction.documentType,
        status: "rejected",
        isValidDocument: false,
        extractedFields: extraction.fields,
        qualityFlags: extraction.quality_flags,
        officialCheckStatus: null,
        officialCheckDetail: null,
        errorMessage: extraction.rejection_reason,
      });
    }

    const officialCheck =
      extraction.documentType === "unknown"
        ? { status: "not_configured" as const, provider: null, detail: null }
        : await runOfficialKycCheck({
            docType: extraction.documentType,
            documentNumber: extraction.fields.document_number,
            fullName: extraction.fields.full_name,
            dateOfBirth: extraction.fields.date_of_birth,
          });

    const hasQualityIssue = Object.values(extraction.quality_flags).some(Boolean);
    const hasMissingFields = extraction.missing_mandatory_fields.length > 0;
    const status =
      hasQualityIssue || hasMissingFields || officialCheck.status !== "verified" ? "manual_review" : "verified";

    return persistKycVerification({
      ...base,
      docType: extraction.documentType,
      status,
      isValidDocument: true,
      extractedFields: extraction.fields,
      qualityFlags: extraction.quality_flags,
      officialCheckStatus: officialCheck.status,
      officialCheckDetail: officialCheck.detail,
      errorMessage: null,
    });
  } catch (err) {
    return persistKycVerification({
      ...base,
      docType: null,
      status: "failed",
      isValidDocument: null,
      extractedFields: null,
      qualityFlags: null,
      officialCheckStatus: null,
      officialCheckDetail: null,
      errorMessage: err instanceof Error ? err.message : String(err),
    });
  }
}

export const getDocumentKycVerificationWorkflow = (input: Parameters<typeof getDocumentKycVerification>[0]) =>
  getDocumentKycVerification(input);
export const getTenantDocumentKycVerificationWorkflow = (
  input: Parameters<typeof getTenantDocumentKycVerification>[0],
) => getTenantDocumentKycVerification(input);
