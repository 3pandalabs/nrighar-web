import type { KycDocumentType } from "./schema.js";

export type OfficialVerificationStatus = "verified" | "mismatch" | "not_configured" | "error";

export interface OfficialVerificationInput {
  docType: KycDocumentType;
  documentNumber: string | null;
  fullName: string | null;
  dateOfBirth: string | null;
}

export interface OfficialVerificationResult {
  status: OfficialVerificationStatus;
  provider: string | null;
  detail: Record<string, unknown> | null;
}

// Real "official API" checks (PAN via an NSDL/Protean-empaneled verification
// API, Aadhaar via a UIDAI-authorized AUA/KUA or a licensed aggregator like
// Digio/Karza/IDfy/HyperVerge, passport via Passport Seva) all require their
// own paid empanelment/authorization this codebase doesn't have credentials
// for yet. Every branch below is therefore a stub that reports
// "not_configured" until a provider client + API key are wired in — nothing
// here is allowed to fabricate a "verified" result. kycVerificationWorkflow
// treats "not_configured" the same as "mismatch"/"error": send the document
// to manual_review, never to auto-verified.
export async function runOfficialVerification(input: OfficialVerificationInput): Promise<OfficialVerificationResult> {
  switch (input.docType) {
    case "pan_card":
      return verifyPan(input);
    case "aadhaar_card":
      return verifyAadhaar(input);
    case "passport":
      return verifyPassport(input);
  }
}

// TODO(kyc): call a real PAN verification provider here, keyed by
// process.env.PAN_VERIFICATION_API_KEY.
async function verifyPan(_input: OfficialVerificationInput): Promise<OfficialVerificationResult> {
  return { status: "not_configured", provider: null, detail: null };
}

// TODO(kyc): Aadhaar numbers are already masked to their last 4 digits by
// the time they reach here (see mask.ts) — a real provider integration for
// Aadhaar has to be a hosted/redirect-based e-KYC flow (OTP or biometric)
// rather than a raw-number lookup, since this pipeline deliberately never
// holds the full 12-digit number.
async function verifyAadhaar(_input: OfficialVerificationInput): Promise<OfficialVerificationResult> {
  return { status: "not_configured", provider: null, detail: null };
}

// TODO(kyc): call a real passport verification provider here, keyed by
// process.env.PASSPORT_VERIFICATION_API_KEY.
async function verifyPassport(_input: OfficialVerificationInput): Promise<OfficialVerificationResult> {
  return { status: "not_configured", provider: null, detail: null };
}
