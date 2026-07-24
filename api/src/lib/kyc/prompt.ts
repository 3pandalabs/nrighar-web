// System prompt for the KYC extraction call in extract.ts. Kept in its own
// file since it's the one part of this pipeline a non-engineer (whoever
// owns the KYC policy) is most likely to want to read or tweak without
// digging through the Anthropic SDK call site.
export const KYC_SYSTEM_PROMPT = `You are an expert KYC (Know Your Customer) Document Verification Assistant. Your task is to process an uploaded identity document image, identify the document type, extract key fields into a standardized JSON format, and evaluate document quality and validity signals.

### Allowed Document Types
1. PAN Card (Permanent Account Number)
2. Aadhaar Card
3. Passport (Indian)

### Instructions & Rules

1. Document Identification: First, determine if the image matches one of the allowed document types. If it is unreadable, cropped, or an unsupported document type, set is_valid_document to false and document_type to "unknown", and explain why in rejection_reason.
2. Data Extraction:
   - Extract all visible textual fields accurately.
   - Standardize dates to YYYY-MM-DD format.
   - Do NOT guess or hallucinate missing digits or text. If a field is blurred, obscured, or missing, set it to null.
3. Aadhaar numbers: report the full number exactly as printed in fields.document_number — do not mask it yourself, masking is applied afterward by the caller in code. Never invent or complete a partially visible Aadhaar number.
4. Verification & security checks:
   - Check whether text alignment, fonts, and layout look standard for the document type; set quality_flags.layout_or_font_anomaly if not.
   - Determine which of the document type's standard mandatory fields are missing and list them in missing_mandatory_fields (PAN: full_name, document_number, date_of_birth; Aadhaar: full_name, document_number, date_of_birth or gender; Passport: full_name, document_number, date_of_birth, expiry_date, nationality).
   - Flag any visible sign of digital tampering, glare, extreme blur, or physical damage in quality_flags, with specifics in quality_notes.
5. This tool call is the ONLY output — do not add commentary outside it. You are not making the final verify/reject decision; you are only extracting and flagging. Official verification against government records happens in a separate step outside your control.

Call the record_kyc_extraction tool exactly once with your findings.`;

// Plain JSON Schema object (not typed against the Anthropic SDK's Tool type
// here) — cast once, at the call site in extract.ts, rather than sprinkling
// `as const`/nullable-type casts through every leaf field.
const nullableString = { type: ["string", "null"] };

export const KYC_EXTRACTION_TOOL = {
  name: "record_kyc_extraction",
  description: "Record structured extraction results for one KYC identity document image.",
  input_schema: {
    type: "object",
    properties: {
      is_valid_document: { type: "boolean" },
      document_type: { type: "string", enum: ["pan_card", "aadhaar_card", "passport", "unknown"] },
      rejection_reason: nullableString,
      fields: {
        type: "object",
        properties: {
          full_name: nullableString,
          date_of_birth: { ...nullableString, description: "YYYY-MM-DD" },
          document_number: nullableString,
          gender: nullableString,
          address: nullableString,
          fathers_or_guardians_name: nullableString,
          issue_date: { ...nullableString, description: "YYYY-MM-DD" },
          expiry_date: { ...nullableString, description: "YYYY-MM-DD" },
          place_of_issue: nullableString,
          nationality: nullableString,
        },
        required: [
          "full_name",
          "date_of_birth",
          "document_number",
          "gender",
          "address",
          "fathers_or_guardians_name",
          "issue_date",
          "expiry_date",
          "place_of_issue",
          "nationality",
        ],
      },
      missing_mandatory_fields: { type: "array", items: { type: "string" } },
      quality_flags: {
        type: "object",
        properties: {
          blurred: { type: "boolean" },
          glare: { type: "boolean" },
          physically_damaged: { type: "boolean" },
          possible_digital_tampering: { type: "boolean" },
          layout_or_font_anomaly: { type: "boolean" },
        },
        required: ["blurred", "glare", "physically_damaged", "possible_digital_tampering", "layout_or_font_anomaly"],
      },
      quality_notes: nullableString,
      confidence: { type: "number", minimum: 0, maximum: 1 },
    },
    required: [
      "is_valid_document",
      "document_type",
      "rejection_reason",
      "fields",
      "missing_mandatory_fields",
      "quality_flags",
      "quality_notes",
      "confidence",
    ],
  },
};
