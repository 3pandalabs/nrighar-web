"use server";

import { apiFetch, apiGetCurrentUser, ApiError } from "@/lib/api/client";

type Result = { ok: true; tenantId: string } | { ok: false; error: string };

export async function claimProfileShare(token: string): Promise<Result> {
  const user = await apiGetCurrentUser();
  if (!user) return { ok: false, error: "not_signed_in" };

  try {
    const result = await apiFetch(`/profile-shares/${token}/claim`, { method: "POST" });
    return { ok: true, tenantId: result.tenantId };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : "unknown_error" };
  }
}
