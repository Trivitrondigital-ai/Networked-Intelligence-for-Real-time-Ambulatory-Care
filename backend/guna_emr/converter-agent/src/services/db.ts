import { Pool } from "pg";
import { ensureCanonicalEmrSchema } from "./emrPersistence";

let pool: Pool;

export async function setupDb() {
  pool = new Pool({
    connectionString:
      process.env.DATABASE_URL ||
      "postgresql://nira:nira_secret_2024@localhost:5432/nira_emr",
  });
  await pool.query("SELECT 1");
  await ensureCanonicalEmrSchema();
  console.log("PostgreSQL connected");
}

export function getDb(): Pool | null {
  return pool || null;
}
