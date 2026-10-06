import assert from "node:assert/strict";
import test from "node:test";
import pg from "pg";
import { acceptOperationalWorkorder, setOperationalWorkorderMechanics } from "./operational-workorders.repo.js";
import { getCurrentAcceptedEstimateForWorkorder } from "./customer-documents.repo.js";

process.env.DATABASE_URL ||= "postgres://unused:unused@localhost/unused";

function database(t, { status = "open", assigned = false, classification = "required_external_customer", accepted = false } = {}) {
  const statements = [];
  const client = {
    async query(text, values = []) {
      const sql = text.replace(/\s+/g, " ").trim();
      statements.push(sql);
      if (["begin", "commit", "rollback"].includes(sql)) return { rows: [] };
      if (sql.startsWith("select id, status from operational_workorders")) return { rows: [{ id: "workorder", status }] };
      if (sql.startsWith("select company_id from operational_workorders")) return { rows: [{ company_id: "company" }] };
      if (sql.startsWith("select mechanic_user_id, assignment_role")) {
        return { rows: assigned ? [{ mechanic_user_id: "original", assignment_role: "primary" }] : [] };
      }
      if (sql.includes("from lateral (") && sql.includes("workorder_authorization_events")) {
        assert.deepEqual(values, ["company", "workorder"]);
        return { rows: [{ classification, latest_revision_id: "revision", latest_accepted: accepted, latest_terminal: false }] };
      }
      if (/^(insert into|update )/.test(sql)) return { rows: [] };
      assert.fail(`Unexpected query: ${sql}`);
    },
    release() {},
  };
  t.mock.method(pg.Pool.prototype, "connect", async () => client);
  t.mock.method(pg.Pool.prototype, "query", async () => ({ rows: [{ id: "workorder", status }] }));
  return statements;
}

test("mechanic acceptance blocks OPEN to IN_PROGRESS before assignment when revised Estimate is pending", async (t) => {
  const statements = database(t);
  await assert.rejects(acceptOperationalWorkorder("workorder", "mechanic"), {
    code: "CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED",
  });
  assert.equal(statements.at(-1), "rollback");
  assert.equal(statements.some((sql) => sql.startsWith("insert into workorder_mechanic_assignments")), false);
});

test("office assignment blocks OPEN to ACCEPTED before assignment when revised Estimate is pending", async (t) => {
  const statements = database(t);
  await assert.rejects(setOperationalWorkorderMechanics("workorder", "office", ["mechanic"], "Assign"), {
    code: "CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED",
  });
  assert.equal(statements.at(-1), "rollback");
  assert.equal(statements.some((sql) => sql.startsWith("insert into workorder_mechanic_assignments")), false);
});

test("accepted external Estimate permits mechanic activation", async (t) => {
  const statements = database(t, { accepted: true });
  await acceptOperationalWorkorder("workorder", "mechanic");
  assert.equal(statements.at(-2).startsWith("insert into workorder_status_events"), true);
  assert.equal(statements.at(-1), "commit");
});

test("accepted external Estimate permits office assignment activation", async (t) => {
  const statements = database(t, { accepted: true });
  await setOperationalWorkorderMechanics("workorder", "office", ["mechanic"], "Assign");
  assert.equal(statements.some((sql) => sql.includes("workorder_authorization_events")), true);
  assert.equal(statements.at(-1), "commit");
});

for (const classification of ["internal_fleet", "exempt"]) {
  test(`${classification} Workorder permits mechanic activation without accepted Estimate`, async (t) => {
    const statements = database(t, { classification });
    await acceptOperationalWorkorder("workorder", "mechanic");
    assert.equal(statements.at(-1), "commit");
  });
}

test("internal Workorder and active roster changes do not require Estimate acceptance", async (t) => {
  const statements = database(t, { status: "accepted", assigned: true });
  await setOperationalWorkorderMechanics("workorder", "office", ["original", "support"], "Help");
  assert.equal(statements.some((sql) => sql.includes("workorder_authorization_events")), false);
  assert.equal(statements.at(-1), "commit");
});

test("accepted Estimate lookup uses a PostgreSQL-safe authorization event alias", async () => {
  let statement;
  await getCurrentAcceptedEstimateForWorkorder({ companyId: "company", locationId: "location", workorderId: "workorder" }, {
    query: async (sql, values) => {
      statement = sql;
      assert.deepEqual(values, ["company", "location", "workorder"]);
      return { rows: [] };
    },
  });
  assert.match(statement, /workorder_authorization_events auth_event/);
  assert.doesNotMatch(statement, /\bauthorization\./);
});
