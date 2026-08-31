import { getPool } from "../pool.js";

// Canonical serialized and aggregate usage mutations lock their workorder row.
// Holding the matching share lock keeps the workorder form and usage projection
// at one coherent before-or-after boundary while the immutable snapshot is built.
export async function withLockedWorkorderPrintSnapshot(input, loadSnapshot, dependencies = {}) {
  const pool = dependencies.pool || getPool();
  const client = await pool.connect();
  try {
    await client.query("begin isolation level repeatable read");
    const locked = await client.query(
      `select id from operational_workorders
       where id = $1 and company_id = any($2::uuid[])
       for share`,
      [input.workorderId, input.companyIds],
    );
    if (!locked.rows[0]) {
      await client.query("rollback");
      return null;
    }
    const snapshot = await loadSnapshot();
    await client.query("commit");
    return snapshot;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
