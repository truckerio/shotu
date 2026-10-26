// Authenticated role queue regression against the runner's disposable local PostgreSQL database.
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

const database = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(database.hostname)
  || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(database.pathname)) {
  throw new Error("Role filter browser test requires the runner's disposable loopback database.");
}

const port = Number(process.env.QA_ROLE_FILTER_PORT || 4197);
const baseUrl = `http://localhost:${port}`;
Object.assign(process.env, {
  PORT: String(port), BETTER_AUTH_URL: baseUrl, AUTH_TRUSTED_ORIGINS: baseUrl,
  NODE_ENV: "development", SAMSARA_SYNC_ON_STARTUP: "false",
});
const artifacts = await mkdtemp(join(tmpdir(), "workorder-role-filters-"));
process.env.WORKORDER_STORAGE_DIR = artifacts;
const { getPool, closePool } = await import("../../src/server/db/pool.js");
const { seedMaintenanceFixture } = await import("./inspection-maintenance-fixture.js");
const { auth } = await import("../../src/server/auth/auth.js");
const pool = getPool();
const fixture = await seedMaintenanceFixture(pool);
const secondMechanicId = randomUUID();
const surveillanceId = randomUUID();
await pool.query("update user_company_memberships set company_id=$2,role='admin' where user_id=$1", [fixture.otherOfficeId, fixture.companyId]);
await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [fixture.otherOfficeId, fixture.locationId, fixture.companyId]);
await pool.query("insert into user_profiles(id,display_name) values($1,'Role Filter Maya'),($2,'Role Filter Surveillance')", [secondMechanicId, surveillanceId]);
await pool.query("insert into user_company_memberships(user_id,company_id,role) values($1,$3,'mechanic'),($2,$3,'surveillance')", [secondMechanicId, surveillanceId, fixture.companyId]);
await pool.query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$3,$4),($2,$3,$4)", [secondMechanicId, surveillanceId, fixture.locationId, fixture.companyId]);

const password = `RoleFilter-${randomUUID()}!`;
const accounts = [];
for (const [role, profileId] of [["admin", fixture.otherOfficeId], ["office", fixture.officeId], ["mechanic", fixture.mechanicId], ["surveillance", surveillanceId]]) {
  const username = `rolefilter${role}${randomUUID().replaceAll("-", "").slice(0, 8)}`;
  const email = `${username}@example.test`;
  const result = await auth.api.signUpEmail({ body: { name: `Role Filter ${role}`, email, username, displayUsername: username, password } });
  await pool.query("update user_profiles set auth_user_id=$2,contact_email=$3 where id=$1", [profileId, result.user.id, email]);
  accounts.push({ role, username });
}

const workorders = [
  { id: randomUUID(), serial: "WO-ROLE-MECHANIC-ONE", mechanicId: fixture.mechanicId, unit: "ROLE-ONE" },
  { id: randomUUID(), serial: "WO-ROLE-MECHANIC-TWO", mechanicId: secondMechanicId, unit: "ROLE-TWO" },
];
for (const order of workorders) {
  const assetId = randomUUID();
  await pool.query("insert into assets(id,company_id,location_id,provider,unit_type,unit_no,name) values($1,$2,$3,'manual','Truck',$4,$4)", [assetId, fixture.companyId, fixture.locationId, order.unit]);
  await pool.query("insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,status,concern) values($1,$2,$3,$4,$5,$6,'accepted','Role filter fixture')", [order.id, fixture.companyId, order.serial, assetId, fixture.locationId, fixture.officeId]);
  await pool.query("insert into workorder_mechanic_assignments(workorder_id,mechanic_user_id,assignment_role,assigned_by_user_id) values($1,$2,'primary',$3)", [order.id, order.mechanicId, fixture.officeId]);
}

const server = spawn(process.execPath, ["server.js"], { env: process.env, stdio: ["ignore", "pipe", "pipe"] });
let serverLog = "";
server.stdout.on("data", chunk => { serverLog += chunk.toString(); });
server.stderr.on("data", chunk => { serverLog += chunk.toString(); });
let browser;

async function ready() {
  for (let attempt = 0; attempt < 100; attempt++) {
    if (server.exitCode != null) throw new Error(`Disposable server exited: ${serverLog.slice(-2000)}`);
    try { if ((await fetch(`${baseUrl}/health/live`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable server not ready: ${serverLog.slice(-2000)}`);
}

async function signIn(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 }, deviceScaleFactor: 1 });
  const page = await context.newPage();
  page.setDefaultTimeout(12000);
  await page.goto(baseUrl);
  await page.getByLabel("Username or email", { exact: true }).fill(account.username);
  await page.locator("#login-password").fill(password);
  const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/auth/sign-in/username");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await response).status(), 200, `${account.role} sign-in`);
  await page.locator("#login-password").waitFor({ state: "hidden" });
  await page.goto(`${baseUrl}/?${account.role === "admin" ? "adminView=operations" : ""}`);
  await page.locator("main").waitFor({ state: "visible" });
  return { context, page };
}

async function chooseDropdown(page, dropdown, option) {
  await dropdown.click();
  const choices = page.getByRole("option");
  const labels = await choices.allTextContents();
  assert.ok(labels.some(label => label.trim().startsWith(option)), `Missing ${option} in ${JSON.stringify(labels)}`);
  await choices.filter({ hasText: option }).first().click();
  await dropdown.waitFor({ state: "visible" });
  assert.ok((await dropdown.innerText()).trim().startsWith(option), `Queue selection did not update to ${option}`);
  await page.keyboard.press("Escape");
  await page.locator(".dropdown-select-popover").waitFor({ state: "detached" });
}

async function assertNoOverflow(page, label) {
  await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
  const width = await page.evaluate(() => ({ viewport: document.documentElement.clientWidth, page: document.documentElement.scrollWidth }));
  if (width.page > width.viewport + 1) console.error(JSON.stringify({ label, overflowing: await page.evaluate(() => [...document.querySelectorAll("body *")].map(element => ({ tag: element.tagName, className: element.className?.baseVal ?? element.className, role: element.getAttribute("role"), right: element.getBoundingClientRect().right, position: getComputedStyle(element).position })).filter(element => element.right > document.documentElement.clientWidth + 1).slice(-20)) }));
  assert.ok(width.page <= width.viewport + 1, `${label} horizontal overflow: ${JSON.stringify(width)}`);
}

const errors = [];
const roleOptions = {
  admin: ["All", "Active"],
  office: ["Needs action", "All"],
  mechanic: ["My work", "Available"],
  surveillance: ["Needs Odoo", "Active"],
};
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  for (const account of accounts) {
    const { context, page } = await signIn(account);
    try {
      const desktop = page.locator(account.role === "admin" ? ".role-desktop-filters" : ".workorder-queue-filter").first();
      await desktop.waitFor({ state: "visible" });
      const queue = desktop.locator('button.dropdown-select-trigger[aria-label="Queue"]');
      await queue.waitFor({ state: "visible", timeout: 3000 });
      await queue.click();
      const options = await page.getByRole("option").allTextContents();
      for (const expected of roleOptions[account.role]) {
        assert.ok(options.some(option => option.trim().startsWith(expected) && /\(\d+\)/.test(option)), `${account.role} Queue option ${expected} with count missing: ${JSON.stringify(options)}`);
      }
      await page.keyboard.press("Escape");
      await chooseDropdown(page, queue, account.role === "admin" ? "Active" : account.role === "office" ? "All" : account.role === "mechanic" ? "Available" : "Active");
      if (account.role === "admin") {
        await page.getByRole("button", { name: "Lifecycle / attention filters and sort", exact: true }).click();
        const dialog = page.getByRole("dialog", { name: "Lifecycle / attention", exact: true });
        await dialog.waitFor({ state: "visible" });
        await dialog.getByRole("button", { name: "Done", exact: true }).click();
      }
      if (account.role === "office") {
        assert.equal(await page.getByRole("complementary", { name: "Mechanic workload", exact: true }).count(), 0, "Office must use the Mechanics column filter without a duplicate sidebar");
        const controls = await page.locator(".office-filter-row.role-desktop-filters").evaluate(toolbar => [
          toolbar.querySelector('.office-queue-field button'),
          toolbar.querySelector('.mechanic-search'),
          toolbar.querySelector('button[aria-label="Lifecycle filter"]'),
        ].map(control => {
          const rect = control.getBoundingClientRect();
          return { top: rect.top, height: rect.height };
        }));
        assert.ok(controls.every(control => Math.abs(control.top - controls[0].top) <= 2), `Office Queue, Search and Stage must align in one desktop row: ${JSON.stringify(controls)}`);
        assert.ok(controls.every(control => Math.abs(control.height - controls[0].height) <= 2), "Office toolbar controls must have matching heights");
        const fullWidth = await page.locator(".office-layout").evaluate(layout => {
          const shell = layout.querySelector(".office-table-shell").getBoundingClientRect();
          const box = layout.getBoundingClientRect();
          return Math.abs(shell.left - box.left) <= 2 && Math.abs(shell.right - box.right) <= 2;
        });
        assert.ok(fullWidth, "Office workorder table must fill the space formerly occupied by the mechanic selector");
        await page.setViewportSize({ width: 1800, height: 900 });
        const wideLayout = await page.locator(".office-layout").evaluate(layout => ({
          columns: getComputedStyle(layout).gridTemplateColumns.split(" ").length,
          tableWidth: layout.querySelector(".office-table-shell").getBoundingClientRect().width,
          width: layout.getBoundingClientRect().width,
        }));
        assert.equal(wideLayout.columns, 1, "Wide Office layouts must not restore the removed mechanic sidebar column");
        assert.ok(Math.abs(wideLayout.tableWidth - wideLayout.width) <= 2);
        await page.setViewportSize({ width: 1440, height: 900 });
        const rows = page.locator(".office-table-shell .mechanic-work-row");
        await rows.filter({ hasText: workorders[0].serial }).waitFor();
        await rows.filter({ hasText: workorders[1].serial }).waitFor();
        const filterButton = page.getByRole("button", { name: "Mechanics filters and sort", exact: true });
        await filterButton.waitFor({ state: "visible" });
        assert.notEqual(await filterButton.getAttribute("aria-hidden"), "true", "Interactive Mechanics filter must be exposed to accessibility tree");
        await filterButton.click();
        const mechanic = page.locator('button.dropdown-select-trigger[aria-label="Mechanic filter"]');
        await mechanic.waitFor({ state: "visible" });
        await chooseDropdown(page, mechanic, "Maintenance mechanic");
        await rows.filter({ hasText: workorders[0].serial }).waitFor();
        assert.equal(await rows.filter({ hasText: workorders[1].serial }).count(), 0, "Mechanic filter must narrow visible rows");
        if (!await mechanic.isVisible()) await filterButton.click();
        await chooseDropdown(page, mechanic, "All mechanics");
        await rows.filter({ hasText: workorders[1].serial }).waitFor();
        const done = page.getByRole("button", { name: "Done", exact: true });
        if (await done.isVisible()) await done.click();
      }
      await assertNoOverflow(page, `${account.role}/1440`);
      await page.screenshot({ path: join(artifacts, `${account.role}-desktop.png`), fullPage: true });
      await page.setViewportSize({ width: 768, height: 900 });
      await assertNoOverflow(page, `${account.role}/768`);
      await page.setViewportSize({ width: 390, height: 844 });
      const mobile = account.role === "admin" ? ".admin-mobile-nav" : account.role === "office" ? ".office-mobile-nav" : account.role === "mechanic" ? ".mechanic-phone-queues" : ".surveillance-compact-queues";
      await page.locator(mobile).waitFor({ state: "visible" });
      await assertNoOverflow(page, `${account.role}/390`);
      await page.screenshot({ path: join(artifacts, `${account.role}-phone.png`), fullPage: true });
      console.log(`PASS ${account.role}: desktop Queue options, selection, and phone controls`);
    } catch (error) {
      errors.push(`${account.role}: ${error.stack || error}`);
      await page.screenshot({ path: join(artifacts, `${account.role}-failure.png`), fullPage: true }).catch(() => {});
    } finally {
      await context.close();
    }
  }
  if (errors.length) throw new Error(errors.join("\n\n"));
  console.log(JSON.stringify({ result: "PASS", roles: accounts.map(({ role }) => role), artifacts }));
} catch (error) {
  console.error(error);
  console.error(`Role filter artifacts: ${artifacts}`);
  console.error(serverLog.slice(-2000));
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise(resolve => { if (server.exitCode != null) resolve(); else { server.once("exit", resolve); setTimeout(resolve, 3000); } });
  if (server.exitCode == null) server.kill("SIGKILL");
  await closePool();
}
