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

test("custody uses the serialized lifecycle location instead of the unit home location", () => {
  assert.deepEqual(
    reuseScope({ companyId: "company-1", locationId: "home-location", custodyLocationId: "installed-at-location" }),
    { companyId: "company-1", locationId: "installed-at-location" },
  );
});

test("pending installation may be removed on its original active workorder, unlike approved installation", () => {
  const workorders = [{ id: "original" }, { id: "new" }];
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed_pending_approval", workorderId: "original" }, workorders), workorders);
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed", workorderId: "original" }, workorders), [{ id: "new" }]);
  assert.deepEqual(eligibleRemovalWorkorders({ status: "installed", workorderId: "original" }, []), []);
});

test("removal derives safe workorder context and exposes creation only as an exception", () => {
  const surface = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  const workspace = readFileSync(new URL("./UnitsWorkspace.jsx", import.meta.url), "utf8");
  assert.match(surface, /unit-parts-lifecycle--focused/);
  assert.match(surface, /removalFormRef\.current\?\.scrollIntoView\(\{ block: "start" \}\)/);
  assert.match(surface, /onModeChange\?\.\(active\?\.kind === "remove" \? "remove" : ""\)/);
  assert.match(workspace, /selected && !detailMode/);
  assert.match(workspace, /className=\{detailMode \? "unit-parts-focused-section" : ""\}/);
  assert.match(surface, /Workorder will be created automatically/);
  assert.match(surface, /Ask Office or Admin to assign an active workorder/);
  assert.doesNotMatch(surface, /Request workorder/);
  assert.match(surface, /intendedRoute/);
  assert.match(surface, /<option value="inspect_for_reuse">Inspect for reuse<\/option>/);
  assert.doesNotMatch(surface, /<option value="inspect_reuse">/);
  assert.match(surface, /expectedVersion: item\.custodyVersion/);
  assert.match(surface, /eligibleWorkorders\.length === 1 \? eligibleWorkorders\[0\]\.id : ""/);
  assert.match(surface, /\.\.\.\(removalWorkorderId\s+\? \{ removalWorkorderId \}/);
  assert.match(surface, /!data\?\.canCreateRemovalWorkorder/);
  assert.match(surface, />Remove part</);
  assert.match(surface, /<summary>Add note<\/summary>/);
});

test("unit lifecycle never renders stale parts or dereferences capabilities before its scope loads", () => {
  const surface = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  assert.match(surface, /setData\(null\);\s+setError\(""\);/);
  assert.match(surface, /if \(!data\)\s+return \(/);
  assert.doesNotMatch(surface, /!data\.capabilities/);
});

test("every tracked removal declares ownership and fails closed without request storage", () => {
  const surface = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(surface, /active\.item\.ownershipRequired/);
  assert.match(surface, /<option value="company">Company<\/option>/);
  assert.match(surface, /ownership: "unknown"/);
  assert.match(surface, /if \(!saveReuseRecovery\(recoveryStorage\(\), recoveryScope, request\)\)/);
  assert.match(surface, /This action cannot be saved until session storage is available/);
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

test("admin reuse setup exposes explicit route, repair, disposition, quarantine, and policy controls", () => {
  const setup = readFileSync(new URL("./ReuseSetup.jsx", import.meta.url), "utf8");
  for (const capability of ["route", "repair", "disposition", "quarantine"]) assert.match(setup, new RegExp(`\\b${capability}\\b`));
  for (const policy of ["repairAllowed", "coreReturnAllowed", "scrapAllowed", "evidence"]) assert.match(setup, new RegExp(`\\b${policy}\\b`));
  assert.match(setup, /Save permissions/);
  assert.match(setup, /Save part policy/);
  assert.match(setup, /<PartCatalogCombobox/);
  assert.match(setup, /catalogEndpoint="\/api\/office\/inventory\/catalog"/);
  assert.match(setup, /catalogPartId: part\.id/);
  assert.doesNotMatch(setup, /data\.parts\.map/);
});

test("legacy tracking uses the catalog selector and never accepts a typed catalog ID", () => {
  const source = readFileSync(new URL("./UnitPartsLifecycle.jsx", import.meta.url), "utf8");
  assert.match(source, /<PartCatalogCombobox/);
  assert.match(source, /catalogEndpoint="\/api\/office\/inventory\/catalog"/);
  assert.match(source, /catalogPartId: part\.id/);
  assert.match(source, /catalogPartId: ""/);
  assert.match(source, /Earlier physical history unavailable/);
  assert.match(source, /aria-label="Legacy next action"/);
  assert.match(source, /aria-label="Legacy ownership"/);
});
