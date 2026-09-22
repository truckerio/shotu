// Authenticated, local-only pricing proof. Fixtures remain in a disposable pricing database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdir, writeFile } from "node:fs/promises";
import { chromium } from "playwright";
import { RoleApiClient } from "./e2e/api-client.js";
const baseUrl = new URL(process.env.QA_INVENTORY_PRICING_URL || "http://localhost:4173");
const database = new URL(process.env.DATABASE_URL || "http://invalid");
assert.ok(["localhost", "127.0.0.1"].includes(baseUrl.hostname));
assert.ok(["localhost", "127.0.0.1"].includes(database.hostname) && /^\/inventory_pricing_/.test(database.pathname));
const output = process.env.QA_INVENTORY_PRICING_OUTPUT; assert.ok(output);
await mkdir(output, { recursive: true });
const client = await RoleApiClient.create({ role: "admin", baseUrl, timeoutMs: 20000 });
let browser, page;
try {
  await client.authenticate({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  const template = (await client.request("/api/office/template")).body;
  const location = template.locations[0].location;
  const suffix = randomUUID().slice(0, 8), partNumber = `PRICE-${suffix}`, profileName = `QA rates ${suffix}`;
  const part = (await client.request("/api/office/inventory/parts", { method: "POST", expectedStatuses: [201], body: { locationId: location.id, partNumber, description: "Pricing browser fixture", uomCode: "ea", trackingMode: "quantity" } })).body.part;
  browser = await chromium.launch();
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: { width: 1440, height: 1000 } });
  page = await context.newPage(); const errors = []; page.on("pageerror", e => errors.push(e.message));
  async function openPart() { await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`); await page.getByRole("textbox", { name: "Search inventory" }).fill(partNumber); await page.getByText(partNumber, { exact: true }).click(); await page.getByRole("heading", { name: "Prices", exact: true }).waitFor(); }
  const price = kind => page.locator(".inventory-commercial-price").filter({ has: page.getByText(kind === "selling" ? "Selling" : "Internal", { exact: true }) });
  let retryProved = false;
  async function savePrice(kind, amount, treatment, reason) {
    const editor = price(kind); await editor.getByRole("button", { name: `Change ${kind}`, exact: true }).click();
    await editor.getByLabel("Amount", { exact: true }).fill(amount); await editor.getByRole("button", { name: /Currency/ }).click(); await page.getByRole("option", { name: "USD", exact: true }).click();
    await editor.getByRole("button", { name: /Tax treatment$/ }).click();
    await page.getByRole("option", { name: ({ not_configured: "Not configured", exclusive: "Exclusive", inclusive: "Inclusive", zero_rated: "Zero-rated", exempt: "Exempt", out_of_scope: "Out of scope" })[treatment], exact: true }).click();
    if (["exclusive", "inclusive"].includes(treatment)) { await editor.getByRole("button", { name: /Tax profile$/ }).click(); await page.getByRole("option", { name: `${profileName} · QA jurisdiction`, exact: true }).click(); }
    await editor.getByLabel("Reason", { exact: true }).fill(reason);
    if (!retryProved) {
      let failedBody;
      const pattern = `**/prices/${kind}`;
      await page.route(pattern, async route => { failedBody = route.request().postDataJSON(); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Temporary test failure" }) }); }, { times: 1 });
      await editor.getByRole("button", { name: "Save price", exact: true }).click(); await editor.getByRole("alert").waitFor();
      assert.equal(await editor.getByLabel("Amount", { exact: true }).inputValue(), amount);
      const retryRequest = page.waitForRequest(r => r.url().endsWith(`/prices/${kind}`) && r.method() === "PUT");
      const retryResponse = page.waitForResponse(r => r.url().endsWith(`/prices/${kind}`) && r.request().method() === "PUT");
      await editor.getByRole("button", { name: "Save price", exact: true }).click();
      assert.deepEqual((await retryRequest).postDataJSON(), failedBody, "Unchanged retry preserves the command key and values");
      const retried = await retryResponse; assert.equal(retried.status(), 200, await retried.text());
      await editor.getByRole("button", { name: `Change ${kind}`, exact: true }).waitFor(); retryProved = true; return;
    }
    const pending = page.waitForResponse(r => r.url().endsWith(`/prices/${kind}`) && r.request().method() === "PUT");
    await editor.getByRole("button", { name: "Save price", exact: true }).click();
    const response = await pending; assert.equal(response.status(), 200, await response.text()); await editor.getByRole("button", { name: `Change ${kind}`, exact: true }).waitFor();
  }
  async function checkPrice(kind, expected, quantity = "1", discount = "0") {
    const editor = price(kind), section = editor.locator(".inventory-commercial-preview");
    if ((await section.getAttribute("open")) === null) await section.locator("summary").click();
    await section.getByLabel("Quantity", { exact: true }).fill(quantity); await section.getByLabel("Discount %", { exact: true }).fill(discount);
    const pending = page.waitForResponse(r => r.url().endsWith("/pricing-preview")); await section.getByRole("button", { name: "Check price", exact: true }).click();
    const response = await pending; assert.equal(response.status(), 200, await response.text()); const result = await response.json();
    for (const [key, value] of Object.entries(expected)) assert.equal(result[key], value, key);
    await section.locator(".inventory-commercial-preview-result").waitFor(); return result;
  }
  await openPart();
  const layout = [];
  for (const width of [1440, 768, 390, 320]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.locator(".secondary-detail-content").evaluate(element => { element.scrollTop = 0; });
    const geometry = await page.locator(".secondary-detail-content").evaluate(element => {
      const stock = element.querySelector(".inventory-detail-metrics").getBoundingClientRect();
      const prices = element.querySelector(".inventory-commercial-details").getBoundingClientRect();
      return { stockHeight: stock.height, pricesHeight: prices.height, overflow: element.scrollWidth - element.clientWidth };
    });
    await page.screenshot({ path: `${output}/overview-${width}.png`, animations: "disabled" });
    assert.ok(geometry.stockHeight < 100, `Stock summary remains compact at ${width}: ${geometry.stockHeight}px`);
    assert.ok(geometry.pricesHeight < 440, `Price summary remains compact at ${width}: ${geometry.pricesHeight}px`);
    assert.ok(geometry.overflow <= 1, `Drawer does not overflow at ${width}`);
    assert.equal(await page.getByText("No source-linked purchase history.", { exact: true }).count(), 0);
    await page.screenshot({ path: `${output}/overview-${width}.png`, animations: "disabled" });
    layout.push({ width, ...geometry });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await price("internal").getByRole("button", { name: "Change internal", exact: true }).click();
  await price("internal").getByLabel("Amount", { exact: true }).fill("81");
  await price("internal").getByRole("button", { name: /Currency/ }).click(); await page.getByRole("option", { name: "USD", exact: true }).click();
  await page.locator(".inventory-commercial-profiles > summary").click();
  await page.getByRole("button", { name: "Create tax profile", exact: true }).click();
  const form = page.locator(".inventory-commercial-profile-form");
  await form.getByLabel("Name", { exact: true }).first().fill(profileName); await form.getByRole("button", { name: /Currency/ }).click(); await page.getByRole("option", { name: "USD", exact: true }).click(); await form.getByLabel("Jurisdiction", { exact: true }).fill("QA jurisdiction");
  await form.getByLabel("Name", { exact: true }).nth(1).fill("QA tax"); await form.getByLabel("Rate %", { exact: true }).fill("8"); await form.getByLabel("Reason", { exact: true }).fill("Explicit test profile, not a statutory default");
  const creating = page.waitForResponse(r => r.url().endsWith("/tax-profiles") && r.request().method() === "POST");
  await form.getByRole("button", { name: "Create profile", exact: true }).click(); const created = await creating; assert.equal(created.status(), 201, await created.text()); const profile = (await created.json()).profile;
  await page.getByText(profileName, { exact: true }).waitFor();
  assert.equal(await price("internal").getByLabel("Amount", { exact: true }).inputValue(), "81", "Creating a profile preserves the price draft");
  await price("internal").getByRole("button", { name: "Cancel", exact: true }).click();
  await savePrice("selling", "100", "exclusive", "External sale price");
  await checkPrice("selling", { net: "100.00", tax: "8.00", total: "108.00" });
  await savePrice("internal", "80", "out_of_scope", "Internal fleet charge"); await checkPrice("internal", { net: "80.00", tax: "0.00", total: "80.00" });
  await openPart(); await checkPrice("selling", { total: "108.00" });
  await savePrice("selling", "108", "inclusive", "Tax included price"); await checkPrice("selling", { net: "100.00", tax: "8.00", total: "108.00" });
  await checkPrice("selling", { net: "180.00", tax: "14.40", total: "194.40" }, "2", "10");
  // Version changes must leave the saved price's original tax snapshot intact.
  await page.locator(".inventory-commercial-profiles > summary").click();
  const profileRow = page.locator(".inventory-commercial-profiles li").filter({ hasText: profileName });
  await profileRow.getByRole("button", { name: "Revise", exact: true }).click();
  await form.getByLabel("Rate %", { exact: true }).fill("9");
  await form.getByLabel("Reason", { exact: true }).fill("Future profile revision");
  const revising = page.waitForResponse(r => r.url().endsWith(`/tax-profiles/${profile.id}`) && r.request().method() === "PUT");
  await form.getByRole("button", { name: "Save new version", exact: true }).click();
  const revised = await revising; assert.equal(revised.status(), 200, await revised.text());

  await openPart(); await checkPrice("selling", { net: "100.00", tax: "8.00", total: "108.00" });
  for (const width of [1440, 768, 390]) { await page.setViewportSize({ width, height: 1000 }); await price("selling").scrollIntoViewIfNeeded(); await page.screenshot({ path: `${output}/pricing-${width}.png`, animations: "disabled" }); assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `Overflow at ${width}`); }
  await page.setViewportSize({ width: 1440, height: 1000 });
  await savePrice("internal", "10", "not_configured", "Tax not yet classified"); await checkPrice("internal", { net: null, tax: null, total: null });
  await savePrice("internal", "0", "zero_rated", "Explicit zero price and zero rated treatment"); await checkPrice("internal", { net: "0.00", tax: "0.00", total: "0.00" });
  await page.locator(".inventory-commercial-profiles > summary").click();
  let archiveBody;
  await page.route(`**/tax-profiles/${profile.id}/archive`, async route => {
    archiveBody = route.request().postDataJSON(); const committed = await route.fetch();
    assert.equal(committed.status(), 200); await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Response lost after archive committed" }) });
  }, { times: 1 });
  await profileRow.getByRole("button", { name: "Archive", exact: true }).click();
  await page.getByLabel("Archive reason", { exact: true }).fill("Retire QA tax profile");
  await page.getByRole("button", { name: "Archive tax profile", exact: true }).click();
  await page.locator(".inventory-commercial-profiles").getByRole("alert").waitFor();
  const archiveRetryRequest = page.waitForRequest(r => r.url().endsWith(`/tax-profiles/${profile.id}/archive`));
  const archiveRetryResponse = page.waitForResponse(r => r.url().endsWith(`/tax-profiles/${profile.id}/archive`));
  await page.getByRole("button", { name: "Archive tax profile", exact: true }).click();
  assert.deepEqual((await archiveRetryRequest).postDataJSON(), archiveBody, "Uncertain archive retry must preserve command identity");
  const archivedResponse = await archiveRetryResponse; assert.equal(archivedResponse.status(), 200);
  const archived = await archivedResponse.json(); assert.equal(archived.replayed, true); assert.equal(archived.profile.currentVersion, 3);
  await checkPrice("selling", { net: "100.00", tax: "8.00", total: "108.00" });
  const commercial = (await client.request(`/api/office/inventory/parts/${part.id}/commercial`)).body;
  assert.equal(commercial.purchaseCost.status, "unknown"); assert.ok(commercial.prices.selling.history.length >= 2); assert.deepEqual(errors, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ result: "PASS", partNumber, layout, checks: ["real authenticated profile creation", "internal and selling edit/save/reload", "failed save preserves draft and retry key", "exclusive and inclusive tax", "quantity and discount", "profile revision preserves historical tax", "new profile preserves in-progress price draft", "unknown vs explicit zero", "committed archive with lost response retries once and preserves history", "1440/768/390/320 compact overview and responsive layouts"], errors }, null, 2));
  console.log("PASS inventory pricing browser workflows");
} catch (error) { if (page) { await page.screenshot({ path: `${output}/failure.png`, fullPage: true }).catch(() => {}); await writeFile(`${output}/failure.txt`, await page.locator("body").innerText().catch(() => "Unavailable")); } throw error; }
finally { await browser?.close(); await client.dispose(); }
