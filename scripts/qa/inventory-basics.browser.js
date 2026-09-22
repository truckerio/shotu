// Local-only authenticated browser proof. Provision the disposable fixture using first-admin.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { RoleApiClient } from "./e2e/api-client.js";

const baseUrl = new URL(process.env.QA_INVENTORY_BASICS_URL || "http://localhost:4173");
const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname), "Browser fixture refuses remote hosts");
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && /^\/inventory_basics_/.test(database.pathname), "Use a disposable inventory_basics_ database only");
const output = process.env.QA_INVENTORY_BASICS_OUTPUT;
assert.ok(output, "QA_INVENTORY_BASICS_OUTPUT is required");
await mkdir(output, { recursive: true });
const client = await RoleApiClient.create({ role: "admin", baseUrl, timeoutMs: 20000 });
let browser;
let page;
try {
  await client.authenticate({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  const template = (await client.request("/api/office/template")).body;
  const location = template.locations[0].location;
  const suffix = randomUUID().slice(0, 8);
  const partNumber = `BASIC-${suffix}`;
  const part = (await client.request("/api/office/inventory/parts", {
    method: "POST", expectedStatuses: [201], body: { locationId: location.id, partNumber, description: "Browser inventory filter", uomCode: "ea", trackingMode: "quantity" },
  })).body.part;
  browser = await chromium.launch();
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: { width: 1440, height: 1000 } });
  page = await context.newPage();
  const errors = []; page.on("pageerror", error => errors.push(error.message));
  await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`);
  await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber);
  await page.getByText(partNumber, { exact: true }).click();
  await page.getByText("Configured prices", { exact: true }).waitFor();
  const selling = page.locator(".inventory-commercial-price").filter({ hasText: "Selling price" });
  await selling.getByRole("button", { name: "Change", exact: true }).click();
  await selling.getByLabel("Amount", { exact: true }).fill("24.50");
  await selling.getByRole("button", { name: /Currency/ }).click(); await page.getByRole("option", { name: "USD", exact: true }).click();
  await selling.getByLabel("Reason", { exact: true }).fill("Opening browser price");
  const saveResponse = page.waitForResponse(response => response.url().endsWith("/prices/selling") && response.request().method() === "PUT");
  await selling.getByRole("button", { name: "Save", exact: true }).click();
  const saved = await saveResponse;
  assert.equal(saved.status(), 200, await saved.text());
  await selling.getByText(/24\.50/).waitFor();
  const commercial = (await client.request(`/api/office/inventory/parts/${part.id}/commercial`)).body;
  assert.equal(Number(commercial.prices.selling.current.amount), 24.5);
  assert.equal(commercial.purchaseCost.status, "unknown");
  await page.reload();
  await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber);
  await page.getByText(partNumber, { exact: true }).click();
  await page.locator(".inventory-commercial-price").filter({ hasText: "Selling price" }).getByText(/24\.50/).waitFor();
  await page.getByRole("button", { name: "Close part details", exact: true }).click();
  await page.getByRole("button", { name: "Storage locations", exact: true }).click();
  await page.getByRole("button", { name: /Add top.level/ }).click();
  await page.getByLabel("Code", { exact: true }).fill(`WH-${suffix}`);
  await page.getByLabel("Name", { exact: true }).fill(`Warehouse ${suffix}`);
  await page.locator(".inventory-location-detail .dropdown-select-trigger").first().click();
  await page.getByRole("option", { name: "Warehouse", exact: true }).click();
  const createResponse = page.waitForResponse(response => response.url().endsWith("/positions") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save position", exact: true }).click();
  const created = await createResponse;
  assert.equal(created.status(), 201, await created.text());
  await page.getByRole("button").filter({ hasText: `WH-${suffix}` }).first().waitFor();
  const locations = (await client.request(`/api/office/inventory/locations/${location.id}/positions`)).body.positions;
  assert.ok(locations.some(node => node.code === `WH-${suffix}` && node.kind === "warehouse"));
  let parent = locations.find(node => node.code === `WH-${suffix}`);
  for (const [kind, label] of [["aisle", "Aisle"], ["rack", "Rack"], ["shelf", "Shelf"], ["bin", "Bin"]]) {
    await page.locator(".inventory-location-tree button").filter({ hasText: parent.code }).last().click();
    await page.getByRole("button", { name: "Add child", exact: true }).click();
    await page.getByLabel("Code", { exact: true }).fill(`${kind.toUpperCase()}-${suffix}`);
    await page.getByLabel("Name", { exact: true }).fill(`${label} 01`);
    await page.locator(".inventory-location-detail .dropdown-select-trigger").first().click();
    await page.getByRole("option", { name: label, exact: true }).click();
    if (kind === "bin") {
      await page.getByLabel("Can store stock", { exact: true }).check();
      await page.locator(".inventory-location-detail .dropdown-select-trigger").last().click();
      await page.getByRole("option", { name: "Storage", exact: true }).click();
      await page.getByLabel("Pickable", { exact: true }).check();
    }
    const saving = page.waitForResponse(response => response.url().endsWith("/positions") && response.request().method() === "POST");
    await page.getByRole("button", { name: "Save position", exact: true }).click();
    const result = await saving;
    assert.equal(result.status(), 201, await result.text());
    const child = (await result.json()).position;
    assert.equal(child.parentId, parent.id);
    parent = child;
  }
  // Receive through the real command, then physically place through the browser.
  await client.request(`/api/office/inventory/parts/${part.id}/locations/${location.id}/stock-intake`, { method: "POST", expectedStatuses: [201], body: {
    quantity: 6, uomCode: "ea", trackingMode: "quantity", confirmation: "physically_present_at_location", idempotencyKey: `browser-intake-${suffix}`,
  } });
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber);
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await page.getByText(partNumber, { exact: true }).click();
  await page.locator(".inventory-detail-location-row > button").first().click();
  await page.locator(".part-position-move .dropdown-select-trigger").first().click();
  await page.getByRole("option", { name: /Receiving|SYS-RECEIVING/ }).click();
  await page.locator(".part-position-move .dropdown-select-trigger").last().click();
  await page.getByRole("option", { name: new RegExp(`${suffix}.*Bin 01`) }).last().click();
  await page.locator(".part-position-move").getByLabel("Quantity", { exact: true }).fill("4");
  const moving = page.waitForResponse(response => response.url().endsWith("/positions/moves") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Save placement", exact: true }).click();
  const moved = await moving;
  assert.equal(moved.status(), 200, await moved.text());
  const placement = (await client.request(`/api/office/inventory/parts/${part.id}/locations/${location.id}/positions`)).body;
  assert.equal(placement.positions.find(node => node.id === parent.id).quantity, 4);
  assert.equal(placement.positions.reduce((sum, node) => sum + node.quantity, 0), 6);
  await page.getByRole("button", { name: "Close part details", exact: true }).click();
  await page.getByRole("button", { name: "Storage locations", exact: true }).click();
  await page.locator(".inventory-location-tree button").filter({ hasText: parent.code }).last().click();
  const startingCount = page.waitForResponse(response => response.url().endsWith("/position-counts") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start count", exact: true }).click();
  const startedCount = await startingCount;
  assert.equal(startedCount.status(), 201, await startedCount.text());
  const observation = page.waitForResponse(response => /\/position-counts\/[^/]+\/lines\//.test(response.url()) && response.request().method() === "PUT");
  await page.getByLabel("Observed", { exact: true }).fill("3");
  await page.getByLabel("Observed", { exact: true }).press("Tab");
  const observed = await observation;
  assert.equal(observed.status(), 200, await observed.text());
  await page.getByLabel("Apply reason", { exact: true }).fill("Physical recount found three filters");
  const applyingCount = page.waitForResponse(response => /\/position-counts\/[^/]+\/apply$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply count", exact: true }).click();
  const appliedCount = await applyingCount;
  assert.equal(appliedCount.status(), 200, await appliedCount.text());
  assert.equal((await appliedCount.json()).count.status, "applied");
  const afterCount = (await client.request(`/api/office/inventory/parts/${part.id}/locations/${location.id}/positions`)).body;
  assert.equal(afterCount.positions.find(node => node.id === parent.id).quantity, 3);
  assert.equal(afterCount.positions.reduce((sum, node) => sum + node.quantity, 0), 5);
  // A move after observation must stop correction and offer a fresh count.
  await page.getByRole("button", { name: "Start a new count", exact: true }).click();
  await page.getByLabel("Observed", { exact: true }).fill("3");
  const recountObservation = page.waitForResponse(response => /\/position-counts\/[^/]+\/lines\//.test(response.url()) && response.request().method() === "PUT");
  await page.getByLabel("Observed", { exact: true }).press("Tab");
  assert.equal((await recountObservation).status(), 200);
  const beforeInterruption = (await client.request(`/api/office/inventory/parts/${part.id}/locations/${location.id}/positions`)).body;
  const receiving = beforeInterruption.positions.find(node => node.usage === "receiving");
  const countedBin = beforeInterruption.positions.find(node => node.id === parent.id);
  await client.request(`/api/office/inventory/parts/${part.id}/locations/${location.id}/positions/moves`, { method: "POST", body: {
    fromPositionId: receiving.id, toPositionId: parent.id, quantity: 1, expectedSourceVersion: receiving.version, expectedDestinationVersion: countedBin.version, reason: "Stock arrives while counting", idempotencyKey: `browser-count-race-${suffix}`,
  } });
  await page.getByLabel("Apply reason", { exact: true }).fill("Check movement conflict");
  const conflicted = page.waitForResponse(response => /\/position-counts\/[^/]+\/apply$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply count", exact: true }).click();
  assert.equal((await (await conflicted).json()).count.status, "needs_recount");
  const restarted = page.waitForResponse(response => response.url().endsWith("/position-counts") && response.request().method() === "POST");
  await page.getByRole("button", { name: "Start a new count", exact: true }).click();
  const freshCount = (await (await restarted).json()).count;
  assert.equal(freshCount.status, "open");
  assert.equal(freshCount.lines[0].expectedQuantity, 4);
  const freshObservation = page.waitForResponse(response => /\/position-counts\/[^/]+\/lines\//.test(response.url()) && response.request().method() === "PUT");
  await page.getByLabel("Observed", { exact: true }).fill("4");
  await page.getByLabel("Observed", { exact: true }).press("Tab");
  assert.equal((await freshObservation).status(), 200);
  await page.getByLabel("Apply reason", { exact: true }).fill("Recount confirms moved stock");
  const freshApply = page.waitForResponse(response => /\/position-counts\/[^/]+\/apply$/.test(response.url()) && response.request().method() === "POST");
  await page.getByRole("button", { name: "Apply count", exact: true }).click();
  assert.equal((await (await freshApply).json()).count.status, "applied");
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.screenshot({ path: `${output}/locations-${width}.png`, fullPage: true });
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), `No horizontal overflow at ${width}`);
  }
  // Exact units split across positions: source choice must limit the selectable serials.
  const serialPartNumber = `EXACT-${suffix}`;
  const serialPart = (await client.request("/api/office/inventory/parts", { method: "POST", expectedStatuses: [201], body: {
    locationId: location.id, partNumber: serialPartNumber, description: "Browser exact-unit filter", uomCode: "ea", trackingMode: "serialized",
  } })).body.part;
  await client.request(`/api/office/inventory/parts/${serialPart.id}/locations/${location.id}/units`, { method: "POST", expectedStatuses: [201], body: {
    quantity: 2, confirmation: "physically_present_at_location", conditionCode: "new", conditionEvidence: "Two unopened parts physically inspected", idempotencyKey: `browser-exact-${suffix}`,
  } });
  const exactPath = `/api/office/inventory/parts/${serialPart.id}/locations/${location.id}/positions`;
  const exactBefore = (await client.request(exactPath)).body;
  const [firstUnit, secondUnit] = exactBefore.units;
  await client.request(`${exactPath}/moves`, { method: "POST", body: {
    fromPositionId: firstUnit.positionId, toPositionId: parent.id, unitIds: [firstUnit.id], unitVersions: { [firstUnit.id]: firstUnit.custodyVersion }, reason: "Split serials across storage positions", idempotencyKey: `browser-split-${suffix}`,
  } });
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "Stock", exact: true }).click();
  await page.getByRole("textbox", { name: "Search inventory" }).fill(serialPartNumber);
  await page.getByRole("button", { name: "Refresh inventory", exact: true }).click();
  await page.getByText(serialPartNumber, { exact: true }).click();
  await page.locator(".inventory-detail-location-row > button").first().click();
  const mover = page.locator(".part-position-move");
  await mover.locator(".dropdown-select-trigger").first().click();
  await page.getByRole("option", { name: new RegExp(`${suffix}.*Bin 01`) }).last().click();
  await mover.getByLabel(firstUnit.serialNumber, { exact: true }).check();
  assert.equal(await mover.getByLabel(secondUnit.serialNumber, { exact: true }).count(), 0);
  await mover.locator(".dropdown-select-trigger").first().click();
  await page.getByRole("option", { name: /Receiving|SYS-RECEIVING/ }).click();
  assert.equal(await mover.getByLabel(firstUnit.serialNumber, { exact: true }).count(), 0);
  await mover.getByLabel(secondUnit.serialNumber, { exact: true }).check();
  await mover.locator(".dropdown-select-trigger").last().click();
  await page.getByRole("option", { name: new RegExp(`${suffix}.*Bin 01`) }).last().click();
  const exactMoving = page.waitForResponse(response => response.url().endsWith(`${serialPart.id}/locations/${location.id}/positions/moves`) && response.request().method() === "POST");
  await mover.getByRole("button", { name: "Save placement", exact: true }).click();
  const exactMoved = await exactMoving;
  assert.equal(exactMoved.status(), 200, await exactMoved.text());
  const exactAfter = (await client.request(exactPath)).body;
  assert.equal(exactAfter.units.filter(unit => unit.positionId === parent.id).length, 2);
  assert.equal(exactAfter.positions.reduce((sum, node) => sum + node.quantity, 0), 2);
  assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ result: "PASS", partNumber, locationId: location.id, checks: ["real authenticated API", "price edit and refresh persistence", "Unknown purchase cost", "nested warehouse/aisle/rack/shelf/bin creation", "receive and put away with quantity conservation", "observed count and authorized correction", "desktop/tablet/phone reflow", "serial source filtering and conserved exact-unit placement", "stale count blocks apply and restarts successfully"], errors }, null, 2));
  console.log("PASS basic inventory browser: prices, hierarchy, receiving, putaway, count correction and responsive reflow");
} catch (error) {
  if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/failure.txt`, await page.locator("body").innerText().catch(() => "Page unavailable")); }
  throw error;
} finally {
  await browser?.close();
  await client.dispose();
}
