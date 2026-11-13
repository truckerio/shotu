import test from "node:test";
import assert from "node:assert/strict";
import { saveBusinessSetup } from "./business-setup.repo.js";
const companyId = "00000000-0000-0000-0000-000000000001";
const input = { companyId, expectedVersion: 0, idempotencyKey: "once", operatingMode: "fleet_only", shopIdentity: { legalName: "Shop", address: "Road", phone: "", email: "" }, step: 3, status: "completed" };
function database() {
  let current; const ledger = new Map(); const audits = [];
  const client = { release() {}, async query(sql, values = []) {
    if (sql.startsWith("select request_hash")) return { rows: ledger.has(values[2]) ? [ledger.get(values[2])] : [] };
    if (sql.startsWith("select * from business_setups")) return { rows: current ? [current] : [] };
    if (sql.startsWith("insert into business_setups")) {
      current = { company_id: values[0], operating_mode: values[1], shop_identity: JSON.parse(values[2]), step: values[3], status: values[4], version: (current?.version || 0) + 1, completed_at: "2026-01-01T00:00:00Z" }; return { rows: [current] };
    }
    if (sql.startsWith("insert into business_setup_audit")) audits.push(JSON.parse(values[2]));
    if (sql.startsWith("insert into business_setup_idempotency")) ledger.set(values[2], { request_hash: values[3], result: JSON.parse(values[4]) });
    return { rows: [] };
  } };
  return { pool: { connect: async () => client }, audits };
}
test("retries replay the original saved setup and do not duplicate audit events", async () => {
  const db = database(); const saved = await saveBusinessSetup(input, "actor", db);
  assert.deepEqual(await saveBusinessSetup(input, "actor", db), saved);
  assert.equal(saved.version, 1); assert.equal(db.audits.length, 1);
  await assert.rejects(saveBusinessSetup({ ...input, step: 2 }, "actor", db), { statusCode: 409, code: "IDEMPOTENCY_KEY_CONFLICT" });
  await assert.rejects(saveBusinessSetup({ ...input, idempotencyKey: "new" }, "actor", db), { statusCode: 409, code: "BUSINESS_SETUP_VERSION_CONFLICT" });
  assert.equal(db.audits.length, 1);
});
