import { Pool } from "pg";

let pool: Pool | null = null;

export function hasPostgresConfig(): boolean {
  return Boolean(process.env.POSTGRES_URL);
}

export function postgres(): Pool {
  if (pool) return pool;
  if (!process.env.POSTGRES_URL) {
    throw new Error("POSTGRES_URL is not configured");
  }

  pool = new Pool({
    connectionString: process.env.POSTGRES_URL,
    max: 5,
    idleTimeoutMillis: 30_000,
    ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined,
  });

  return pool;
}
