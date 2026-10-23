import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const target = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(target.pathname)) throw new Error("Browser rehearsal requires runner's disposable local database.");
const port = Number(process.env.QA_MAINTENANCE_PORT || 4199);
const baseUrl = `http://localhost:${port}`;
process.env.PORT = String(port);
process.env.BETTER_AUTH_URL = baseUrl;
process.env.AUTH_TRUSTED_ORIGINS = baseUrl;
process.env.NODE_ENV = "development";
process.env.SAMSARA_SYNC_ON_STARTUP = "false";
const storage = await mkdtemp(join(tmpdir(), "inspection-maintenance-browser-"));
process.env.WORKORDER_STORAGE_DIR = storage;
const { getPool, closePool } = await import("../../src/server/db/pool.js");
const { seedMaintenanceFixture } = await import("./inspection-maintenance-fixture.js");
const { recordProviderAssetMileage } = await import("../../src/server/db/repositories/asset-mileage.repo.js");
const { auth } = await import("../../src/server/auth/auth.js");
const fixture = await seedMaintenanceFixture(getPool());
const password = `Maintenance-${randomUUID()}!`;
const accounts = [];
for (const [role, profileId] of [["mechanic", fixture.mechanicId], ["office", fixture.officeId]]) {
  const username = `maint${role}${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const email = `${username}@example.test`;
  const result = await auth.api.signUpEmail({ body: { name: `Maintenance ${role}`, email, username, displayUsername: username, password } });
  await getPool().query("update user_profiles set auth_user_id=$2,contact_email=$3 where id=$1", [profileId, result.user.id, email]);
  accounts.push({ role, username });
}

const server = spawn(process.execPath, ["server.js"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk.toString(); });
server.stderr.on("data", chunk => { serverLog += chunk.toString(); });
let browser;
async function ready() {
  for (let attempt = 0; attempt < 80; attempt++) {
    if (server.exitCode != null) throw new Error(`Disposable app server exited: ${serverLog.slice(-2000)}`);
    try { const response = await fetch(`${baseUrl}/health/live`); if (response.ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable app server did not start: ${serverLog.slice(-2000)}`);
}
async function signedIn(account, viewport) {
  const context = await browser.newContext({ viewport });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByLabel("Username or email", { exact: true }).fill(account.username);
  await page.locator("#login-password").fill(password);
  const signInResponse = page.waitForResponse(response => new URL(response.url()).pathname === "/api/auth/sign-in/username");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await signInResponse).status(), 200);
  await page.locator("#login-password").waitFor({ state: "hidden" });
  await page.goto(`${baseUrl}/?from=inspection&inspection=${fixture.activeInspectionId}&anchor=summary`);
  await page.getByRole("region", { name: "Maintenance to review", exact: true }).waitFor();
  return { context, page };
}
async function assertNoOverflow(page) {
  const widths = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  assert.ok(widths.page <= widths.viewport + 1, `Horizontal overflow ${JSON.stringify(widths)}`);
}

try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const mechanic = await signedIn(accounts[0], { width: 1440, height: 1000 });
  const panel = mechanic.page.getByRole("region", { name: "Maintenance to review", exact: true });
  await panel.getByText("Small air leak at fitting.", { exact: true }).waitFor();
  await panel.getByText("Due soon — consider this visit", { exact: true }).waitFor();
  await mechanic.page.getByLabel("Odometer miles", { exact: true }).fill("9800");
  await mechanic.page.getByText("Previous report reviewed", { exact: true }).click();
  await mechanic.page.getByRole("button", { name: "Start inspection", exact: true }).click();
  await panel.getByText("Due for review", { exact: true }).waitFor();
  // A checklist autosave must not tear down maintenance content or drafts.
  await panel.getByRole("button", { name: "Record dashboard mileage", exact: true }).click();
  await panel.getByLabel("Dashboard miles", { exact: true }).fill("9835");
  await panel.getByRole("textbox", { name: /^Reason for reading\/correction/ }).fill("Keep this unsaved dashboard draft");
  await mechanic.page.evaluate(() => {
    window.maintenanceLoadingFlashes = 0;
    window.maintenanceObserver = new MutationObserver(records => {
      for (const record of records) for (const node of record.addedNodes) {
        if (node.textContent?.includes("Checking previous issues and upcoming maintenance…")) window.maintenanceLoadingFlashes += 1;
      }
    });
    window.maintenanceObserver.observe(document.querySelector(".inspection-maintenance"), { childList: true, subtree: true });
  });
  const passSaved = mechanic.page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/responses") && response.request().method() === "PATCH");
  const remindersRefreshed = mechanic.page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/maintenance"));
  await mechanic.page.getByLabel("Pass", { exact: true }).check();
  assert.equal((await passSaved).status(), 200);
  assert.equal((await remindersRefreshed).status(), 200);
  await mechanic.page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  assert.equal(await mechanic.page.evaluate(() => window.maintenanceLoadingFlashes), 0, "Checklist autosave flashed maintenance loading state");
  assert.equal(await panel.getByLabel("Dashboard miles", { exact: true }).inputValue(), "9835");
  assert.equal(await panel.getByRole("textbox", { name: /^Reason for reading\/correction/ }).inputValue(), "Keep this unsaved dashboard draft");
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await mechanic.page.evaluate(() => window.maintenanceObserver.disconnect());
  // Hold a real mileage request while checklist autosave refreshes reminders.
  // Same-record refresh must preserve busy/form state and ignore stale loads.
  let releaseOldRefresh;
  let refreshHeld;
  let firstRefresh = true;
  const refreshGate = new Promise(resolve => { releaseOldRefresh = resolve; });
  const refreshStarted = new Promise(resolve => { refreshHeld = resolve; });
  const maintenanceUrl = `${baseUrl}/api/inspections/${fixture.activeInspectionId}/maintenance`;
  await mechanic.page.route(maintenanceUrl, async route => {
    if (!firstRefresh) return route.continue();
    firstRefresh = false; refreshHeld(); await refreshGate;
    await route.fulfill({ status: 503, contentType: "application/json", body: JSON.stringify({ error: "Stale refresh failure" }) });
  });
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await refreshStarted;
  let releaseReading;
  let readingHeld;
  const held = new Promise(resolve => { readingHeld = resolve; });
  const release = new Promise(resolve => { releaseReading = resolve; });
  const mileageUrl = `${baseUrl}/api/inspections/${fixture.activeInspectionId}/mileage`;
  await mechanic.page.route(mileageUrl, async route => { readingHeld(); await release; await route.continue(); });
  await panel.getByRole("button", { name: "Record dashboard mileage", exact: true }).click();
  await panel.getByLabel("Dashboard miles", { exact: true }).fill("9840");
  await new Promise(resolve => setTimeout(resolve, 1100));
  const heldObservation = new Date();
  const heldLocal = new Date(heldObservation.getTime() - heldObservation.getTimezoneOffset() * 60000).toISOString().slice(0, 19);
  await panel.getByLabel("When observed", { exact: true }).fill(heldLocal);
  await panel.getByRole("textbox", { name: /^Reason for reading\/correction/ }).fill("Dashboard verified before scope change");
  await panel.getByRole("button", { name: "Save mileage", exact: true }).click();
  await held;
  assert.equal(await panel.getByRole("button", { name: "Refresh", exact: true }).isDisabled(), true);
  await mechanic.page.getByLabel("Issue", { exact: true }).check();
  await mechanic.page.locator('button[aria-label="Air leak severity"]').click();
  await mechanic.page.getByRole("option", { name: "Attention", exact: true }).click();
  await mechanic.page.getByRole("textbox", { name: "What is wrong", exact: true }).fill("Second fitting needs follow-up inspection");
  await mechanic.page.locator('button[aria-label="Air leak disposition"]').click();
  const checklistSaved = mechanic.page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/responses") && response.request().method() === "PATCH");
  await mechanic.page.getByRole("option", { name: "Office follow-up required", exact: true }).click();
  assert.equal((await checklistSaved).status(), 200);
  assert.equal(await panel.getByRole("button", { name: "Refresh", exact: true }).isDisabled(), true);
  assert.equal(await panel.getByLabel("Dashboard miles", { exact: true }).inputValue(), "9840");
  const heldResponse = mechanic.page.waitForResponse(response => response.url() === mileageUrl && response.request().method() === "POST");
  const oldRefreshResponse = mechanic.page.waitForResponse(response => response.url() === maintenanceUrl && response.status() === 503);
  releaseOldRefresh();
  await oldRefreshResponse;
  releaseReading();
  assert.equal((await heldResponse).status(), 200);
  await panel.getByLabel("Dashboard miles", { exact: true }).waitFor({ state: "hidden" });
  await mechanic.page.unroute(mileageUrl);
  await mechanic.page.unroute(maintenanceUrl);
  await panel.getByRole("button", { name: "Record dashboard mileage", exact: true }).click();
  assert.equal(await panel.getByRole("textbox", { name: /^Reason for reading\/correction/ }).inputValue(), "");
  assert.equal(await panel.getByText("Stale refresh failure", { exact: true }).count(), 0);
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText("160 mi remaining", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Record dashboard mileage", exact: true }).click();
  await panel.getByLabel("Dashboard miles", { exact: true }).fill("9850");
  await new Promise(resolve => setTimeout(resolve, 1100));
  const observedAt = new Date().toISOString();
  const localDate = new Date(new Date(observedAt).getTime() - new Date(observedAt).getTimezoneOffset() * 60_000).toISOString().slice(0, 19);
  await panel.getByLabel("When observed", { exact: true }).fill(localDate);
  await panel.getByRole("textbox", { name: /^Reason for reading\/correction/ }).fill("Dashboard verified during shop visit");
  await panel.getByRole("button", { name: "Save mileage", exact: true }).click();
  await panel.getByText("150 mi remaining", { exact: true }).waitFor();
  await assertNoOverflow(mechanic.page);
  const activity = await mechanic.page.request.get(`${baseUrl}/api/activity`);
  assert.equal(activity.status(), 200);
  assert.match(JSON.stringify(await activity.json()), /Dashboard verified during shop visit/);
  const denied = await mechanic.page.request.post(`${baseUrl}/api/inspections/${fixture.sourceInspection.id}/follow-ups/${fixture.sourceFindingId}/actions/verify`, { data: { expectedVersion: 1, idempotencyKey: `denied-${randomUUID()}`, reason: "Attempt outside mechanic authority" } });
  assert.equal(denied.status(), 403);

  await recordProviderAssetMileage({ companyId: fixture.companyId, assetId: fixture.assetId, miles: 9870, observedAt: new Date().toISOString(), source: "samsara_obd" });
  await panel.getByRole("button", { name: "Refresh", exact: true }).click();
  await panel.getByText("Reading conflict — verify mileage", { exact: true }).waitFor();
  await panel.getByRole("button", { name: "Use reviewed Samsara mileage", exact: true }).click();
  await panel.getByText("130 mi remaining", { exact: true }).waitFor();
  await mechanic.page.reload();
  await panel.getByText("130 mi remaining", { exact: true }).waitFor();
  await mechanic.page.setViewportSize({ width: 390, height: 844 });
  await assertNoOverflow(mechanic.page);
  await mechanic.page.screenshot({ path: join(storage, "mechanic-phone.png"), fullPage: true });

  assert.equal(await mechanic.page.getByRole("textbox", { name: "What is wrong", exact: true }).inputValue(), "Second fitting needs follow-up inspection");
  await mechanic.page.locator('button[aria-label="Air leak disposition"]').click();
  await mechanic.page.getByRole("option", { name: "Defer issue", exact: true }).click();
  await mechanic.page.getByLabel("Why can this wait?", { exact: true }).fill("Reassess at next scheduled service");
  await mechanic.page.locator('button[aria-label="Mileage trigger"]').click();
  await mechanic.page.getByRole("option", { name: "After additional miles", exact: true }).click();
  await mechanic.page.getByLabel("Confirmed starting miles", { exact: true }).fill("9870");
  await mechanic.page.getByLabel("Additional miles", { exact: true }).fill("2130");
  await mechanic.page.getByRole("button", { name: /^Open calendar for Review by date/ }).click();
  await mechanic.page.keyboard.press("Escape");
  await mechanic.page.getByRole("button", { name: "Complete inspection", exact: true }).waitFor();
  await mechanic.page.waitForFunction(() => { const button = [...document.querySelectorAll("button")].find(item => item.textContent.trim() === "Complete inspection"); return button && !button.disabled; });
  await mechanic.page.getByRole("button", { name: "Complete inspection", exact: true }).click();
  await mechanic.page.getByRole("button", { name: "Complete inspection", exact: true }).waitFor({ state: "hidden" });
  await panel.getByText("Due for review", { exact: true }).waitFor();
  await mechanic.page.reload();
  await panel.getByText("Second fitting needs follow-up inspection", { exact: true }).waitFor();

  const office = await signedIn(accounts[1], { width: 1440, height: 1000 });
  const officePanel = office.page.getByRole("region", { name: "Maintenance to review", exact: true });
  await officePanel.locator(".maintenance-item").filter({ hasText: "Small air leak at fitting." }).getByRole("button", { name: "Plan repair", exact: true }).click();
  await officePanel.locator(".maintenance-item").filter({ hasText: "Small air leak at fitting." }).getByRole("button", { name: "Plan repair", exact: true }).click();
  await officePanel.getByText("Repair planned", { exact: true }).waitFor();
  await office.page.reload();
  await officePanel.getByText("Repair planned", { exact: true }).waitFor();
  const hidden = await office.page.request.get(`${baseUrl}/api/inspections/${randomUUID()}/maintenance`);
  assert.equal(hidden.status(), 404);
  await office.page.setViewportSize({ width: 768, height: 1024 });
  await assertNoOverflow(office.page);
  await office.page.screenshot({ path: join(storage, "office-tablet.png"), fullPage: true });
  console.log(JSON.stringify({ result: "PASS", workflow: "authenticated mechanic/Office through real app routes and disposable PostgreSQL", checks: ["carryover before start", "early margin", "actual visit due", "manual audit", "checklist saves preserve maintenance drafts and busy state without loading flashes", "stale refresh failures ignored", "provider conflict and explicit reconciliation", "refresh persistence", "defer form additional miles and shared calendar", "completion preserves next-visit due", "repair planned", "mechanic write rejection", "guessed inspection rejection", "1440/768/390 no overflow"], artifacts: storage }));
} catch (error) {
  console.error(error);
  if (browser) { for (const context of browser.contexts()) { for (const page of context.pages()) { try { console.error(await page.locator(".inspection-detail-primary").ariaSnapshot({ timeout: 2000 })); await page.screenshot({ path: join(storage, `failure-${context === browser.contexts()[0] ? "mechanic" : "office"}.png`), fullPage: true }); } catch {} } } }
  console.error(`Failure artifacts: ${storage}`);
  console.error(serverLog.slice(-2000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise(resolve => { if (server.exitCode != null) resolve(); else { server.once("exit", resolve); setTimeout(resolve, 3000); } });
  if (server.exitCode == null) server.kill("SIGKILL");
  await closePool();
}
