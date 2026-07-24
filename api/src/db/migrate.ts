// Applies drizzle/*.sql migrations to DATABASE_URL. In production this runs
// automatically on every deploy via the api Dockerfile's CMD, as the compiled
// `node dist/db/migrate.js` (`npm run db:migrate:prod`) — the runtime image is
// --omit=dev and has no tsx/src, so the `npm run db:migrate` (tsx) script is
// dev/local-only. Keep this file dependency-light so the compiled output runs
// under plain node with only prod deps.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Migrations applied.");
