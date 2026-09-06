import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("custody inventory reads server-derived stock and every queue through scoped cursors", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /\/api\/inventory-reuse\/stock/);
  assert.match(source, /\/api\/inventory-reuse\/queue/);
  assert.match(source, /\/stock\/\$\{encodeURIComponent\(selectedPart\.catalogPartId\)\}\/units/);
  assert.match(source, /companyId, locationId/);
  assert.match(source, /nextCursor/);
  assert.match(source, /Awaiting handoff/);
  assert.match(source, /Needs inspection/);
  assert.match(source, /Repair\/refurbish/);
  assert.match(source, /\["repair_refurbish", "Repair\/refurbish"\]/);
  assert.match(source, /Core returns/);
  assert.match(source, /Scrap approval/);
  assert.match(source, /Quarantine/);
  assert.match(source, /Completed/);
});

test("custody actions include concurrency and idempotency guards and leave errors visible", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  for (const route of ["receive", "route", "repair/start", "repair/complete", "release", "core-return", "scrap", "quarantine/resolve"]) assert.match(source, new RegExp(route.replace("/", "\\/")));
  assert.match(source, /custodyCommandBody/);
  assert.match(source, /idempotencyKey: crypto\.randomUUID\(\)/);
  assert.match(source, /error\.status === 409/);
  assert.match(source, /role="alert"/);
  assert.match(source, /custodyHolderType/);
  assert.match(source, /Not classified/);
});

test("receipt cannot be submitted until the exact scanned identity matches the returned unit", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[exactIdentityId, setExactIdentityId\]/);
  assert.match(source, /expectedId && scanned\.id !== expectedId/);
  assert.match(source, /\["receive", "repair\/complete"\]\.includes\(action\) && !exactIdentityId/);
  assert.match(source, /exactUnitId: exactIdentityId/);
  assert.match(source, /Scan or validate the exact QR or serial before receiving this part/);
  assert.match(source, /setExactIdentityId\(\"\"\)/);
  assert.match(source, /Matched serial/);
  assert.match(source, /aria-label="Next action"/);
  assert.match(source, /aria-label="Repair handler"/);
  assert.match(source, /receiptEvidence/);
});

test("queue and repair actions use the lifecycle statuses returned by the server", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  for (const value of ["core_returns", "scrap_approval", "core_pending_return", "scrap_pending_approval", "repairStarted", "repair/start", "repair/complete", "caps.route"]) assert.match(source, new RegExp(value.replace("/", "\\/")));
});

test("a release-only operator can release reviewed and completed-repair cases", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /"repair_complete_pending_review"/);
  assert.match(source, /capabilities\.release/);
  assert.match(source, /return "release"/);
  assert.match(source, /return "Release to stock"/);
});

test("custody history and available exact units use the server custody projection", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /event\.eventType/);
  assert.match(source, /details\.dispositionDate/);
  assert.match(source, /custodyLegacyAvailable === true/);
  assert.doesNotMatch(source, /unit\.ready/);
});

test("a saved custody request can only be checked or replayed with its original request", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /const \[retryAllowed, setRetryAllowed\]/);
  assert.match(source, /if \([\s\S]*pendingRequest[\s\S]*\)\s+return;/);
  assert.match(source, /async function retrySavedRequest\(\)/);
  assert.match(source, /api\(pendingRequest\.path/);
  assert.match(source, /JSON\.stringify\(pendingRequest\.body\)/);
  assert.match(source, /INVENTORY_REUSE_OPERATION_NOT_FOUND/);
  assert.match(source, /!pendingRequest && nextAction/);
  assert.match(source, /!pendingRequest && detail\?\.unit && caps\.route/);
});

test("location correction is state-appropriate and cannot act as a holder transfer", async () => {
  const source = await readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, /const hasStaleLocationDetail/);
  assert.match(source, /const canCorrectLocationDetail/);
  assert.match(source, /unit\?\.status === "removed" && unit\?\.custodyHolderType === "handoff" && hasStaleLocationDetail\(unit\)/);
  assert.match(source, /Clear stale location detail/);
  assert.match(source, /preserving Handoff custody/);
  assert.match(source, /holderType: detail\.unit\.custodyHolderType/);
  assert.doesNotMatch(source, /aria-label="Correction holder type"/);
  assert.doesNotMatch(source, /<option value="external_repair">/);
});
