# nrighar-api routes

Base URL: `NEXT_PUBLIC_API_URL` / `EXPO_PUBLIC_API_URL` (e.g. `https://api.nrighar.3pandalabs.com`, `http://localhost:8080` in dev).

Auth: `Authorization: Bearer <accessToken>` header. Access tokens expire in 15 minutes — callers must catch 401s and call `POST /auth/refresh`, then retry once.

All error responses: `{ "error": "<code>" }` with a matching HTTP status. A resource that exists but isn't yours (or a share that isn't claimed) returns **404**, never 403 — don't rely on 403 to distinguish "forbidden" from "doesn't exist".

## Auth

| Method | Path | Auth | Body | Response |
|---|---|---|---|---|
| POST | `/auth/signup` | none | `{ email, password, role: 'owner'\|'tenant' }` | `201 { accessToken, refreshToken, user: { id, email, role } }` |
| POST | `/auth/login` | none | `{ email, password }` | `200 { accessToken, refreshToken, user }` or `401 { error: 'invalid_credentials' }` |
| POST | `/auth/refresh` | none | `{ refreshToken }` | `200 { accessToken, refreshToken }` (rotated — old refreshToken is now invalid) |
| POST | `/auth/logout` | none | `{ refreshToken }` | `204` |
| GET | `/auth/me` | required | — | `200 { id, email, role }` |

`role` on signup defaults to `'owner'` if omitted. Tenant signup also creates an empty `tenant_profiles` row — call `PATCH /tenant-profile` right after to fill it in (mirrors the old app's post-signup profile completion step).

## Profile (self, owner or tenant)

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/profile` | required | — |
| PATCH | `/profile` | required | any of `{ displayName, countryOfResidence, preferredCurrency, upiVpa, upiName }` |

## Properties / Tenants / Leases / Rent payments / Documents (owner-scoped)

Standard REST, all `requireAuth`, all implicitly scoped to the caller as owner. A property/tenant/lease/document belonging to another owner 404s.

- `GET|POST /properties`, `GET|PATCH|DELETE /properties/:id`
  body: `{ nickname, addressLine1, addressLine2?, city, state, pincode, propertyType?: 'apartment'|'independent_house'|'villa'|'plot'|'commercial', notes? }`
- `GET|POST /tenants`, `GET|PATCH|DELETE /tenants/:id`
  body: `{ fullName, phone?, email?, kycStatus?: 'pending'|'submitted'|'verified', notes? }`
- `GET|POST /leases`, `GET|PATCH|DELETE /leases/:id`
  body: `{ propertyId, tenantId, rentAmount, depositAmount?, startDate, endDate?, rentDueDay?, status?: 'active'|'ended' }`. `propertyId`/`tenantId` must belong to the caller (404 otherwise). Only one `active` lease per property — a second active lease on the same property returns `409 { error: 'conflict' }`.
- `GET /rent-payments`, `PUT /rent-payments` (upsert by `leaseId`+`periodYear`+`periodMonth`), `DELETE /rent-payments/:id`
  body: `{ leaseId, periodYear, periodMonth, amountDue, amountPaid?, paidOn?, method?, status?, notes? }`
- `GET|POST /documents`, `DELETE /documents/:id`
  body: `{ propertyId?, leaseId?, docType?, title, storagePath }` — `storagePath` must be a key you already have upload rights to (see Storage below).

## Tenant self (role must be `tenant`)

| Method | Path | Body |
|---|---|---|
| GET/PATCH | `/tenant-profile` | `{ fullName?, phone?, email?, currentCity?, employer?, kycStatus? }` |
| GET/POST | `/tenant-documents` | `{ docType?, title, storagePath }` |
| DELETE | `/tenant-documents/:id` | — |

## Cross-owner shared reads (requires a claimed `profile_shares`)

| Method | Path |
|---|---|
| GET | `/tenant-profiles/by-owner/:tenantUserId` |
| GET | `/tenant-documents/by-owner/:tenantUserId` |

404 if no claimed share exists between the caller (as owner) and that tenant — including right after a revoke.

## Pay links (UPI "I've paid" flow)

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/pay-links` | owner | — list all your pay links; optional `?leaseId=` filter |
| POST | `/leases/:leaseId/pay-links` | owner | `{ periodYear, periodMonth, amountDue }` — upserts by period |
| GET | `/pay-links/:token` | **none** | — returns `{ amountDue, periodYear, periodMonth, propertyNickname, propertyCity, tenantName, ownerUpiVpa, ownerUpiName, claimedPaidAt }` |
| POST | `/pay-links/:token/open` | **none** | — idempotent, `204` |
| POST | `/pay-links/:token/claim-paid` | **none** | — idempotent, `204` |

`:token` is the pay-link's `id` (unguessable UUID) — this is the entire trust model, same as the old Supabase RPCs.

## Intake links (owner invites a tenant to self-register)

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/intake-links` | owner | — list all your intake links |
| POST | `/intake-links` | owner | `{ propertyId? }` — expires in 14 days |
| GET | `/intake-links/:token` | **none** | `{ status, expired, ownerName, propertyNickname, propertyCity }` |
| POST | `/intake-links/:token/accept` | tenant | — consumes the link, creates a claimed share to the inviting owner |
| DELETE | `/intake-links/:id` | owner | — id, not token-in-URL sense (same field); 204 |
| POST | `/tenant-intake/:token` | **none**, `multipart/form-data` | fields `token`, `full_name`, `phone?`, `email?`, up to 6 `files` (jpg/jpeg/png/webp/pdf/xml/zip, ≤10MB each) — for a tenant who does **not** want to create an account; writes directly into the owner's document set |

## Profile shares (tenant-controlled sharing)

| Method | Path | Auth | Body |
|---|---|---|---|
| GET | `/profile-shares` | tenant | — list all shares you've created (open/claimed/revoked) |
| POST | `/profile-shares` | tenant | — mints a reusable `'open'` share, id is the token |
| GET | `/profile-shares/:token/preview` | required | `{ status, fullName, currentCity, kycStatus }` — no documents |
| POST | `/profile-shares/:token/claim` | owner | — binds the share to the caller, backfills/creates the owner's `tenants` record via the same dedup logic as intake-accept |
| POST | `/profile-shares/:id/revoke` | tenant (must own the share) | — cuts the owner's read access on the next request |

## Storage (Cloudflare R2)

| Method | Path | Auth | Body |
|---|---|---|---|
| POST | `/storage/presign-upload` | required | `{ key }` — `key` must start with `${yourUserId}/`; returns `{ url }`, a presigned PUT, 5 min TTL |
| POST | `/storage/presign-download` | required | `{ key }` — allowed if it's your own key, or a tenant's key you hold a claimed share for; returns `{ url }`, a presigned GET, 10 min TTL |

Upload flow: `POST /storage/presign-upload` → browser `PUT`s the file directly to the returned URL → `POST /documents` (or `/tenant-documents`) with `storagePath: key` to record the metadata row. This mirrors the old two-step Supabase Storage upload pattern.

Delete flow: `DELETE /documents/:id` and `DELETE /tenant-documents/:id` now also best-effort delete the underlying R2 object (if that fails, the metadata row is still removed and a warning is logged — matches the old app's two-step, non-atomic storage-then-metadata delete).
