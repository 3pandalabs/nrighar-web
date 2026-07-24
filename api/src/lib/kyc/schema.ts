import { z } from "zod";

export const KYC_DOCUMENT_TYPES = ["pan_card", "aadhaar_card", "passport"] as const;
export type KycDocumentType = (typeof KYC_DOCUMENT_TYPES)[number];

// Mirrors the tool's input_schema in prompt.ts — kept as a separate zod
// schema so a malformed/hallucinated model response is caught by validation
// instead of trusted blindly. Every field nullable-not-optional so the model
// is forced to explicitly say "not present" rather than omitting it.
export const kycExtractionSchema = z.object({
  is_valid_document: z.boolean(),
  document_type: z.enum([...KYC_DOCUMENT_TYPES, "unknown"]),
  rejection_reason: z.string().nullable(),
  fields: z.object({
    full_name: z.string().nullable(),
    date_of_birth: z.string().nullable(),
    document_number: z.string().nullable(),
    gender: z.string().nullable(),
    address: z.string().nullable(),
    fathers_or_guardians_name: z.string().nullable(),
    issue_date: z.string().nullable(),
    expiry_date: z.string().nullable(),
    place_of_issue: z.string().nullable(),
    nationality: z.string().nullable(),
  }),
  missing_mandatory_fields: z.array(z.string()),
  quality_flags: z.object({
    blurred: z.boolean(),
    glare: z.boolean(),
    physically_damaged: z.boolean(),
    possible_digital_tampering: z.boolean(),
    layout_or_font_anomaly: z.boolean(),
  }),
  quality_notes: z.string().nullable(),
  confidence: z.number().min(0).max(1),
});

export type KycExtraction = z.infer<typeof kycExtractionSchema>;

// What actually gets persisted / returned over the API — document_number
// has already been through maskAadhaarNumber() for aadhaar_card by this
// point, so the raw 12-digit number never reaches storage or a response
// body.
export type KycExtractionResult = KycExtraction & { documentType: KycDocumentType | "unknown" };
