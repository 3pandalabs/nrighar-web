"use server";

import { randomUUID } from "crypto";
import { apiFetch, apiLogin, apiSignup, ApiError } from "@/lib/api/client";

type Result = { ok: true } | { ok: false; error: string };

export async function signUpTenant(email: string, password: string): Promise<Result> {
  try {
    await apiSignup(email, password, "tenant");
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : "unknown_error" };
  }
}

export async function signInTenant(email: string, password: string): Promise<Result> {
  try {
    await apiLogin(email, password);
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : "invalid_credentials" };
  }
}

export async function saveNewTenantProfile(input: {
  fullName: string;
  phone?: string;
  email: string;
  currentCity?: string;
  kycStatus: "pending" | "submitted";
}) {
  await apiFetch("/tenant-profile", { method: "PATCH", body: JSON.stringify(input) });
}

export async function getTenantUploadUrl(filename: string): Promise<{ key: string; url: string }> {
  // Server action running with the just-created tenant's own session — the
  // API derives the owning user id from the JWT, not from client input.
  const me = await apiFetch("/auth/me");
  const key = `${me.id}/${randomUUID()}-${filename}`;
  const result = await apiFetch("/storage/presign-upload", {
    method: "POST",
    body: JSON.stringify({ key }),
  });
  return { key, url: result.url };
}

export async function recordTenantDocument(input: { docType: string; title: string; storagePath: string }) {
  await apiFetch("/tenant-documents", { method: "POST", body: JSON.stringify(input) });
}

export async function acceptIntakeLink(token: string): Promise<Result> {
  try {
    await apiFetch(`/intake-links/${token}/accept`, { method: "POST" });
    return { ok: true };
  } catch (e) {
    return { ok: false, error: e instanceof ApiError ? e.code : "unknown_error" };
  }
}

export async function mintProfileShare(): Promise<string> {
  const share = await apiFetch("/profile-shares", { method: "POST" });
  return share.id;
}
