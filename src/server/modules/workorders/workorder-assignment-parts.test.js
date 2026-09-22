import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { setOperationalWorkorderMechanics } from "../../db/repositories/operational-workorders.repo.js";

// Exercise the repository transaction without opening a database connection.
process.env.DATABASE_URL ||= "postgres://unused:unused@localhost/unused";

function assignmentDatabase(t, { status = "accepted", partStatus = "reserved" } = {}) {
  const writes = [];
  const events = [];
  const team = new Set(["original"]);
  let savedStatus = status;
  const client = {
    async query(text, values = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      if (["begin", "commit", "rollback"].includes(sql)) {
        writes.push(sql);
        return { rows: [] };
      }
      if (sql.startsWith("select id, status from operational_workorders")) {
        return { rows: [{ id: "workorder", status }] };
      }
      if (sql.includes("from workorder_serialized_part_usages")) {
        return { rows: values[1].includes(partStatus) ? [{ id: "existing-part" }] : [] };
      }
      if (sql.startsWith("select mechanic_user_id, assignment_role")) {
        return { rows: [{ mechanic_user_id: "original", assignment_role: "primary" }] };
      }
      // Any inventory/part mutation is unexpected and fails the test.
      assert.match(sql, /^(update operational_workorders |update workorder_mechanic_assignments |insert into workorder_mechanic_assignments |insert into workorder_assignment_events |insert into workorder_status_events )/);
      writes.push(sql);
      if (sql.includes("set active = false")) values[1].forEach((id) => team.delete(id));
      if (sql.startsWith("insert into workorder_mechanic_assignments")) team.add(values[1]);
      if (sql.startsWith("update operational_workorders")) savedStatus = values[1];
      if (sql.startsWith("insert into workorder_assignment_events")) events.push(values);
      return { rows: [] };
    },
    release() {},
  };
  t.mock.method(pg.Pool.prototype, "connect", async () => client);
  t.mock.method(pg.Pool.prototype, "query", async () => ({ rows: [{
    id: "workorder", status: savedStatus, form_data: {},
    mechanics: [...team].map((id) => ({ id, name: id })),
  }] }));
  return { writes, events, team };
}

for (const partStatus of ["reserved", "issued", "installed_pending_approval"]) {
  for (const target of [["original", "new"], ["new"], []]) {
    test(`mechanic team ${JSON.stringify(target)} preserves ${partStatus} parts`, async (t) => {
      const db = assignmentDatabase(t, { partStatus });
      const result = await setOperationalWorkorderMechanics("workorder", "office", target, "Shift change");
      assert.deepEqual([...db.team].sort(), [...target].sort());
      assert.equal(result.status, target.length ? "accepted" : "open");
      assert.equal(db.writes.at(-1), "commit");
      assert.ok(db.events.length > 0);
      for (const event of db.events) {
        assert.equal(event[0], "workorder");
        assert.equal(event[4], "Shift change");
        assert.equal(event[5], "office");
      }
    });
  }
}

test("completed workorders still reject mechanic changes", async (t) => {
  const db = assignmentDatabase(t, { status: "closed" });
  await assert.rejects(setOperationalWorkorderMechanics("workorder", "office", ["new"], "Shift change"),
    { code: "WORKORDER_ASSIGNMENT_NOT_ALLOWED" });
  assert.deepEqual(db.writes, ["begin", "rollback"]);
});

test("unchanged mechanic team still rejects without touching parts", async (t) => {
  const db = assignmentDatabase(t);
  await assert.rejects(setOperationalWorkorderMechanics("workorder", "office", ["original"], "Shift change"),
    /Select a different mechanic team/);
  assert.deepEqual(db.writes, ["begin", "rollback"]);
});
