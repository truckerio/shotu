import assert from "node:assert/strict";
import { chromium } from "playwright";
import { getPool } from "../../src/server/db/pool.js";
import { setupInventoryCustodyFixture } from "./inventory-custody-local.js";

async function prepareInstalled(ready) {
  const scope = { companyId: ready.companyId, locationId: ready.locationId };
  const key = (action) => `unit-browser-${ready.runId}-${action}`;
  await ready.clients.admin.request("/api/inventory-reuse/config/grant", { method: "POST", body: { ...scope, userId: ready.adminId, capabilities: ["remove", "receive", "release", "route"], reason: "Browser remove and return QA." } });
  await ready.clients.admin.request("/api/inventory-reuse/config/policy", { method: "POST", body: { ...scope, catalogPartId: ready.catalogPartId, reuseAllowed: true, repairAllowed: true, coreReturnAllowed: true, scrapAllowed: true, evidence: "Browser QA approved reuse policy." } });
  const workorderId = ready.originalWorkorderId || ready.workorderId;
  const issued = await ready.clients.admin.request(`/api/workorders/${workorderId}/inventory-units/issue`, { method: "POST", expectedStatuses: [201], body: { unitId: ready.unitId, idempotencyKey: key("issue") } });
  const usageId = issued.body?.usage?.id;
  assert.ok(usageId, "Fixture issue did not create an exact usage.");
  await ready.clients.admin.request(`/api/workorders/${workorderId}/inventory-unit-usages/${usageId}/finalize`, { method: "POST", body: { disposition: "installed", idempotencyKey: key("install") } });
  await ready.clients.admin.request(`/api/office/workorders/${workorderId}/mark-done`, { method: "POST", body: { diagnosis: "Browser QA", workPerformed: "Installed exact unit", confirmationName: "QA" } });
  await ready.clients.admin.request(`/api/office/workorders/${workorderId}/close`, { method: "POST", body: { note: "Browser QA approval" } });
  return { scope, usageId };
}

async function fixtureUnitNo(ready) {
  const result = await getPool().query(`select a.unit_no,u.serial_number
    from assets a cross join inventory_serialized_units u
    where a.company_id=$1 and a.id=$2 and u.company_id=$1 and u.id=$3`, [ready.companyId, ready.assetId, ready.unitId]);
  assert.equal(result.rowCount, 1, "Fixture asset is missing.");
  return { unitNo: result.rows[0].unit_no, serialNumber: result.rows[0].serial_number };
}

async function assertRemoved(ready, usageId) {
  const result = await getPool().query(`select u.status as unit_status,c.status as case_status,
    (select count(*)::int from inventory_stock_movements where company_id=$1 and unit_id=$2 and movement_type='return') as returns,
    (select count(*)::int from inventory_unit_events where company_id=$1 and unit_id=$2 and event_type='removed') as removed_events,
    u.receipt_id=$4::uuid as receipt_preserved,c.removal_workorder_id is null as direct_removal
    from inventory_serialized_units u join inventory_reuse_cases c on c.company_id=u.company_id and c.unit_id=u.id
    where u.company_id=$1 and u.id=$2 and c.usage_id=$3`, [ready.companyId, ready.unitId, usageId, ready.receiptId]);
  assert.deepEqual(result.rows[0], { unit_status: "removed", case_status: "awaiting_handoff", returns: 0, removed_events: 1, receipt_preserved: true, direct_removal: true }, "Installed removal must preserve identity/receipt and create a direct handoff without return stock.");
}

async function assertReturned(ready, usageId) {
  const result = await getPool().query(`select u.status as unit_status,u.condition_code,c.status as case_status,
    (select count(*)::int from inventory_stock_movements where company_id=$1 and unit_id=$2 and movement_type='return') as returns,
    (select count(*)::int from inventory_unit_events where company_id=$1 and unit_id=$2 and event_type in ('reuse_received','reuse_released')) as return_events
    from inventory_serialized_units u join inventory_reuse_cases c on c.company_id=u.company_id and c.unit_id=u.id
    where u.company_id=$1 and u.id=$2 and c.usage_id=$3`, [ready.companyId, ready.unitId, usageId]);
  assert.deepEqual(result.rows[0], { unit_status: "in_stock", condition_code: "serviceable_used", case_status: "released", returns: 1, return_events: 2 });
}

async function runViewport({ ready, config, width, logger }) {
  const prepared = await prepareInstalled(ready);
  const { unitNo, serialNumber } = await fixtureUnitNo(ready);
  const browser = await chromium.launch({ headless: true });
  let page;
  try {
    const context = await browser.newContext({ storageState: await ready.clients.admin.storageState(), viewport: { width, height: 844 } });
    page = await context.newPage();
    page.on("pageerror", (error) => logger.log(`[inventory-unit-removal-browser] ${error.stack || error.message}`));
    page.on("console", (message) => { if (message.type() === "error") logger.log(`[inventory-unit-removal-browser] ${message.text()}`); });
    await page.goto(new URL("/?adminView=units&view=units", config.baseUrl).href, { waitUntil: "networkidle", timeout: config.timeout });
    await page.getByPlaceholder("Unit number, VIN, or plate").fill(unitNo);
    await page.getByRole("row", { name: new RegExp(`Open .*${unitNo}`, "i") }).click();
    const removeEntry = page.getByRole("button", { name: "Remove part", exact: true });
    const removeEntryStyle = await removeEntry.evaluate((element) => {
      const style = getComputedStyle(element);
      return {
        backgroundColor: style.backgroundColor,
        color: style.color,
        cursor: style.cursor,
        opacity: style.opacity,
        height: element.getBoundingClientRect().height,
      };
    });
    assert.equal(removeEntryStyle.backgroundColor, "rgb(21, 112, 239)", "Enabled removal entry needs the primary fill.");
    assert.equal(removeEntryStyle.color, "rgb(255, 255, 255)", "Enabled removal entry needs high-contrast text.");
    assert.equal(removeEntryStyle.cursor, "pointer", "Enabled removal entry needs an interactive cursor.");
    assert.equal(removeEntryStyle.opacity, "1", "Enabled removal entry must not resemble the disabled state.");
    assert.ok(removeEntryStyle.height >= 44, `Removal target is too short at ${width}px: ${removeEntryStyle.height}px.`);
    await removeEntry.click();
    await page.getByRole("region", { name: "Remove tracked part" }).waitFor({ state: "visible" });
    assert.equal(await page.getByRole("heading", { name: "Tracked installed parts" }).isVisible(), false, "Removal must hide unrelated custody sections.");
    assert.equal(await page.getByLabel("Note", { exact: true }).isVisible(), false, "Optional note must stay collapsed.");
    await page.getByRole("button", { name: "Back", exact: true }).click();
    assert.equal(await page.getByRole("heading", { name: "Overview" }).isVisible(), true, "Back must restore unit context.");
    await removeEntry.click();
    await page.getByRole("button", { name: "Removal reason" }).click();
    await page.getByRole("option", { name: "Failed" }).click();
    await page.getByRole("button", { name: "Intended route" }).click();
    await page.getByRole("option", { name: "Inspect for reuse" }).click();
    const ownership = page.getByRole("button", { name: "Part ownership" });
    assert.equal(await ownership.count(), 0, "Proven company inventory must not ask for ownership.");
    assert.equal(await page.getByLabel("Ownership proof").count(), 0, "Proven company inventory must not ask for ownership proof.");
    const primary = page.getByRole("button", { name: "Remove part", exact: true });
    const primaryBox = await primary.boundingBox();
    assert.ok(primaryBox && primaryBox.y + primaryBox.height <= 844, `Primary removal action is below the first viewport at ${width}px: ${JSON.stringify(primaryBox)}.`);
    const response = page.waitForResponse((r) => r.request().method() === "POST" && r.url().endsWith("/api/inventory-reuse/remove"));
    await primary.click();
    const saved = await response;
    assert.equal(saved.ok(), true, await saved.text());
    assert.equal((await saved.json()).case.status, "awaiting_handoff");
    await page.getByRole("region", { name: "Remove tracked part" }).waitFor({ state: "hidden", timeout: config.timeout });
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Removal overflows at ${width}px.`);
    await context.close();
    await assertRemoved(ready, prepared.usageId);
    const returnContext = await browser.newContext({ storageState: await ready.clients.admin.storageState(), viewport: { width, height: 844 } });
    page = await returnContext.newPage();
    await page.goto(new URL("/?adminView=inventory", config.baseUrl).href, { waitUntil: "networkidle", timeout: config.timeout });
    await page.getByRole("button", { name: "Returns & repairs", exact: true }).click();
    await page.getByRole("row").filter({ hasText: serialNumber }).click();
    await page.getByRole("heading", { name: "Return part", exact: true }).waitFor({ state: "visible" });
    assert.equal(await page.getByLabel("Evidence", { exact: true }).count(), 0, "Normal return must not ask for evidence.");
    assert.equal(await page.getByLabel("Next action", { exact: true }).count(), 0, "Normal return must not ask for a second route decision.");
    assert.equal(await page.getByLabel("Note", { exact: true }).isVisible(), false, "Return note must stay collapsed.");
    const serial = page.getByLabel(/Exact QR or serial/);
    await serial.fill(serialNumber);
    await serial.press("Tab");
    await page.getByText(new RegExp(`Matched serial ${serialNumber}`)).waitFor();
    await page.getByRole("button", { name: "Returned part condition" }).click();
    await page.getByRole("option", { name: "Ready to reuse" }).click();
    const returnResponse = page.waitForResponse((r) => r.request().method() === "POST" && r.url().includes("/api/inventory-reuse/") && r.url().endsWith("/return"));
    await page.getByRole("button", { name: "Return to inventory", exact: true }).click();
    const returned = await returnResponse;
    assert.equal(returned.ok(), true, await returned.text());
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth), true, `Return flow overflows at ${width}px.`);
    await returnContext.close();
    await assertReturned(ready, prepared.usageId);
    logger.log(`[inventory-unit-removal-browser] ${width}px passed`);
  } catch (error) {
    logger.log((await page?.locator("body").innerText())?.slice(-10000));
    throw error;
  } finally { await browser.close(); }
}

export async function runInventoryUnitRemovalBrowser({ config, logger = console, environment = process.env } = {}) {
  assert.ok(config?.baseUrl && config?.timeout, "A validated local QA config is required.");
  const results = [];
  for (const width of [1440, 768, 390]) {
    const ready = await setupInventoryCustodyFixture({ environment, logger });
    try { await runViewport({ ready, config, width, logger }); results.push(width); }
    finally { await ready.cleanup(); }
  }
  return { passed: true, widths: results };
}
