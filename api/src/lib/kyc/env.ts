import "dotenv/config";

// Deliberately NOT part of ../../env.js's required() checks: that file is
// imported by both the API server and the Temporal worker, and the KYC
// pipeline only actually runs inside the worker's extractKycDocument
// activity. Missing keys should disable KYC extraction (surfaced as a
// "failed" kyc_verifications row with a clear message), not crash either
// process at boot.
export const kycEnv = {
  anthropicApiKey: process.env.ANTHROPIC_API_KEY,
  model: process.env.ANTHROPIC_KYC_MODEL ?? "claude-sonnet-5",
};
