import type { FastifyInstance } from "fastify";
import { eq } from "drizzle-orm";
import { db, schema } from "../db/index.js";
import { putObject } from "../plugins/r2.js";

const MAX_FILES = 6;
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const ALLOWED_EXTENSIONS = ["jpg", "jpeg", "png", "webp", "pdf", "xml", "zip"];
const TOKEN_RE = /^[0-9a-f-]{36}$/i;

// Ports supabase/functions/tenant-intake/index.ts directly. Anonymous but
// token-gated: no auth required, the caller must present a pending,
// unexpired intake_links uuid. Files land in the OWNER's R2 prefix
// (<ownerId>/intake/<token>/...) so the owner's normal storage access covers
// them — the anonymous submitter never gets a read path back, matching the
// old Edge Function's service-role-bypass trust model exactly.
export async function tenantIntakeRoutes(app: FastifyInstance) {
  app.post("/tenant-intake/:token", async (req, reply) => {
    const { token } = req.params as { token: string };
    if (!TOKEN_RE.test(token)) return reply.code(400).send({ error: "Invalid link" });

    let fullName = "";
    let phone = "";
    let email = "";
    const files: { name: string; buffer: Buffer }[] = [];

    for await (const part of req.parts()) {
      if (part.type === "file") {
        if (files.length >= MAX_FILES) {
          return reply.code(400).send({ error: `At most ${MAX_FILES} files` });
        }
        const buffer = await part.toBuffer();
        if (buffer.length === 0) continue;
        if (buffer.length > MAX_FILE_BYTES) {
          return reply.code(400).send({ error: `${part.filename} is larger than 10 MB` });
        }
        const ext = part.filename.split(".").pop()?.toLowerCase() ?? "";
        if (!ALLOWED_EXTENSIONS.includes(ext)) {
          return reply
            .code(400)
            .send({ error: `${part.filename}: only jpg, png, webp, pdf, xml, zip files are allowed` });
        }
        files.push({ name: part.filename, buffer });
      } else {
        const value = String(part.value ?? "").trim();
        if (part.fieldname === "full_name") fullName = value;
        if (part.fieldname === "phone") phone = value;
        if (part.fieldname === "email") email = value;
      }
    }

    if (!fullName) return reply.code(400).send({ error: "Name is required" });

    const [link] = await db.select().from(schema.intakeLinks).where(eq(schema.intakeLinks.id, token));
    if (!link) return reply.code(404).send({ error: "This link doesn't exist" });
    if (link.status !== "pending") return reply.code(409).send({ error: "This link was already used" });
    if (link.expiresAt < new Date()) return reply.code(410).send({ error: "This link has expired" });

    const [tenant] = await db
      .insert(schema.tenants)
      .values({
        ownerId: link.ownerId,
        fullName,
        phone: phone || undefined,
        email: email || undefined,
        kycStatus: files.length > 0 ? "submitted" : "pending",
        notes: "Self-registered via intake link",
      })
      .returning({ id: schema.tenants.id });

    for (const f of files) {
      const safeName = f.name.replace(/[^\w.-]/g, "_");
      const path = `${link.ownerId}/intake/${token}/${safeName}`;
      await putObject(path, f.buffer);
      await db.insert(schema.documents).values({
        ownerId: link.ownerId,
        propertyId: link.propertyId,
        docType: "kyc",
        title: `${fullName} — ${safeName}`,
        storagePath: path,
      });
    }

    await db
      .update(schema.intakeLinks)
      .set({ status: "submitted", tenantId: tenant.id, submittedAt: new Date() })
      .where(eq(schema.intakeLinks.id, token));

    return reply.send({ ok: true });
  });
}
