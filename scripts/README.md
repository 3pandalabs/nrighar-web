# migrate-data.ts

One-off script that copies NRIGhar's data off Supabase (Postgres `public` schema + `auth.users` + the `documents` Storage bucket) into the new self-hosted stack (bare Postgres on Hetzner/Coolify + Cloudflare R2). See the top-of-file comment in `migrate-data.ts` for why it reads rows directly instead of shelling out to `pg_dump`.

This is **not** part of the running app — run it once during cutover, then it can be deleted or left as historical reference.

## Prerequisites

- The new Postgres schema must already exist at `NEW_DATABASE_URL` (i.e. `api/`'s Drizzle migrations have been applied) before running this — the script only inserts rows, it doesn't create tables.
- Node 20+, then `npm install` in this folder.
- `cp .env.example .env` and fill in every value — see the comments in `.env.example` for where each one comes from (Supabase dashboard, R2 dashboard, Coolify resource).

## Recommended run order

1. **Dry run first, always:**
   ```
   npm run migrate-data
   ```
   Prints source row counts (DB tables + Storage object count) and makes **zero writes**. Sanity-check the numbers look right (e.g. matches what you see in the Supabase table editor) before going further.

2. **Apply the new Postgres schema** to `NEW_DATABASE_URL` if you haven't already (via `api/`'s Drizzle migration command — see `api/README.md`). Confirm the destination tables exist and are empty.

3. **Real run:**
   ```
   npm run migrate-data -- --confirm
   ```
   Inserts DB rows (wrapped in a single transaction — rolls back entirely on any error) and copies every Storage object to R2. Refuses to run if the destination tables already have rows, unless you also pass `--truncate-first`.

4. **Verify** — the script prints a source-vs-destination row count comparison at the end of the DB phase, and a list of any Storage objects that failed to copy. Don't proceed to DNS cutover if either shows a mismatch/failure; re-run (see "Re-running" below) after investigating.

## Flags

| Flag | Effect |
|---|---|
| (none) | Dry run — counts only, no writes |
| `--confirm` | Actually write to the destination DB and/or R2 |
| `--truncate-first` | Wipe destination tables (in FK-safe reverse order) before inserting — requires `--confirm`. Only use this when intentionally re-running against a destination that already has data from a prior test run. |
| `--skip-storage` | DB rows only, skip the Storage->R2 copy |
| `--skip-db` | Storage->R2 copy only, skip DB rows |

## Re-running

The script is not automatically idempotent — running `--confirm` twice against a destination that already has rows will refuse (not silently duplicate), unless you pass `--truncate-first`. During testing/dry-runs against a scratch destination DB, `--truncate-first` is the normal way to reset and re-run; for the real production cutover, only use it if you're deliberately redoing the migration (e.g. after fixing a bug found in step 4 above), not routinely.

The Storage copy phase re-uploads every object on each `--confirm` run (R2 `PutObject` overwrites by key) — safe to re-run, just re-copies everything rather than only the delta.
