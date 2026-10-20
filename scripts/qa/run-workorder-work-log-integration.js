import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";

import { getPool } from "../../src/server/db/pool.js";
import { readWorkorderWorkLog } from "../../src/server/db/repositories/workorder-work-log.repo.js";

const fixturePath = process.env.WORK_LOG_FIXTURE || "/tmp/workorder-labor-status-qa/fixture.json";
const fixture = JSON.parse(await readFile(fixturePath, "utf8"));
const entryId = randomUUID();
const client = await getPool().connect();

try {
  await client.query("begin");
  const workorder = await client.query(
    `select company_id, activity_status, activity_version
     from operational_workorders where id = $1 for update`,
    [fixture.workorderId],
  );
  assert.ok(workorder.rows[0], "fixture workorder must exist");
  const row = workorder.rows[0];
  await client.query(
    `insert into workorder_labor_entries (
       id, company_id, workorder_id, mechanic_user_id, minutes, work_date, note,
       created_by_user_id, request_hash
     ) values ($1, $2, $3, $4, 75, current_date, 'Integration fixture', $4, repeat('a', 64))`,
    [entryId, row.company_id, fixture.workorderId, fixture.accounts.mechanic.userId],
  );
  await client.query(
    `insert into workorder_labor_entry_revisions (
       company_id, workorder_id, entry_id, version, minutes, work_date, note,
       correction_reason, changed_by_user_id
     ) values ($1, $2, $3, 1, 75, current_date, 'Integration fixture', '', $4)`,
    [row.company_id, fixture.workorderId, entryId, fixture.accounts.mechanic.userId],
  );
  const view = await readWorkorderWorkLog(fixture.workorderId, { client });
  const entry = view.entries.find((candidate) => candidate.id === entryId);
  assert.equal(entry.minutes, 75);
  assert.equal(entry.hours, 1.25);
  assert.equal(entry.revisions.length, 1);
  assert.ok(view.totalMinutes >= 75);

  await client.query("savepoint immutable_history");
  await assert.rejects(
    client.query("update workorder_labor_entry_revisions set note = 'mutated' where entry_id = $1", [entryId]),
    (error) => error.code === "55000",
  );
  await client.query("rollback to savepoint immutable_history");
  await client.query("rollback");
  console.log("Work-log database integration passed (transaction rolled back).");
} catch (error) {
  await client.query("rollback").catch(() => {});
  throw error;
} finally {
  client.release();
  await getPool().end();
}
