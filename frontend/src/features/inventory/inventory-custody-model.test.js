import assert from "node:assert/strict";
import test from "node:test";
import { custodyCommandBody, custodyExpectedVersion, custodyReleaseBlocker, custodyRoute } from "./inventory-custody-model.js";

test("custody commands retain authoritative case version and normalize legacy route spelling", () => {
  assert.equal(custodyExpectedVersion({ caseVersion: 7, version: 2 }, {}), 7);
  assert.equal(custodyExpectedVersion({}, { case: { version: 4 } }), 4);
  assert.equal(custodyRoute("inspect_reuse"), "inspect_for_reuse");
  assert.equal(custodyRoute("scrap"), "scrap");
});

test("release and quarantine payloads meet their distinct strict contracts", () => {
  const base = { scope: { companyId: "company", locationId: "location" }, caseItem: { caseVersion: 3 }, detail: {}, idempotencyKey: "idempotency-123", draft: { evidence: "inspected", reason: "safe", binLocation: "A-1", route: "inspect_reuse" } };
  assert.deepEqual(custodyCommandBody({ ...base, action: "release" }), { companyId: "company", locationId: "location", expectedVersion: 3, idempotencyKey: "idempotency-123", decision: "release", inspectionEvidence: "inspected", reason: "safe", binLocation: "A-1" });
  assert.deepEqual(custodyCommandBody({ ...base, action: "quarantine/resolve" }).resolution, "inspect_for_reuse");
});

test("one return command carries only exact identity, outcome, and optional note", () => {
  const body = custodyCommandBody({
    action: "return",
    scope: { companyId: "company", locationId: "location" },
    caseItem: { caseVersion: 5 },
    detail: {},
    exactIdentityId: "unit-1",
    idempotencyKey: "idempotency-123",
    draft: { evidence: "hidden noise", outcome: "reuse", note: "  tread is good  " },
  });
  assert.deepEqual(body, {
    companyId: "company",
    locationId: "location",
    expectedVersion: 5,
    idempotencyKey: "idempotency-123",
    exactUnitId: "unit-1",
    outcome: "reuse",
    note: "tread is good",
  });
});

test("release blocker explains missing reuse approval and routes each role to a usable next step", () => {
  const held = { status: "hold", reuseAllowed: null, partNumber: "Tire", description: "295/75R22.5" };
  const admin = custodyReleaseBlocker(held, { release: true, configure: true });
  assert.equal(admin.title, "Release blocked: reuse approval needed");
  assert.match(admin.message, /will stay on hold/);
  assert.match(admin.nextStep, /Open Reuse settings/);
  assert.match(admin.nextStep, /policy evidence/);

  const operator = custodyReleaseBlocker(held, { release: true, configure: false });
  assert.match(operator.nextStep, /Ask an administrator/);
  assert.equal(custodyReleaseBlocker({ ...held, reuseAllowed: true }, { release: true, configure: true }), null);
  assert.equal(custodyReleaseBlocker(held, { release: false, configure: true }), null);
});
