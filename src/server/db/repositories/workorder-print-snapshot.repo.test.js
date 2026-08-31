import assert from "node:assert/strict";
import test from "node:test";
import { withLockedWorkorderPrintSnapshot } from "./workorder-print-snapshot.repo.js";

function fakePool({ found = true } = {}) {
  const calls = [];
  const client = {
    query: async (sql, params) => {
      calls.push({ sql, params });
      return /select id from operational_workorders/i.test(sql)
        ? { rows: found ? [{ id: "workorder-1" }] : [] }
        : { rows: [] };
    },
    release: () => calls.push({ sql: "release" }),
  };
  return { calls, pool: { connect: async () => client } };
}

test("builds the complete print snapshot while holding the workorder share lock", async () => {
  const { calls, pool } = fakePool();
  const result = await withLockedWorkorderPrintSnapshot({
    workorderId: "workorder-1",
    companyIds: ["company-1"],
  }, async () => ({ form: { parts: [] } }), { pool });

  assert.deepEqual(result, { form: { parts: [] } });
  assert.match(calls[0].sql, /begin isolation level repeatable read/i);
  assert.match(calls[1].sql, /company_id = any\(\$2::uuid\[\]\)[\s\S]*for share/i);
  assert.equal(calls[2].sql, "commit");
  assert.equal(calls.at(-1).sql, "release");
});

test("out-of-company workorders never invoke the snapshot loader", async () => {
  const { calls, pool } = fakePool({ found: false });
  let loaded = false;
  const result = await withLockedWorkorderPrintSnapshot({
    workorderId: "guessed",
    companyIds: ["company-1"],
  }, async () => { loaded = true; }, { pool });
  assert.equal(result, null);
  assert.equal(loaded, false);
  assert.equal(calls[2].sql, "rollback");
});

test("the workorder lock remains held until every snapshot field has loaded", async () => {
  const { calls, pool } = fakePool();
  let releaseLoader;
  const loaderPaused = new Promise((resolve) => { releaseLoader = resolve; });
  const pending = withLockedWorkorderPrintSnapshot({
    workorderId: "workorder-1",
    companyIds: ["company-1"],
  }, async () => {
    await loaderPaused;
    return { coherent: true };
  }, { pool });

  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(calls.some(({ sql }) => sql === "commit"), false);
  releaseLoader();
  assert.deepEqual(await pending, { coherent: true });
  assert.equal(calls.findIndex(({ sql }) => sql === "commit"), 2);
});
