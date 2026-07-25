import pg from "pg";
import { requireDatabaseUrl } from "../config/env.js";

let pool;

export function getPool() {
  if (!pool) {
    pool = new pg.Pool({
      connectionString: requireDatabaseUrl(),
      max: Number(process.env.DB_POOL_MAX || 10),
      idleTimeoutMillis: 30_000,
      connectionTimeoutMillis: 5_000,
    });
  }
  return pool;
}

export async function query(text, params = []) {
  return getPool().query(text, params);
}

export async function closePool() {
  if (pool) {
    await pool.end();
    pool = null;
  }
}
