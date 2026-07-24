import Anthropic from "@anthropic-ai/sdk";
import type { ContentBlockParam } from "@anthropic-ai/sdk/resources/messages";
import { kycEnv } from "./env.js";
import { maskAadhaarNumber } from "./mask.js";
import { KYC_EXTRACTION_TOOL, KYC_SYSTEM_PROMPT } from "./prompt.js";
import { kycExtractionSchema, type KycExtractionResult } from "./schema.js";

const IMAGE_MEDIA_TYPES: Record<string, string> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  webp: "image/webp",
};

let client: Anthropic | undefined;
function getClient(): Anthropic {
  if (!kycEnv.anthropicApiKey) {
    throw new Error("KYC extraction not configured: ANTHROPIC_API_KEY is missing");
  }
  if (!client) client = new Anthropic({ apiKey: kycEnv.anthropicApiKey });
  return client;
}

// Extensions the tenant-intake/document upload routes already accept
// (documents.ts route, tenantIntake.ts route) that this pipeline can
// actually read. xml/zip (DigiLocker offline-KYC exports) need a different,
// signature-based verification path — out of scope here, callers should
// leave those as manual_review rather than routing them through extraction.
export function isExtractableExtension(ext: string): boolean {
  return ext in IMAGE_MEDIA_TYPES || ext === "pdf";
}

export async function extractKycDocument(buffer: Buffer, ext: string): Promise<KycExtractionResult> {
  const normalizedExt = ext.toLowerCase();
  const content: ContentBlockParam[] =
    normalizedExt === "pdf"
      ? [
          {
            type: "document",
            source: { type: "base64", media_type: "application/pdf", data: buffer.toString("base64") },
          },
        ]
      : [
          {
            type: "image",
            source: {
              type: "base64",
              media_type: (IMAGE_MEDIA_TYPES[normalizedExt] ?? "image/jpeg") as "image/jpeg",
              data: buffer.toString("base64"),
            },
          },
        ];
  content.push({ type: "text", text: "Extract this KYC document per your instructions." });

  const response = await getClient().messages.create({
    model: kycEnv.model,
    max_tokens: 1536,
    system: KYC_SYSTEM_PROMPT,
    tools: [KYC_EXTRACTION_TOOL as unknown as Anthropic.Tool],
    tool_choice: { type: "tool", name: KYC_EXTRACTION_TOOL.name },
    messages: [{ role: "user", content }],
  });

  const toolUse = response.content.find((block) => block.type === "tool_use");
  if (!toolUse || toolUse.type !== "tool_use") {
    throw new Error("KYC extraction model returned no tool_use block");
  }

  const parsed = kycExtractionSchema.safeParse(toolUse.input);
  if (!parsed.success) {
    throw new Error(`KYC extraction model output failed validation: ${parsed.error.message}`);
  }
  const extraction = parsed.data;

  // Server-side redaction, independent of whatever the model already did —
  // this is the one line that makes the Aadhaar-masking rule non-negotiable.
  const maskedFields =
    extraction.document_type === "aadhaar_card"
      ? { ...extraction.fields, document_number: maskAadhaarNumber(extraction.fields.document_number) }
      : extraction.fields;

  return {
    ...extraction,
    fields: maskedFields,
    documentType: extraction.document_type,
  };
}
