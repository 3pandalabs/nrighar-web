// No-auth API calls only — safe to import from both Server Components and
// "use client" components (unlike lib/api/client.ts, this never touches
// next/headers, so it doesn't force a module into server-only).

const API_URL = process.env.NEXT_PUBLIC_API_URL ?? "http://localhost:8080";

export class PublicApiError extends Error {
  status: number;
  constructor(status: number, message: string) {
    super(message);
    this.status = status;
  }
}

export async function publicGet<T = unknown>(path: string): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, { cache: "no-store" });
  if (!res.ok) return null;
  return (await res.json()) as T;
}

export async function publicPost<T = unknown>(path: string, body?: unknown): Promise<T | null> {
  const res = await fetch(`${API_URL}${path}`, {
    method: "POST",
    headers: body !== undefined ? { "Content-Type": "application/json" } : undefined,
    body: body !== undefined ? JSON.stringify(body) : undefined,
  });
  if (res.status === 204) return null;
  if (!res.ok) {
    const errBody = await res.json().catch(() => null);
    throw new PublicApiError(res.status, errBody?.error ?? "unknown_error");
  }
  return res.json().catch(() => null) as Promise<T | null>;
}
