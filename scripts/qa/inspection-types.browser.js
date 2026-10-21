import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// Only the disposable runner may supply this database. Never seed the configured app DB.
const target = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(target.pathname)) throw new Error("Inspection types rehearsal requires runner's disposable loopback database.");
const port = Number(process.env.QA_INSPECTION_TYPES_PORT || 4198);
const baseUrl = `http://localhost:${port}`;
Object.assign(process.env, { PORT: String(port), BETTER_AUTH_URL: baseUrl, AUTH_TRUSTED_ORIGINS: baseUrl, NODE_ENV: "development", SAMSARA_SYNC_ON_STARTUP: "false" });
const artifacts = await mkdtemp(join(tmpdir(), "inspection-types-browser-"));
process.env.WORKORDER_STORAGE_DIR = artifacts;
const { getPool, closePool } = await import("../../src/server/db/pool.js");
const { seedInspectionMaintenanceBase } = await import("./inspection-maintenance-fixture.js");
const { auth } = await import("../../src/server/auth/auth.js");
const fixture = await seedInspectionMaintenanceBase(getPool());
const adminId = randomUUID();
await getPool().query("insert into user_profiles(id,display_name) values($1,'Inspection types Admin')", [adminId]);
await getPool().query("insert into user_company_memberships(user_id,company_id,role) values($1,$2,'admin')", [adminId, fixture.companyId]);
await getPool().query("insert into user_location_memberships(user_id,location_id,company_id) values($1,$2,$3)", [adminId, fixture.locationId, fixture.companyId]);
const password = `Inspection-${randomUUID()}!`;
const accounts = [];
for (const [role, profileId] of [["admin", adminId], ["office", fixture.officeId]]) {
  const username = `types${role}${randomUUID().replaceAll("-", "").slice(0, 10)}`;
  const email = `${username}@example.test`;
  const result = await auth.api.signUpEmail({ body: { name: `Inspection ${role}`, email, username, displayUsername: username, password } });
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
    if (server.exitCode != null) throw new Error(`Disposable server exited: ${serverLog.slice(-2000)}`);
    try { if ((await fetch(`${baseUrl}/health/live`)).ok) return; } catch {}
    await new Promise(resolve => setTimeout(resolve, 100));
  }
  throw new Error(`Disposable server did not start: ${serverLog.slice(-2000)}`);
}
async function signIn(account) {
  const context = await browser.newContext({ viewport: { width: 1440, height: 1000 } });
  const page = await context.newPage();
  await page.goto(baseUrl);
  await page.getByLabel("Username or email", { exact: true }).fill(account.username);
  await page.locator("#login-password").fill(password);
  const response = page.waitForResponse(item => new URL(item.url()).pathname === "/api/auth/sign-in/username");
  await page.getByRole("button", { name: "Sign in", exact: true }).click();
  assert.equal((await response).status(), 200);
  await page.locator("#login-password").waitFor({ state: "hidden" });
  return { context, page };
}
async function select(page, label, option) {
  await page.locator(`button[aria-label="${label}"]`).click();
  await page.getByRole("option", { name: option, exact: true }).click();
  await page.getByRole("listbox").waitFor({ state: "hidden" });
}
async function geometry(page, name) {
  for (const width of [1440, 768, 390]) {
    await page.setViewportSize({ width, height: width === 390 ? 844 : 1024 });
    await page.evaluate(() => new Promise(resolve => requestAnimationFrame(() => requestAnimationFrame(resolve))));
    const dimensions = await page.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth }));
    if (dimensions.scroll > dimensions.width + 1) {
      console.error("Overflow elements", await page.locator("body *").evaluateAll(elements => elements.map(element => ({ tag: element.tagName, className: element.className, label: element.getAttribute("aria-label"), rect: element.getBoundingClientRect().toJSON() })).filter(element => element.rect.width && element.rect.right > document.documentElement.clientWidth + 1).slice(0, 25)));
    }
    assert.ok(dimensions.scroll <= dimensions.width + 1, `${name} overflow: ${JSON.stringify(dimensions)}`);
    await page.screenshot({ path: join(artifacts, `${name}-${width}.png`), fullPage: true });
  }
  await page.setViewportSize({ width: 1440, height: 1000 });
}
async function newInspection(page) {
  await page.goto(`${baseUrl}/?adminView=operations`);
  const direct = page.getByRole("button", { name: "Create inspection", exact: true });
  if (await direct.count()) await direct.click();
  else { await page.getByRole("button", { name: "Create", exact: true }).click(); await page.getByRole("menuitem", { name: "Create inspection", exact: true }).click(); }
  await page.getByRole("searchbox", { name: "Search truck or trailer", exact: true }).fill("QA-MAINT-1");
  await page.getByRole("region", { name: "Matching units", exact: true }).getByRole("button").filter({ hasText: "QA-MAINT-1" }).click();
  await page.locator(".inspection-template-summary").waitFor();
}
const templatePath = `/api/admin/inspection-templates?companyId=${fixture.companyId}`;
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const anonymous = await browser.newContext();
  assert.equal((await anonymous.request.get(`${baseUrl}${templatePath}`)).status(), 401);
  const admin = await signIn(accounts[0]);
  const office = await signIn(accounts[1]);
  assert.equal((await office.page.request.get(`${baseUrl}${templatePath}`)).status(), 403);
  const before = (await getPool().query("select id,template_version_id,version from template_assignments where company_id=$1 and inspection_type='weekly'", [fixture.companyId])).rows;

  await admin.page.goto(`${baseUrl}/?adminView=settings&settingsTab=templates`);
  await admin.page.getByRole("region", { name: "Inspection templates", exact: true }).waitFor();
  const createdResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/inspection-templates" && response.request().method() === "POST");
  await admin.page.locator(".inspection-templates__create button").click();
  await admin.page.getByRole("option", { name: "Annual Truck", exact: true }).click();
  const created = await createdResponse;
  assert.equal(created.status(), 201);
  const { version } = await created.json();
  await admin.page.getByLabel("Template name", { exact: true }).fill("Annual fleet safety QA");
  await admin.page.getByRole("textbox", { name: /^Check 1 in / }).first().fill("Annual service brake evidence QA");
  await admin.page.locator(".inspection-template-save.saved").waitFor();
  await geometry(admin.page, "annual-designer");
  const publishedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${version.id}/publish`) && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Publish", exact: true }).click();
  const published = await publishedResponse;
  assert.equal(published.status(), 200, await published.text());
  await admin.page.getByText("This version is active.", { exact: true }).waitFor();
  assert.deepEqual((await getPool().query("select id,template_version_id,version from template_assignments where company_id=$1 and inspection_type='weekly'", [fixture.companyId])).rows, before);
  const mismatch = await admin.page.request.post(`${baseUrl}/api/admin/inspection-templates/assignments`, { data: { companyId: fixture.companyId, locationId: null, familyKey: "inspection", applicabilityKey: "Truck", inspectionType: "weekly", templateVersionId: version.id, expectedVersion: 0 } });
  assert.equal(mismatch.status(), 409, await mismatch.text());

  await newInspection(admin.page);
  await select(admin.page, "Inspection type", "Annual");
  await admin.page.locator(".inspection-template-summary").getByText("Annual fleet safety QA", { exact: true }).waitFor();
  await select(admin.page, "Assign mechanic", "Maintenance mechanic");
  await geometry(admin.page, "annual-create");
  await select(admin.page, "Inspection type", "Post-trip");
  await admin.page.getByText("No published template assigned. Ask Admin to publish and assign this inspection type.", { exact: true }).waitFor();
  assert.equal(await admin.page.getByRole("button", { name: "Request inspection", exact: true }).isDisabled(), true);
  await select(admin.page, "Inspection type", "Weekly");
  await admin.page.locator(".inspection-template-summary").getByText("Maintenance integration inspection", { exact: true }).waitFor();
  await select(admin.page, "Inspection type", "Annual");
  const requestedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/inspections" && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Request inspection", exact: true }).click();
  const requested = await requestedResponse;
  assert.equal(requested.status(), 201, await requested.text());
  const sent = requested.request().postDataJSON();
  assert.equal(sent.inspectionType, "annual");
  const annual = (await requested.json()).inspection;
  assert.notEqual(annual.id, fixture.sourceInspectionId);
  assert.equal(annual.inspectionType, "annual");
  assert.equal(annual.templateVersionId, version.id);
  assert.equal(annual.templateSnapshot.label, "Annual fleet safety QA");
  assert.equal(annual.templateSnapshot.sections[0].items[0].label, "Annual service brake evidence QA");
  const stored = (await getPool().query("select inspection_kind,template_snapshot from inspections where id=$1", [annual.id])).rows[0];
  assert.equal(stored.inspection_kind, "annual_truck");
  assert.deepEqual(stored.template_snapshot, annual.templateSnapshot);
  await admin.page.reload();
  const fresh = await admin.page.request.get(`${baseUrl}/api/inspections/${annual.id}`);
  assert.equal(fresh.status(), 200);
  assert.deepEqual((await fresh.json()).inspection.templateSnapshot, annual.templateSnapshot);
  await admin.page.goto(`${baseUrl}/?adminView=operations&from=inspection&inspection=${annual.id}&anchor=summary`);
  await admin.page.getByLabel("Odometer miles", { exact: true }).fill("9800");
  const reviewed = admin.page.getByText("Previous report reviewed", { exact: true });
  if (await reviewed.count()) await reviewed.click();
  const startedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === `/api/inspections/${annual.id}/actions/start` && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Start inspection", exact: true }).click();
  const started = await startedResponse;
  assert.equal(started.status(), 200, await started.text());
  await admin.page.getByRole("region", { name: "Inspection checklist", exact: true }).getByText("Annual service brake evidence QA", { exact: true }).waitFor();
  await geometry(admin.page, "annual-detail");
  const deduped = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { ...sent, idempotencyKey: `annual-dedupe-${randomUUID()}` } });
  assert.equal(deduped.status(), 201);
  assert.equal((await deduped.json()).inspection.id, annual.id);
  const weekly = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { ...sent, inspectionType: "weekly", idempotencyKey: `weekly-dedupe-${randomUUID()}` } });
  assert.equal(weekly.status(), 201);
  assert.equal((await weekly.json()).inspection.id, fixture.sourceInspectionId);
  const switched = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { ...sent, inspectionType: "weekly" } });
  assert.equal(switched.status(), 409);
  assert.equal((await switched.json()).code, "INSPECTION_CREATE_IDEMPOTENCY_CONFLICT");
  const unavailable = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { ...sent, inspectionType: "post_trip", idempotencyKey: `post-trip-missing-${randomUUID()}` } });
  assert.equal(unavailable.status(), 409);
  assert.equal((await unavailable.json()).code, "INSPECTION_TEMPLATE_UNAVAILABLE");
  console.log(JSON.stringify({ result: "PASS", workflow: "real authenticated Admin designer/create/detail with disposable PostgreSQL", checks: ["annual create/edit/publish", "weekly assignment unchanged", "unauthenticated and Office Admin access rejected", "assignment type mismatch rejected", "annual kind/type/template snapshot", "fresh reload persistence", "weekly and annual independent active dedupe", "idempotency type switch conflict", "missing post-trip published template blocks UI/API", "designer/create/detail 390/768/1440 geometry"], artifacts }));
} catch (error) {
  console.error(error);
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const page of context.pages()) {
    try { console.error(await page.locator("body").ariaSnapshot({ timeout: 2000 })); await page.screenshot({ path: join(artifacts, `failure-${index}.png`), fullPage: true }); } catch {}
  }
  console.error(`Failure artifacts: ${artifacts}\n${serverLog.slice(-2000)}`);
  process.exitCode = 1;
} finally {
  if (browser) await browser.close();
  server.kill("SIGTERM");
  await new Promise(resolve => { if (server.exitCode != null) resolve(); else { server.once("exit", resolve); setTimeout(resolve, 3000); } });
  if (server.exitCode == null) server.kill("SIGKILL");
  await closePool();
}
