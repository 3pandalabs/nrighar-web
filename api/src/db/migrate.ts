// One-off script: applies drizzle/*.sql migrations to DATABASE_URL. Run via
// `npm run db:migrate` — in Coolify this is wired as a pre-deploy command.
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { db, pool } from "./index.js";

await migrate(db, { migrationsFolder: "./drizzle" });
await pool.end();
console.log("Migrations applied.");
