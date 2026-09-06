import assert from "node:assert/strict";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";
import { closePool, getPool } from "../../src/server/db/pool.js";
import { redactQaError } from "./safety.js";
import { runInventoryCustodyLocal, setupInventoryCustodyFixture } from "./inventory-custody-local.js";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);

function localConfig(environment = process.env) {
  const database = new URL(environment.DATABASE_URL || "");
  const baseUrl = new URL(environment.QA_CUSTODY_BASE_URL || "http://localhost:4173");
  if (!LOCAL.has(database.hostname) || !LOCAL.has(baseUrl.hostname) || !["http:", "https:"].includes(baseUrl.protocol)) {
    throw new Error("Inventory lifecycle production QA refuses non-local DATABASE_URL or QA_CUSTODY_BASE_URL.");
  }
  if (!/^inventory_feature_qa_/.test(database.pathname.slice(1))) {
    throw new Error("Inventory lifecycle production QA requires a task-local inventory_feature_qa_* database.");
  }
  return { baseUrl: new URL("/", baseUrl), timeout: Number(environment.QA_CUSTODY_REQUEST_TIMEOUT_MS || 15_000) };
}

function noOverflow(page) {
  return page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth);
}

async function ledgerSnapshot(ready) {
  const result = await getPool().query(`select item.quantity_on_hand::text as on_hand, item.quantity_reserved::text as reserved,
    (select count(*)::int from inventory_stock_movements where company_id=$1 and unit_id=$4 and movement_type='return') as returns
    from inventory_items item where item.company_id=$1 and item.location_id=$2 and item.catalog_part_id=$3 and item.source_provider='local'`,
  [ready.companyId, ready.locationId, ready.catalogPartId, ready.unitId]);
  assert.equal(result.rowCount, 1, "Expected fixture local ledger balance.");
  return result.rows[0];
}

async function browserAcceptance({ config, ready, logger }) {
  const browser = await chromium.launch({ headless: true });
  try {
    const storageState = await ready.clients.admin.storageState();
    const unitNo = (await getPool().query("select unit_no from assets where company_id=$1 and id=$2", [ready.companyId, ready.assetId])).rows[0]?.unit_no;
    const partNumber = (await getPool().query("select part_number from parts_catalog where company_id=$1 and id=$2", [ready.companyId, ready.catalogPartId])).rows[0]?.part_number;
    assert.ok(unitNo, "Fixture asset must have a searchable unit number.");
    for (const width of [1440, 768, 390]) {
      const context = await browser.newContext({ storageState, viewport: { width, height: 844 } });
      const page = await context.newPage();
      await page.goto(new URL("/?adminView=units", config.baseUrl).href, { waitUntil: "networkidle", timeout: config.timeout });
      await page.getByPlaceholder("Unit number, VIN, or plate").fill(unitNo);
      await page.getByRole("row", { name: new RegExp(`Open .*${unitNo}`, "i") }).click({ timeout: config.timeout });
      // Assert the real removal affordance contract when the fixture Unit is navigated by the app.
      const track = page.getByRole("button", { name: "Track removed part" }).first();
      await track.waitFor({ state: "visible", timeout: config.timeout });
      await track.click({ timeout: config.timeout });
      await page.getByRole("region", { name: "Track untracked removed part" }).waitFor({ state: "visible", timeout: config.timeout });
      const catalog = page.getByLabel("Search and select the removed catalog part");
      await catalog.fill(partNumber);
      const option = page.getByRole("option").first();
      await option.click({ timeout: config.timeout });
      await page.getByLabel("Reason", { exact: true }).fill("QA browser removal");
      const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/inventory-reuse/legacy-track"));
      await page.getByRole("button", { name: "Create tracking and handoff" }).click({ timeout: config.timeout });
      const saved = await response;
      assert.equal(saved.ok(), true, await saved.text());
      assert.equal((await saved.json()).case.status, "awaiting_handoff");
      await page.getByRole("button", { name: "Track removed part" }).waitFor({ state: "visible" });
      assert.equal(await noOverflow(page), true, `Unit removal overflowed at ${width}px.`);
      await page.goto(new URL("/?adminView=inventory&view=inventory", config.baseUrl).href, { waitUntil: "networkidle", timeout: config.timeout });
      await page.getByText(/stock|available/i).first().waitFor({ state: "visible", timeout: config.timeout });
      const returns = page.getByRole("button", { name: /returns|repair/i }).or(page.getByRole("tab", { name: /returns|repair/i })).first();
      await returns.click({ timeout: config.timeout });
      await page.getByRole("table", { name: "Returns and repairs" }).waitFor({ state: "visible", timeout: config.timeout });
      assert.equal(await noOverflow(page), true, `Returns overflowed at ${width}px.`);
      await context.close();
      logger.log(`[inventory-lifecycle-production] browser ${width}px passed`);
    }
  } finally { await browser.close(); }
  return true;
}

async function assertExpandedLifecycle({ ready }) {
  const { clients, companyId, locationId, catalogPartId, adminId, receiverId, releaseId, runId } = ready;
  const scope = { companyId, locationId };
  const key = (action) => `lifecycle-${runId}-${action}`;
  // Feature endpoints are real route/schema probes. A 404 is an explicit runtime gap, never success.
  await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: adminId, capabilities: ["remove", "receive", "release", "route", "repair", "disposition", "quarantine"], reason: "Production lifecycle QA capabilities." } });
  await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: receiverId, capabilities: ["receive", "route", "repair", "quarantine"], reason: "Production lifecycle QA receiver." } });
  await clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: releaseId, capabilities: ["release", "disposition"], reason: "Production lifecycle QA disposition." } });
  await clients.admin.request("/api/inventory-reuse/config/policy", { method: "POST", body: { ...scope, catalogPartId, reuseAllowed: true, repairAllowed: true, coreReturnAllowed: true, scrapAllowed: true, evidence: "Production lifecycle QA policy." } });
  const stock = await clients.admin.request(`/api/inventory-reuse/stock?companyId=${companyId}&locationId=${locationId}`, { expectedStatuses: [200] });
  assert.ok(Array.isArray(stock.body?.items), "Stock must be cursor-paginated items.");
  const queue = await clients.admin.request(`/api/inventory-reuse/queue?companyId=${companyId}&locationId=${locationId}`, { expectedStatuses: [200] });
  assert.ok(Array.isArray(queue.body?.items), "Returns queue must be cursor-paginated items.");
  // Wrong serial/foreign identity must fail without a successful case disclosure.
  const wrong = await clients.receiver.request(`/api/inventory-reuse/units/00000000-0000-4000-8000-000000000000?companyId=${companyId}&locationId=${locationId}`, { expectedStatuses: [403, 404] });
  assert.notEqual(wrong.status, 200, "Unknown serial/unit must not resolve.");
  return { key, supported: true };
}

async function removedCase(ready, suffix) {
  const { clients, companyId, locationId, originalWorkorderId, workorderId, removalWorkorderId, unitId, runId } = ready;
  const workorder = originalWorkorderId || workorderId;
  const scope = { companyId, locationId };
  const key = (action) => `production-${runId}-${suffix}-${action}`;
  const issued = await clients.admin.request(`/api/workorders/${workorder}/inventory-units/issue`, { method: "POST", expectedStatuses: [201], body: { unitId, idempotencyKey: key("issue") } });
  const usageId = issued.body?.usage?.id;
  assert.ok(usageId, "Fixture issue did not return usage id.");
  await clients.admin.request(`/api/workorders/${workorder}/inventory-unit-usages/${usageId}/finalize`, { method: "POST", body: { disposition: "installed", idempotencyKey: key("install") } });
  await clients.admin.request(`/api/office/workorders/${workorder}/mark-done`, { method: "POST", body: { diagnosis: "QA", workPerformed: "QA", confirmationName: "QA" } });
  await clients.admin.request(`/api/office/workorders/${workorder}/close`, { method: "POST", body: { note: "QA approval" } });
  await ready.createRemovalWorkorder();
  const expectedVersion = (await getPool().query("select custody_version from inventory_serialized_units where company_id=$1 and id=$2", [companyId, unitId])).rows[0].custody_version;
  const removed = await clients.admin.request("/api/inventory-reuse/remove", { method: "POST", body: { ...scope, expectedVersion, usageId, removalWorkorderId: ready.removalWorkorderId, reason: "Production lifecycle QA", ownership: "company", ownershipEvidence: "Fixture owned", intendedRoute: "not_sure", note: "", idempotencyKey: key("remove") } });
  assert.equal(removed.body?.case?.status, "awaiting_handoff");
  return { scope, key, case: removed.body.case };
}

async function commandJourneys({ environment, logger }) {
  const gates = [];
  const route = async (name, commands) => {
    const ready = await setupInventoryCustodyFixture({ environment, logger });
    try {
      const scope = { companyId: ready.companyId, locationId: ready.locationId };
      await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.adminId, capabilities: ["remove", "receive", "release", "route", "repair", "disposition", "quarantine"], reason: "QA lifecycle admin." } });
      await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.receiverId, capabilities: ["receive", "route", "repair", "quarantine"], reason: "QA lifecycle receiver." } });
      await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.releaseId, capabilities: ["release", "disposition"], reason: "QA lifecycle reviewer." } });
      await ready.clients.admin.request("/api/inventory-reuse/config/policy", { method: "POST", body: { ...scope, catalogPartId: ready.catalogPartId, reuseAllowed: true, repairAllowed: true, coreReturnAllowed: true, scrapAllowed: true, evidence: "QA lifecycle policy." } });
      const state = await removedCase(ready, name); await commands(ready, state); gates.push({ name, passed: true });
    }
    finally { await ready.cleanup(); }
  };
  await route("repair", async (ready, state) => {
    const receive = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Scanned exact serial", actualHolderType: "inventory_location", binLocation: "A-1", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
    const repaired = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/route`, { method: "POST", body: { ...state.scope, route: "repair", evidence: "Damage", expectedVersion: receive.body.case.caseVersion, idempotencyKey: state.key("route") } });
    const started = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/repair/start`, { method: "POST", body: { ...state.scope, handlerType: "internal", handlerReference: "Bench 1", evidence: "Started", expectedVersion: repaired.body.case.caseVersion, idempotencyKey: state.key("start") } });
    const completed = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/repair/complete`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, receiptEvidence: "Exact repaired part physically returned to shop", evidence: "Completed", release: false, inspectionEvidence: "", binLocation: "A-1", expectedVersion: started.body.case.caseVersion, idempotencyKey: state.key("complete") } });
    const before = await ledgerSnapshot(ready);
    const released = await ready.clients.releaser.request(`/api/inventory-reuse/${state.case.id}/release`, { method: "POST", body: { ...state.scope, decision: "release", inspectionEvidence: "Pass", reason: "Refurbishment inspection passed", binLocation: "A-1", expectedVersion: completed.body.case.caseVersion, idempotencyKey: state.key("release") } });
    assert.equal(released.body?.unitProjection?.conditionCode, "refurbished", "Repair release must mark the exact unit refurbished.");
    const after = await ledgerSnapshot(ready);
    assert.equal(Number(after.on_hand), Number(before.on_hand) + 1, "Repair release must restore exactly one local unit.");
    assert.equal(after.returns, before.returns + 1, "Repair release must create one return movement.");
  });
  await route("core", async (ready, state) => {
    const received = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Exact scan", actualHolderType: "inventory_location", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
    const routed = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/route`, { method: "POST", body: { ...state.scope, route: "core_return", evidence: "Core required", expectedVersion: received.body.case.caseVersion, idempotencyKey: state.key("route") } });
    const before = await ledgerSnapshot(ready);
    await ready.clients.releaser.request(`/api/inventory-reuse/${state.case.id}/core-return`, { method: "POST", body: { ...state.scope, evidence: "Vendor handoff", externalReference: "CORE-QA-1", dispositionDate: "2026-09-05", expectedVersion: routed.body.case.caseVersion, idempotencyKey: state.key("terminal") } });
    const after = await ledgerSnapshot(ready);
    assert.deepEqual(after, before, "Core return must not change local ledger or return movements.");
    const replay = await ready.clients.releaser.request(`/api/inventory-reuse/${state.case.id}/core-return`, { method: "POST", body: { ...state.scope, evidence: "Vendor handoff", externalReference: "CORE-QA-1", dispositionDate: "2026-09-05", expectedVersion: routed.body.case.caseVersion, idempotencyKey: state.key("terminal") } });
    assert.equal(replay.body?.replayed, true, "Core terminal retry must replay.");
  });
  await route("scrap", async (ready, state) => {
    const received = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Exact scan", actualHolderType: "inventory_location", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
    const routed = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/route`, { method: "POST", body: { ...state.scope, route: "scrap", evidence: "Unserviceable", expectedVersion: received.body.case.caseVersion, idempotencyKey: state.key("route") } });
    const denied = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/scrap`, { method: "POST", expectedStatuses: [403], body: { ...state.scope, evidence: "Wrong actor", externalReference: "SCRAP-QA-1", dispositionDate: "2026-09-05", expectedVersion: routed.body.case.caseVersion, idempotencyKey: state.key("denied") } });
    assert.equal(denied.status, 403, "Receiver must not dispose.");
    const before = await ledgerSnapshot(ready);
    await ready.clients.releaser.request(`/api/inventory-reuse/${state.case.id}/scrap`, { method: "POST", body: { ...state.scope, evidence: "Disposed", externalReference: "SCRAP-QA-1", dispositionDate: "2026-09-05", expectedVersion: routed.body.case.caseVersion, idempotencyKey: state.key("terminal") } });
    const after = await ledgerSnapshot(ready);
    assert.deepEqual(after, before, "Scrap must not change local ledger or return movements.");
  });
  await route("quarantine", async (ready, state) => {
    const received = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Exact scan", actualHolderType: "unknown", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
    const quarantined = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/route`, { method: "POST", body: { ...state.scope, route: "not_sure", evidence: "Identity needs review", expectedVersion: received.body.case.caseVersion, idempotencyKey: state.key("route") } });
    const resolved = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/quarantine/resolve`, { method: "POST", body: { ...state.scope, resolution: "inspect_for_reuse", evidence: "Identity verified", expectedVersion: quarantined.body.case.caseVersion, idempotencyKey: state.key("resolve") } });
    assert.equal(resolved.body?.case?.status, "received_pending_review", "Quarantine inspect resolution must return to review, not release stock.");
  });
  await route("location-correction", async (ready, state) => {
    const received = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Exact scan", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
    await ready.clients.releaser.request(`/api/inventory-reuse/${state.case.id}/release`, { method: "POST", body: { ...state.scope, decision: "release", inspectionEvidence: "Pass", reason: "Ready for stock", expectedVersion: received.body.case.caseVersion, idempotencyKey: state.key("release") } });
    const current = await ready.clients.admin.request(`/api/inventory-reuse/units/${ready.unitId}?companyId=${ready.companyId}&locationId=${ready.locationId}`);
    const version = current.body?.unit?.custodyVersion;
    assert.ok(version, "Exact unit must expose custodyVersion.");
    const before = await ledgerSnapshot(ready);
    await ready.clients.admin.request("/api/inventory-reuse/location-correction", { method: "POST", body: { ...state.scope, unitId: ready.unitId, custodyVersion: version, expectedVersion: version, holderType: "inventory_location", binLocation: "QA shelf", externalReference: "", evidence: "QA correction", idempotencyKey: state.key("correct") } });
    assert.deepEqual(await ledgerSnapshot(ready), before, "Holder correction must not adjust ledger.");
    const stale = await ready.clients.admin.request("/api/inventory-reuse/location-correction", { method: "POST", expectedStatuses: [409], body: { ...state.scope, unitId: ready.unitId, custodyVersion: version, expectedVersion: version, holderType: "handoff", binLocation: "QA shelf", externalReference: "", evidence: "stale", idempotencyKey: state.key("stale") } });
    assert.equal(stale.status, 409, "Stale holder correction must fail.");
  });
  await route("legacy-track", async (ready, state) => {
    const before = await ledgerSnapshot(ready);
    const created = await ready.clients.admin.request("/api/inventory-reuse/legacy-track", { method: "POST", body: { ...state.scope, assetId: ready.assetId, catalogPartId: ready.catalogPartId, removalWorkorderId: ready.removalWorkorderId, reason: "Legacy physical item", ownership: "unknown", ownershipEvidence: "", intendedRoute: "not_sure", note: "Earlier history unavailable", idempotencyKey: state.key("legacy") } });
    assert.equal(created.body?.case?.status, "awaiting_handoff", "Legacy tracking must create an unavailable handoff case.");
    assert.deepEqual(await ledgerSnapshot(ready), before, "Legacy tracking must not invent stock.");
  });
  return gates;
}

async function choose(page, name, option) {
  await page.getByRole("button", { name }).click();
  await page.getByRole("option", { name: option }).click();
}

export async function browserRepairJourney({ environment = process.env, config = localConfig(environment), logger = console } = {}) {
  const ready = await setupInventoryCustodyFixture({ environment, logger });
  const browser = await chromium.launch({ headless: true });
  try {
    const scope = { companyId: ready.companyId, locationId: ready.locationId };
    await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.adminId, capabilities: ["remove", "receive", "route", "repair"], reason: "Browser repair QA admin." } });
    await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.receiverId, capabilities: ["receive", "route", "repair"], reason: "Browser repair QA receiver." } });
    await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.releaseId, capabilities: ["release"], reason: "Browser repair QA releaser." } });
    await ready.clients.admin.request("/api/inventory-reuse/config/policy", { method: "POST", body: { ...scope, catalogPartId: ready.catalogPartId, reuseAllowed: true, repairAllowed: true, coreReturnAllowed: true, scrapAllowed: true, evidence: "Browser repair QA policy." } });
    const state = await removedCase(ready, "browser-repair");
    const serial = (await getPool().query("select serial_number from inventory_serialized_units where company_id=$1 and id=$2", [ready.companyId, ready.unitId])).rows[0]?.serial_number;
    const open = async (client, queue = "Awaiting handoff") => {
      const context = await browser.newContext({ storageState: await client.storageState(), viewport: { width: 1440, height: 900 } });
      const page = await context.newPage();
      await page.goto(new URL("/?adminView=inventory&view=inventory", config.baseUrl).href, { waitUntil: "networkidle", timeout: config.timeout });
      await page.getByRole("button", { name: "Returns & repairs" }).or(page.getByRole("tab", { name: "Returns & repairs" })).first().click();
      await page.getByRole("button", { name: new RegExp(`^${queue}`) }).or(page.getByRole("tab", { name: new RegExp(`^${queue}`) })).first().click();
      await page.getByText(serial).first().click();
      return { context, page };
    };
    const confirm = async (page) => {
      const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/inventory-reuse/"));
      await page.getByRole("button", { name: "Confirm", exact: true }).click();
      const saved = await response;
      assert.equal(saved.ok(), true, `Browser command failed: ${await saved.text()}`);
    };
    const scan = async (page) => {
      const response = page.waitForResponse((r) => r.url().includes("/api/inventory-reuse/scan"));
      await page.getByLabel(/Exact QR or serial/).fill(serial);
      await page.getByLabel(/Exact QR or serial/).blur();
      const result = await response;
      assert.equal(result.ok(), true, "Exact serial scan failed.");
      await result.finished();
    };
    let ui = await open(ready.clients.receiver);
    await ui.page.getByRole("button", { name: "Receive" }).click();
    await scan(ui.page);
    await ui.page.getByLabel("Evidence").fill("Browser exact receive");
    await confirm(ui.page);
    await ui.context.close();
    ui = await open(ready.clients.receiver, "Needs inspection");
    await ui.page.getByRole("button", { name: "Inspect and route" }).click();
    await ui.page.getByLabel("Evidence").fill("Browser repair route");
    await choose(ui.page, "Next action", "Repair/refurbish");
    await confirm(ui.page);
    await ui.context.close();
    ui = await open(ready.clients.receiver, "Repair/refurbish");
    await ui.page.getByRole("button", { name: "Start repair" }).click();
    await choose(ui.page, "Repair handler", "Internal repair");
    await ui.page.getByLabel("Vendor or area").fill("QA bench");
    await ui.page.getByLabel("Evidence").fill("Browser repair start");
    await confirm(ui.page);
    await ui.context.close();
    // Completion/release uses another authorized session to prove persisted state and optional multi-operator continuity.
    ui = await open(ready.clients.receiver, "Repair/refurbish");
    await ui.page.getByRole("button", { name: "Complete repair" }).click();
    await scan(ui.page);
    await ui.page.getByLabel("Evidence", { exact: true }).fill("Browser repair complete");
    await ui.page.getByLabel("Physical return evidence", { exact: true }).fill("Exact repaired part returned to QA shop");
    await ui.page.getByLabel("Bin or shelf", { exact: true }).fill("QA-A1");
    await confirm(ui.page); await ui.context.close();
    ui = await open(ready.clients.releaser, "Needs inspection");
    await ui.page.getByRole("button", { name: "Release to stock" }).click(); await ui.page.getByLabel("Evidence").fill("Browser release evidence"); await ui.page.getByLabel("Inspection decision").fill("Passed"); await confirm(ui.page); await ui.context.close();
    const unit = (await ready.clients.admin.request(`/api/inventory-reuse/units/${ready.unitId}?companyId=${ready.companyId}&locationId=${ready.locationId}`)).body.unit;
    assert.equal(unit.conditionCode, "refurbished", "Browser repair workflow did not persist refurbished condition.");
    const ledger = await ledgerSnapshot(ready); assert.equal(ledger.returns, 1, "Browser repair workflow must create exactly one return movement.");
    return true;
  } finally { await browser.close(); await ready.cleanup(); }
}

export async function browserLegacyJourney({ environment = process.env, config = localConfig(environment), logger = console } = {}) {
  const ready = await setupInventoryCustodyFixture({ environment, logger });
  try { await assertExpandedLifecycle({ ready }); return await browserAcceptance({ config, ready, logger }); }
  finally { await ready.cleanup(); }
}

export async function browserDispositionJourneys({ environment = process.env, config = localConfig(environment), logger = console } = {}) {
  const browser = await chromium.launch({ headless: true });
  const gates = [];
  try {
    for (const [route, queue, label, width] of [["core_return", "Core returns", "Confirm core return", 1440], ["scrap", "Scrap approval", "Confirm scrap", 390]]) {
      const ready = await setupInventoryCustodyFixture({ environment, logger });
      try {
        await assertExpandedLifecycle({ ready });
        const state = await removedCase(ready, `browser-${route}`);
        const received = await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/receive`, { method: "POST", body: { ...state.scope, exactUnitId: ready.unitId, evidence: "Verified physical receipt", expectedVersion: state.case.caseVersion, idempotencyKey: state.key("receive") } });
        await ready.clients.receiver.request(`/api/inventory-reuse/${state.case.id}/route`, { method: "POST", body: { ...state.scope, route, evidence: "Inspection disposition", expectedVersion: received.body.case.caseVersion, idempotencyKey: state.key("route") } });
        const before = await ledgerSnapshot(ready);
        const context = await browser.newContext({ storageState: await ready.clients.releaser.storageState(), viewport: { width, height: 844 } });
        const page = await context.newPage();
        await page.goto(new URL("/?view=inventory", config.baseUrl).href, { waitUntil: "networkidle" });
        await page.getByRole("button", { name: "Returns & repairs" }).click();
        await page.getByRole("button", { name: new RegExp(`^${queue}`) }).click();
        await page.getByRole("row").filter({ hasText: state.case.serialNumber }).click();
        await page.getByRole("button", { name: label, exact: true }).click();
        await page.getByLabel("Evidence", { exact: true }).fill("QA terminal inspection and handoff");
        await page.getByLabel(route === "scrap" ? /Scrap destination or reference/ : /Core return reference/).fill("QA destination ref-123");
        await page.getByLabel(route === "scrap" ? /Scrap date/ : /Core return date/).fill("2026-09-05");
        const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes(`/api/inventory-reuse/${state.case.id}/`));
        await page.getByRole("button", { name: "Confirm", exact: true }).click();
        const saved = await response;
        assert.equal(saved.ok(), true, await saved.text());
        assert.deepEqual(await ledgerSnapshot(ready), before);
        assert.equal(await noOverflow(page), true, `Terminal form overflowed at ${width}px.`);
        const detail = (await ready.clients.releaser.request(`/api/inventory-reuse/units/${ready.unitId}?companyId=${ready.companyId}&locationId=${ready.locationId}`)).body;
        const terminal = detail.timeline.find((event) => event.eventType === (route === "scrap" ? "reuse_scrapped" : "reuse_core_returned"));
        assert.equal(terminal?.details?.externalReference, "QA destination ref-123");
        assert.equal(terminal?.details?.dispositionDate, "2026-09-05");
        await context.close(); gates.push({ route, width, passed: true });
        logger.log(`[inventory-lifecycle-production] browser ${route} ${width}px passed`);
      } finally { await ready.cleanup(); }
    }
    return gates;
  } finally { await browser.close(); }
}

export async function runInventoryLifecycleProduction({ environment = process.env, logger = console } = {}) {
  const config = localConfig(environment);
  // Baseline exercises approved removal, pending accounting, scan/receive, release/reinstall, replay and tenant/permission negatives.
  const baseline = await runInventoryCustodyLocal({ environment, logger });
  const ready = await setupInventoryCustodyFixture({ environment, logger });
  try {
    const expanded = await assertExpandedLifecycle({ ready });
    const journeys = await commandJourneys({ environment, logger });
    const browserRepair = await browserRepairJourney({ environment, config, logger });
    const dispositions = await browserDispositionJourneys({ environment, config, logger });
    const browser = await browserAcceptance({ config, ready, logger });
    return { passed: Boolean(baseline?.passed && expanded?.supported && browser && browserRepair && dispositions.every((gate) => gate.passed) && journeys.every((gate) => gate.passed)), baseline, expanded, journeys, dispositions, missingGates: [] };
  } finally { await ready.cleanup().catch(() => {}); }
}

if (fileURLToPath(import.meta.url) === process.argv[1]) {
  try {
    const result = await runInventoryLifecycleProduction();
    console.log(JSON.stringify({ passed: result.passed, missingGates: result.missingGates }));
    if (!result.passed) process.exitCode = 1;
  } catch (error) {
    console.error(redactQaError(error));
    process.exitCode = 1;
  } finally { await closePool().catch(() => {}); }
}
