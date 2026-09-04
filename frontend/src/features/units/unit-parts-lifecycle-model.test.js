import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { assetReusePath, canReleaseCase, caseStage, clearReuseRecovery, eligibleRemovalWorkorders, readReuseRecovery, restoreReuseRecovery, reuseOperationPath, reuseScope, saveReuseRecovery } from "./unit-parts-lifecycle-model.js";

test("reuse requests stay within the selected unit company and location", () => {
  const scope = reuseScope({ company_id: "company-1", locationId: "location-1" });
  assert.deepEqual(scope, { companyId: "company-1", locationId: "location-1" });
  assert.equal(assetReusePath("part / 1", scope), "/api/inventory-reuse/asset/part%20%2F%201?companyId=company-1&locationId=location-1");
  assert.equal(reuseOperationPath("operation / 1", scope), "/api/inventory-reuse/operations/operation%20%2F%201?companyId=company-1&locationId=location-1");
});

test("pending installation may be removed on its original active workorder, unlike approved installation", () => {
  const workorders = [{ id: "original" }, { id: "new" }];
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed_pending_approval", workorderId: "original" }, workorders), workorders);
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed", workorderId: "original" }, workorders), [{ id: "new" }]);
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed", workorderId: "original" }, []), []);
});

test("empty removal workorders offer existing creation navigation but never while outcome is unknown", () => {
  const surface = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  assert.match(surface, /createWorkorderSearch\(\)/);
  assert.match(surface, /Ask your office team to create or activate a workorder for this unit/);
  assert.match(surface, /!pendingRequest \? <a className="button secondary" href=\{createWorkorderSearch\(\)\}/);
});

test("custody guidance uses collapsed shared help while operational errors stay visible", () => {
  const lifecycle = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./UnitsWorkspace.jsx", import.meta.url), "utf8");
  const help = readFileSync(new URL("../../components/workorders/SectionHelpDisclosure.jsx", import.meta.url), "utf8");
  assert.match(workspace, /<SectionHelpDisclosure label="Parts custody help">/);
  assert.match(help, /useState\(false\)/);
  assert.match(help, /hidden=\{!open\}/);
  assert.match(lifecycle, /className="unit-parts-error" role="alert"/);
  assert.doesNotMatch(workspace, /subtitle="Find a truck or trailer/);
});

test("uncertain custody command recovery round-trips only in the original actor scope and clears on confirmation", () => {
  const values = new Map(); const storage = { getItem: (key) => values.get(key) || null, setItem: (key, value) => values.set(key, value), removeItem: (key) => values.delete(key) };
  const scope = { actorId: "actor-1", companyId: "company-1", locationId: "location-1", assetId: "asset-1" };
  const command = { path: "/api/inventory-reuse/remove", body: { idempotencyKey: "key-12345678" } };
  assert.equal(saveReuseRecovery(storage, scope, command), true);
  assert.deepEqual(readReuseRecovery(storage, scope), command);
  const restoredKeys = new Set();
  assert.deepEqual(restoreReuseRecovery(storage, scope, restoredKeys), command);
  assert.equal(restoreReuseRecovery(storage, scope, restoredKeys), null);
  assert.equal(readReuseRecovery(storage, { ...scope, actorId: "actor-2" }), null);
  assert.equal(clearReuseRecovery(storage, scope), true);
  assert.equal(readReuseRecovery(storage, scope), null);
  values.set("inventory-reuse-recovery:actor-1:company-1:location-1:asset-1", "not-json");
  assert.equal(readReuseRecovery(storage, scope), null);
});

test("only physically received, known-ownership cases can be released", () => {
  assert.equal(canReleaseCase({ status: "received_pending_review", ownership: "company" }, { release: true }), true);
  assert.equal(canReleaseCase({ status: "hold", ownership: "company" }, { release: true }), true);
  assert.equal(canReleaseCase({ status: "received_pending_review", ownership: "customer" }, { release: true }), false);
  assert.equal(canReleaseCase({ status: "received_pending_review", ownership: "unknown" }, { release: true }), false);
  assert.equal(canReleaseCase({ status: "awaiting_handoff", ownership: "company" }, { release: true }), false);
  assert.equal(caseStage("awaiting_handoff"), "Receive");
  assert.equal(caseStage("received_pending_review"), "Review");
  assert.equal(caseStage("hold"), "On hold");
  assert.equal(caseStage("released"), "Released to stock");
});
