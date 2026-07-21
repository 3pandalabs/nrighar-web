/**
 * One-off migration: Supabase (Postgres `public` schema + `auth.users` + the
 * `documents` Storage bucket) -> the new self-hosted stack (bare Postgres on
 * Hetzner/Coolify + Cloudflare R2).
 *
 * Why direct row reads via `pg`/`@supabase/supabase-js` instead of
 * `pg_dump`/`pg_restore`: this migration also needs to (a) pull `auth.users`
 * separately since it's not part of `public` and doesn't map 1:1 to the new
 * `users` table, (b) copy Storage objects to R2 which pg_dump can't touch at
 * all, and (c) print row-count verification as it goes. Doing everything
 * through one scriptable path is easier to reason about and re-run in pieces
 * than gluing together pg_dump + a separate storage script + manual checks.
 *
 * Safety model: defaults to a DRY RUN (reports source row counts only, makes
 * zero writes). Requires --confirm to write anything to the destination.
 * Requires --truncate-first (explicit, separate flag) to touch existing rows
 * in an already-populated destination — never truncates silently. This
 * touches real historical data (at least one real account + test data), so
 * default-safe beats convenient.
 *
 * Usage:
 *   npm install
 *   cp .env.example .env   # fill in real values
 *   npm run migrate-data                        # dry run, counts only
 *   npm run migrate-data -- --confirm            # real run, DB + storage
 *   npm run migrate-data -- --confirm --truncate-first   # wipe destination tables first
 *   npm run migrate-data -- --confirm --skip-storage     # DB rows only
 *   npm run migrate-data -- --confirm --skip-db          # storage objects only
 *
 * See README.md in this folder for the full env var list and recommended
 * run order.
 */

import "dotenv/config";
import { Client } from "pg";
import { createClient as createSupabaseClient } from "@supabase/supabase-js";
import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";

// ---------------------------------------------------------------------------
// CLI flags
// ---------------------------------------------------------------------------

const args = new Set(process.argv.slice(2));
const CONFIRM = args.has("--confirm");
const TRUNCATE_FIRST = args.has("--truncate-first");
const SKIP_STORAGE = args.has("--skip-storage");
const SKIP_DB = args.has("--skip-db");

if (TRUNCATE_FIRST && !CONFIRM) {
  console.error("--truncate-first requires --confirm.");
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Env
// ---------------------------------------------------------------------------

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) {
    console.error(`Missing required env var: ${name} (see scripts/README.md)`);
    process.exit(1);
  }
  return v;
}

const SUPABASE_DB_URL = requireEnv("SUPABASE_DB_URL"); // direct Postgres connection string to the Supabase project
const SUPABASE_URL = requireEnv("SUPABASE_URL");
const SUPABASE_SERVICE_ROLE_KEY = requireEnv("SUPABASE_SERVICE_ROLE_KEY");
const NEW_DATABASE_URL = requireEnv("NEW_DATABASE_URL"); // the new Postgres on Hetzner/Coolify
const R2_ACCOUNT_ID = requireEnv("R2_ACCOUNT_ID");
const R2_ACCESS_KEY_ID = requireEnv("R2_ACCESS_KEY_ID");
const R2_SECRET_ACCESS_KEY = requireEnv("R2_SECRET_ACCESS_KEY");
const R2_BUCKET = requireEnv("R2_BUCKET");

const SUPABASE_STORAGE_BUCKET = "documents"; // source bucket name on Supabase, unchanged

// ---------------------------------------------------------------------------
// Table migration plan, in FK-safe insert order.
// Column lists are explicit (not reflected from the DB) so a schema drift
// between `supabase/migrations` and reality fails loudly instead of silently
// migrating the wrong columns.
// ---------------------------------------------------------------------------

type TableSpec = {
  /** destination table name */
  name: string;
  /** SELECT list against the source, aliased to destination column names where they differ */
  sourceSelect: string;
  /** source FROM clause (schema-qualified) */
  sourceFrom: string;
  /** destination column names, in the same order as sourceSelect's output columns */
  destColumns: string[];
};

const TABLES: TableSpec[] = [
  {
    name: "users",
    // auth.users.encrypted_password is a standard bcrypt hash despite the name —
    // maps directly to the new users.password_hash with no transformation.
    sourceSelect: "id, email, encrypted_password as password_hash, created_at",
    sourceFrom: "auth.users",
    destColumns: ["id", "email", "password_hash", "created_at"],
  },
  {
    name: "profiles",
    sourceSelect:
      "id, display_name, country_of_residence, preferred_currency, created_at, upi_vpa, upi_name, role",
    sourceFrom: "public.profiles",
    destColumns: [
      "id",
      "display_name",
      "country_of_residence",
      "preferred_currency",
      "created_at",
      "upi_vpa",
      "upi_name",
      "role",
    ],
  },
  {
    name: "tenant_profiles",
    sourceSelect:
      "user_id, full_name, phone, email, current_city, employer, kyc_status, created_at",
    sourceFrom: "public.tenant_profiles",
    destColumns: [
      "user_id",
      "full_name",
      "phone",
      "email",
      "current_city",
      "employer",
      "kyc_status",
      "created_at",
    ],
  },
  {
    name: "properties",
    sourceSelect:
      "id, owner_id, nickname, address_line1, address_line2, city, state, pincode, property_type, notes, created_at",
    sourceFrom: "public.properties",
    destColumns: [
      "id",
      "owner_id",
      "nickname",
      "address_line1",
      "address_line2",
      "city",
      "state",
      "pincode",
      "property_type",
      "notes",
      "created_at",
    ],
  },
  {
    name: "tenants",
    sourceSelect:
      "id, owner_id, full_name, phone, email, kyc_status, notes, created_at, tenant_user_id",
    sourceFrom: "public.tenants",
    destColumns: [
      "id",
      "owner_id",
      "full_name",
      "phone",
      "email",
      "kyc_status",
      "notes",
      "created_at",
      "tenant_user_id",
    ],
  },
  {
    name: "leases",
    sourceSelect:
      "id, owner_id, property_id, tenant_id, rent_amount, deposit_amount, start_date, end_date, rent_due_day, status, created_at",
    sourceFrom: "public.leases",
    destColumns: [
      "id",
      "owner_id",
      "property_id",
      "tenant_id",
      "rent_amount",
      "deposit_amount",
      "start_date",
      "end_date",
      "rent_due_day",
      "status",
      "created_at",
    ],
  },
  {
    name: "rent_payments",
    sourceSelect:
      "id, owner_id, lease_id, period_year, period_month, amount_due, amount_paid, paid_on, method, status, notes, created_at",
    sourceFrom: "public.rent_payments",
    destColumns: [
      "id",
      "owner_id",
      "lease_id",
      "period_year",
      "period_month",
      "amount_due",
      "amount_paid",
      "paid_on",
      "method",
      "status",
      "notes",
      "created_at",
    ],
  },
  {
    name: "documents",
    sourceSelect:
      "id, owner_id, property_id, lease_id, doc_type, title, storage_path, created_at",
    sourceFrom: "public.documents",
    destColumns: [
      "id",
      "owner_id",
      "property_id",
      "lease_id",
      "doc_type",
      "title",
      "storage_path",
      "created_at",
    ],
  },
  {
    name: "pay_links",
    sourceSelect:
      "id, owner_id, lease_id, period_year, period_month, amount_due, opened_at, claimed_paid_at, created_at",
    sourceFrom: "public.pay_links",
    destColumns: [
      "id",
      "owner_id",
      "lease_id",
      "period_year",
      "period_month",
      "amount_due",
      "opened_at",
      "claimed_paid_at",
      "created_at",
    ],
  },
  {
    name: "intake_links",
    sourceSelect:
      "id, owner_id, property_id, status, tenant_id, created_at, submitted_at, expires_at",
    sourceFrom: "public.intake_links",
    destColumns: [
      "id",
      "owner_id",
      "property_id",
      "status",
      "tenant_id",
      "created_at",
      "submitted_at",
      "expires_at",
    ],
  },
  {
    name: "tenant_documents",
    sourceSelect: "id, tenant_user_id, doc_type, title, storage_path, created_at",
    sourceFrom: "public.tenant_documents",
    destColumns: ["id", "tenant_user_id", "doc_type", "title", "storage_path", "created_at"],
  },
  {
    name: "profile_shares",
    sourceSelect: "id, tenant_user_id, owner_id, status, created_at, claimed_at, revoked_at",
    sourceFrom: "public.profile_shares",
    destColumns: ["id", "tenant_user_id", "owner_id", "status", "created_at", "claimed_at", "revoked_at"],
  },
];

const BATCH_SIZE = 500;

// ---------------------------------------------------------------------------
// DB migration
// ---------------------------------------------------------------------------

async function countSource(source: Client, spec: TableSpec): Promise<number> {
  const { rows } = await source.query(`select count(*)::int as n from ${spec.sourceFrom}`);
  return rows[0].n;
}

async function countDest(dest: Client, spec: TableSpec): Promise<number> {
  const { rows } = await dest.query(`select count(*)::int as n from public.${spec.name}`);
  return rows[0].n;
}

/** Builds and runs a single multi-row parameterized INSERT for one batch. */
async function insertBatch(
  dest: Client,
  table: string,
  columns: string[],
  rows: Record<string, unknown>[]
): Promise<void> {
  if (rows.length === 0) return;
  const values: unknown[] = [];
  const tuples: string[] = [];
  rows.forEach((row, rowIdx) => {
    const placeholders = columns.map((_, colIdx) => `$${rowIdx * columns.length + colIdx + 1}`);
    tuples.push(`(${placeholders.join(", ")})`);
    for (const col of columns) values.push(row[col]);
  });
  const sql = `insert into public.${table} (${columns.join(", ")}) values ${tuples.join(", ")}`;
  await dest.query(sql, values);
}

async function migrateTable(source: Client, dest: Client, spec: TableSpec): Promise<{ source: number; inserted: number }> {
  const { rows } = await source.query(`select ${spec.sourceSelect} from ${spec.sourceFrom}`);
  let inserted = 0;
  for (let i = 0; i < rows.length; i += BATCH_SIZE) {
    const batch = rows.slice(i, i + BATCH_SIZE);
    await insertBatch(dest, spec.name, spec.destColumns, batch);
    inserted += batch.length;
  }
  return { source: rows.length, inserted };
}

async function runDbMigration() {
  const source = new Client({ connectionString: SUPABASE_DB_URL });
  const dest = new Client({ connectionString: NEW_DATABASE_URL });
  await source.connect();
  await dest.connect();

  try {
    console.log("\n=== Database: source row counts ===");
    const sourceCounts: Record<string, number> = {};
    for (const spec of TABLES) {
      sourceCounts[spec.name] = await countSource(source, spec);
      console.log(`  ${spec.name.padEnd(20)} ${sourceCounts[spec.name]}`);
    }

    if (!CONFIRM) {
      console.log("\nDry run only (no --confirm) — no writes made. Re-run with --confirm to migrate.");
      return;
    }

    console.log("\n=== Checking destination is safe to write to ===");
    for (const spec of TABLES) {
      const n = await countDest(dest, spec);
      if (n > 0 && !TRUNCATE_FIRST) {
        throw new Error(
          `Destination table public.${spec.name} already has ${n} row(s). ` +
            `Re-run with --truncate-first if you intend to wipe and re-migrate, or investigate first.`
        );
      }
    }

    if (TRUNCATE_FIRST) {
      console.log("--truncate-first set: truncating destination tables (reverse FK order)...");
      // Reverse of TABLES order to respect FKs (children before parents).
      for (const spec of [...TABLES].reverse()) {
        await dest.query(`truncate table public.${spec.name} cascade`);
      }
    }

    console.log("\n=== Migrating rows ===");
    await dest.query("begin");
    try {
      for (const spec of TABLES) {
        const result = await migrateTable(source, dest, spec);
        console.log(`  ${spec.name.padEnd(20)} ${result.inserted}/${result.source} inserted`);
      }
      await dest.query("commit");
    } catch (err) {
      await dest.query("rollback");
      throw err;
    }

    console.log("\n=== Verification: destination row counts vs source ===");
    let allMatch = true;
    for (const spec of TABLES) {
      const destN = await countDest(dest, spec);
      const ok = destN === sourceCounts[spec.name];
      allMatch = allMatch && ok;
      console.log(`  ${spec.name.padEnd(20)} source=${sourceCounts[spec.name]} dest=${destN} ${ok ? "OK" : "MISMATCH"}`);
    }
    if (!allMatch) {
      console.error("\nRow count mismatch detected — investigate before trusting this migration.");
      process.exitCode = 1;
    } else {
      console.log("\nAll table row counts match.");
    }
  } finally {
    await source.end();
    await dest.end();
  }
}

// ---------------------------------------------------------------------------
// Storage migration: Supabase Storage `documents` bucket -> R2
// ---------------------------------------------------------------------------

type StorageEntry = { name: string; id: string | null };

async function listAllObjectKeys(
  supabase: ReturnType<typeof createSupabaseClient>,
  prefix = ""
): Promise<string[]> {
  const { data, error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).list(prefix, {
    limit: 1000,
    sortBy: { column: "name", order: "asc" },
  });
  if (error) throw new Error(`Storage list failed at prefix "${prefix}": ${error.message}`);

  const keys: string[] = [];
  for (const entry of (data ?? []) as StorageEntry[]) {
    const fullPath = prefix ? `${prefix}/${entry.name}` : entry.name;
    // Folders have id === null in Supabase's Storage list() response; recurse into them.
    if (entry.id === null) {
      keys.push(...(await listAllObjectKeys(supabase, fullPath)));
    } else {
      keys.push(fullPath);
    }
  }
  return keys;
}

async function runStorageMigration() {
  const supabase = createSupabaseClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY);
  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: { accessKeyId: R2_ACCESS_KEY_ID, secretAccessKey: R2_SECRET_ACCESS_KEY },
  });

  console.log("\n=== Storage: listing objects in Supabase bucket 'documents' ===");
  const keys = await listAllObjectKeys(supabase);
  console.log(`  Found ${keys.length} object(s).`);

  if (!CONFIRM) {
    console.log("Dry run only (no --confirm) — no files copied. Re-run with --confirm to copy to R2.");
    return;
  }

  console.log("\n=== Copying objects to R2 ===");
  const failed: string[] = [];
  let copied = 0;
  for (const key of keys) {
    try {
      const { data, error } = await supabase.storage.from(SUPABASE_STORAGE_BUCKET).download(key);
      if (error || !data) throw new Error(error?.message ?? "empty download");
      const bytes = new Uint8Array(await data.arrayBuffer());
      await s3.send(
        new PutObjectCommand({
          Bucket: R2_BUCKET,
          Key: key,
          Body: bytes,
          ContentType: data.type || "application/octet-stream",
        })
      );
      copied++;
      if (copied % 25 === 0) console.log(`  ...${copied}/${keys.length}`);
    } catch (err) {
      console.error(`  FAILED: ${key} — ${(err as Error).message}`);
      failed.push(key);
    }
  }

  console.log(`\nCopied ${copied}/${keys.length} object(s).`);
  if (failed.length > 0) {
    console.error(`Failed (${failed.length}):`);
    for (const k of failed) console.error(`  - ${k}`);
    process.exitCode = 1;
  }
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function main() {
  console.log(`Mode: ${CONFIRM ? "LIVE (--confirm)" : "DRY RUN"}${TRUNCATE_FIRST ? " + --truncate-first" : ""}`);

  if (!SKIP_DB) {
    await runDbMigration();
  } else {
    console.log("\n(skipping database migration: --skip-db)");
  }

  if (!SKIP_STORAGE) {
    await runStorageMigration();
  } else {
    console.log("\n(skipping storage migration: --skip-storage)");
  }
}

main().catch((err) => {
  console.error("\nMigration failed:", err);
  process.exit(1);
});
