import fp from "fastify-plugin";
import type { FastifyReply, FastifyRequest } from "fastify";
import { verifyAccessToken } from "./jwt.js";

declare module "fastify" {
  interface FastifyRequest {
    userId?: string;
    userRole?: "owner" | "tenant";
  }
}

function extractBearer(req: FastifyRequest): string | null {
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) return null;
  return header.slice("Bearer ".length);
}

// Attaches req.userId/req.userRole when a valid access token is present, but
// does not itself reject the request — use `requireAuth` as a preHandler on
// routes that must be authenticated. This split lets a route optionally read
// the caller's identity (none of ours currently need that, but keeping the
// attach/require split avoids re-parsing the header in two places).
export const authPlugin = fp(async (fastify) => {
  fastify.decorateRequest("userId", undefined);
  fastify.decorateRequest("userRole", undefined);

  fastify.addHook("onRequest", async (req) => {
    const token = extractBearer(req);
    if (!token) return;
    try {
      const payload = verifyAccessToken(token);
      req.userId = payload.sub;
      req.userRole = payload.role;
    } catch {
      // Invalid/expired token: leave req.userId unset, requireAuth will 401.
    }
  });
});

export async function requireAuth(req: FastifyRequest, reply: FastifyReply) {
  if (!req.userId) {
    reply.code(401).send({ error: "not_authenticated" });
  }
}

export async function requireTenantRole(req: FastifyRequest, reply: FastifyReply) {
  if (req.userRole !== "tenant") {
    reply.code(403).send({ error: "tenant_role_required" });
  }
}
