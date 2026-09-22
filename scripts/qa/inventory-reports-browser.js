import assert from "node:assert/strict";
import { chromium } from "playwright";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 768, height: 1024 }, { width: 390, height: 844 }];
const LOCAL_HOSTS = new Set(["localhost", "127.0.0.1", "::1"]);
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required.`); return value; };

function settings() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_REPORTS_BASE_URL || "http://localhost:4173");
  if (safety.production || !LOCAL_HOSTS.has(baseUrl.hostname)) throw new Error("Inventory Reports QA only runs against localhost.");
  return { baseUrl, password: required("QA_ACCOUNT_PASSWORD"), namespace: required("QA_ACCOUNT_NAMESPACE") };
}

async function assertKeyboardReachability(page) {
  const refresh = page.getByRole("button", { name: "Refresh", exact: true });
  await refresh.focus();
  assert.equal(await refresh.evaluate((element) => document.activeElement === element), true, "Refresh must be reachable by keyboard");
  await page.keyboard.press("Tab");
  assert.match(await page.evaluate(() => document.activeElement?.textContent || document.activeElement?.getAttribute("aria-label") || ""), /Export|Location/, "Reports toolbar must retain a tab stop after Refresh");
  const reconciliation = page.getByText("Reconciliation", { exact: true });
  await reconciliation.focus();
  await page.keyboard.press("Enter");
}

async function runViewport(browser, storageState, settings, viewport) {
  const context = await browser.newContext({ storageState, viewport, acceptDownloads: true });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const reportResponse = page.waitForResponse((response) => response.url().includes("/api/office/inventory/reports?") && response.request().method() === "GET");
    await page.goto(new URL("/?view=inventory&adminView=inventory&inventorySection=reports", settings.baseUrl).href, { waitUntil: "domcontentloaded" });
    assert.equal((await reportResponse).status(), 200, "Inventory reports API must succeed");
    await page.getByRole("button", { name: "Refresh", exact: true }).waitFor();
    await page.getByRole("heading", { name: "Stock and usage", exact: true }).waitFor();
    const exportButton = page.getByRole("button", { name: "Export report", exact: true });
    assert.equal(await exportButton.isEnabled(), true, "Export must be enabled after a successful report load");
    const download = page.waitForEvent("download");
    await exportButton.click();
    const file = await download;
    assert.match(file.suggestedFilename(), /^inventory-report-page-\d+\.csv$/);
    await assertKeyboardReachability(page);
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Reports overflow at ${viewport.width}px`);
    await page.route("**/api/office/inventory/reports?*", async (route) => route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Report test outage" }) }));
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").filter({ hasText: "Report test outage" }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Error state overflow at ${viewport.width}px`);
    assert.deepEqual(errors, [], `Page errors at ${viewport.width}px`);
    return { viewport: `${viewport.width}x${viewport.height}`, exportChecked: true };
  } finally {
    await context.close();
  }
}

async function main() {
  const config = settings();
  let browser, office, failure, cleanupError;
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(config.namespace).find((entry) => entry.role === "office");
    office = await RoleApiClient.create({ role: "office", baseUrl: config.baseUrl, timeoutMs: 20000 });
    await office.authenticate({ ...account, password: config.password });
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
    const storageState = await office.storageState();
    const results = [];
    for (const viewport of VIEWPORTS) results.push(await runViewport(browser, storageState, config, viewport));
    console.log(JSON.stringify({ passed: true, reports: results }));
  } catch (error) {
    failure = error;
  } finally {
    try { await browser?.close(); } catch (error) { cleanupError ||= error; }
    try { await office?.dispose(); } catch (error) { cleanupError ||= error; }
    try { await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${config.namespace}`], environment: process.env }); } catch (error) { cleanupError ||= error; }
  }
  if (failure || cleanupError) throw new AggregateError([failure, cleanupError].filter(Boolean), failure?.message || "Inventory Reports QA cleanup failed");
}

main().catch((error) => { console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD])); process.exitCode = 1; });
