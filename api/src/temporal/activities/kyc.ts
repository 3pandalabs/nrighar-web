import { and, desc, eq } from "drizzle-orm";
import { ApplicationFailure } from "@temporalio/common";
import { db, schema } from "../../db/index.js";
import { getObject } from "../../plugins/r2.js";
import { kycEnv } from "../../lib/kyc/env.js";
import { extractKycDocument as runExtraction, isExtractableExtension } from "../../lib/kyc/extract.js";
import { runOfficialVerification, type OfficialVerificationInput } from "../../lib/kyc/officialVerify.js";
import type { KycExtractionResult, KycDocumentType } from "../../lib/kyc/schema.js";

export type KycExtractionOutcome =
  | { kind: "extracted"; extraction: KycExtractionResult }
  | { kind: "unsupported_file_type" };

// Split from persistKycVerification below so a slow/flaky Claude call
// retries independently of the (fast, idempotent) DB write — matches the
// retry-granularity pattern the rest of this codebase uses for
// activity/workflow splits.
export async function extractKycDocument(input: { storagePath: string }): Promise<KycExtractionOutcome> {
  const ext = input.storagePath.split(".").pop() ?? "";
  if (!isExtractableExtension(ext)) {
    return { kind: "unsupported_file_type" };
  }
  if (!kycEnv.anthropicApiKey) {
    throw ApplicationFailure.create({
      message: "KYC extraction not configured: ANTHROPIC_API_KEY is missing on the Temporal worker",
      type: "kyc_not_configured",
      nonRetryable: true,
    });
  }
  const { buffer } = await getObject(input.storagePath);
  const extraction = await runExtraction(buffer, ext);
  return { kind: "extracted", extraction };
}

export async function runOfficialKycCheck(input: OfficialVerificationInput) {
  return runOfficialVerification(input);
}

type PersistKycVerificationInput = {
  documentSource: "document" | "tenant_document";
  documentId: string;
  ownerId: string | null;
  tenantId: string | null;
  tenantUserId: string | null;
  docType: KycDocumentType | "unknown" | null;
  status: "manual_review" | "rejected" | "verified" | "failed";
  isValidDocument: boolean | null;
  extractedFields: Record<string, unknown> | null;
  qualityFlags: Record<string, unknown> | null;
  officialCheckStatus: string | null;
  officialCheckDetail: Record<string, unknown> | null;
  errorMessage: string | null;
};

export async function persistKycVerification(input: PersistKycVerificationInput) {
  const [row] = await db.insert(schema.kycVerifications).values(input).returning({ id: schema.kycVerifications.id });

  // The only automated path that ever promotes a tenant's coarse-grained
  // kyc_status to 'verified' — self-service PATCHes from the tenant no
  // longer accept a kycStatus value at all (see routes/tenantProfile.ts).
  if (input.status === "verified") {
    if (input.tenantId) {
      await db.update(schema.tenants).set({ kycStatus: "verified" }).where(eq(schema.tenants.id, input.tenantId));
    }
    if (input.tenantUserId) {
      await db
        .update(schema.tenantProfiles)
        .set({ kycStatus: "verified" })
        .where(eq(schema.tenantProfiles.userId, input.tenantUserId));
    }
  }

  return row;
}

async function getKycVerification(input: { documentSource: "document" | "tenant_document"; documentId: string }) {
  const [row] = await db
    .select()
    .from(schema.kycVerifications)
    .where(
      and(
        eq(schema.kycVerifications.documentSource, input.documentSource),
        eq(schema.kycVerifications.documentId, input.documentId),
      ),
    )
    .orderBy(desc(schema.kycVerifications.createdAt))
    .limit(1);
  return row ?? null;
}

// Authz-checked read paths for the GET .../kyc-verification routes — confirm
// the caller owns the document row before returning anything, same
// ownerId/tenantUserId-scoping pattern as every other route in this app.
export async function getDocumentKycVerification(input: { documentId: string; ownerId: string }) {
  const [doc] = await db
    .select({ id: schema.documents.id })
    .from(schema.documents)
    .where(and(eq(schema.documents.id, input.documentId), eq(schema.documents.ownerId, input.ownerId)));
  if (!doc) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  return getKycVerification({ documentSource: "document", documentId: input.documentId });
}

export async function getTenantDocumentKycVerification(input: { documentId: string; userId: string }) {
  const [doc] = await db
    .select({ id: schema.tenantDocuments.id })
    .from(schema.tenantDocuments)
    .where(
      and(eq(schema.tenantDocuments.id, input.documentId), eq(schema.tenantDocuments.tenantUserId, input.userId)),
    );
  if (!doc) throw ApplicationFailure.create({ type: "not_found", nonRetryable: true });
  return getKycVerification({ documentSource: "tenant_document", documentId: input.documentId });
}
