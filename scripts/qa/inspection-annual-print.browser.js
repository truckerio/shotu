import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawn } from "node:child_process";
import { chromium } from "playwright";

// Only the disposable runner may supply this database. Never seed the configured app DB.
const target = new URL(process.env.DATABASE_URL || "");
if (!["localhost", "127.0.0.1", "[::1]"].includes(target.hostname) || !/^\/inspection_maintenance_test_[a-f0-9]{32}$/.test(target.pathname)) throw new Error("Inspection types rehearsal requires runner's disposable loopback database.");
const port = Number(process.env.QA_ANNUAL_PRINT_PORT || 4197);
const baseUrl = `http://localhost:${port}`;
Object.assign(process.env, { PORT: String(port), BETTER_AUTH_URL: baseUrl, AUTH_TRUSTED_ORIGINS: baseUrl, NODE_ENV: "development", SAMSARA_SYNC_ON_STARTUP: "false" });
const artifacts = await mkdtemp(join(tmpdir(), "inspection-annual-print-browser-"));
process.env.WORKORDER_STORAGE_DIR = artifacts;
const { getPool, closePool } = await import("../../src/server/db/pool.js");
const { seedInspectionMaintenanceBase } = await import("./inspection-maintenance-fixture.js");
const { auth } = await import("../../src/server/auth/auth.js");
const fixture = await seedInspectionMaintenanceBase(getPool());
const licensePlate = "QA-PLATE-42";
await getPool().query("update assets set license_plate=$2 where id=$1", [fixture.assetId, licensePlate]);
const customerId = randomUUID();
const foreignCustomerId = randomUUID();
const carrierName = "QA Annual Carrier";
const savedCarrierAddress = "123 Inspection Way\nFresno, CA 93722";
const carrierAddress = "456 Manual Inspection Way\nFresno, CA 93722";
await getPool().query("insert into customer_directory_customers(id,company_id,name,address,created_by_user_id,updated_by_user_id) values($1,$2,$3,$4,$5,$5),($6,$7,'Foreign QA Carrier','Foreign address',$8,$8)", [customerId, fixture.companyId, carrierName, savedCarrierAddress, fixture.officeId, foreignCustomerId, fixture.otherCompanyId, fixture.otherOfficeId]);
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
  await page.locator(".operational-unit-summary").getByText(licensePlate, { exact: true }).waitFor();
}
const digest = value => createHash("sha256").update(value).digest("hex");
async function api(page, path, method = "GET", data) {
  const response = await page.request.fetch(`${baseUrl}${path}`, { method, ...(data ? { data } : {}) });
  assert.ok(response.ok(), `${method} ${path}: ${response.status()} ${await response.text()}`);
  return response.json();
}
async function downloadFromUi(admin, inspection, filename) {
  let downloadPopup;
  const downloaded = new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("Download PDF button did not produce a browser download.")), 30000);
    const received = download => { clearTimeout(timer); resolve(download); };
    admin.page.once("download", received);
    admin.context.once("page", popup => { downloadPopup = popup; popup.once("download", received); });
  });
  await admin.page.getByRole("button", { name: "Download PDF", exact: true }).click();
  const download = await downloaded;
  assert.equal(download.suggestedFilename(), `${inspection.inspectionNumber}.pdf`);
  const path = join(artifacts, filename);
  await download.saveAs(path);
  assert.equal(await download.failure(), null);
  const bytes = await readFile(path);
  assert.equal(bytes.subarray(0, 5).toString(), "%PDF-");
  if (downloadPopup && !downloadPopup.isClosed()) await downloadPopup.close();
  return bytes;
}
async function saveLayout(page, option) {
  const saved = page.waitForResponse(response => new URL(response.url()).pathname.startsWith("/api/admin/inspection-templates/") && response.request().method() === "PATCH");
  await select(page, "Template print layout", option);
  assert.equal((await saved).status(), 200);
  await page.locator(".inspection-template-save.saved").waitFor();
  const savedRows = (await getPool().query("select renderer_version,definition from template_versions where company_id=$1 and state='draft'", [fixture.companyId])).rows;
  assert.equal(savedRows.length, 1);
  assert.equal(savedRows[0].renderer_version, savedRows[0].definition.rendererVersion);
}
async function previewLayout(page, annual) {
  const frame = page.frameLocator('iframe[title$="print preview"]');
  if (annual) await frame.locator(".annual-report").waitFor();
  else await frame.locator("body").waitFor();
  assert.equal(await frame.locator(".annual-report").count(), annual ? 1 : 0);
}
try {
  await ready();
  browser = await chromium.launch({ headless: true });
  const admin = await signIn(accounts[0]);
  await admin.page.goto(`${baseUrl}/?adminView=settings&settingsTab=templates`);
  await admin.page.getByRole("region", { name: "Inspection templates", exact: true }).waitFor();
  const createdResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/admin/inspection-templates" && response.request().method() === "POST");
  await admin.page.locator(".inspection-templates__create button").click();
  await admin.page.getByRole("option", { name: "Annual Truck", exact: true }).click();
  const created = await createdResponse;
  assert.equal(created.status(), 201);
  const { version } = await created.json();
  await admin.page.getByLabel("Template name", { exact: true }).waitFor();
  assert.match(await admin.page.locator('button[aria-label="Template print layout"]').innerText(), /Annual/i);
  const previewButton = admin.page.getByRole("button", { name: "Preview", exact: true });
  if (await previewButton.isVisible()) await previewButton.click();
  await previewLayout(admin.page, true);
  await saveLayout(admin.page, "Standard slip");
  await previewLayout(admin.page, false);
  await saveLayout(admin.page, "Annual report");
  await previewLayout(admin.page, true);
  await geometry(admin.page, "annual-print-designer");
  // Read the stored version directly for exact schema boundary and immutable evidence checks.
  const row = (await getPool().query("select definition,optimistic_version,renderer_version from template_versions where id=$1", [version.id])).rows[0];
  assert.equal(row.renderer_version, row.definition.rendererVersion);
  assert.equal(row.definition.printLayout, "annual_report");
  assert.equal(row.definition.rendererVersion, "inspection-annual-v1");
  assert.equal(row.definition.sections.length, 15);
  assert.equal(row.definition.sections.flatMap(section => section.items).length, 56);
  const invalid = await admin.page.request.patch(`${baseUrl}/api/admin/inspection-templates/${version.id}?companyId=${fixture.companyId}`, { data: { expectedVersion: Number(row.optimistic_version), definition: { ...row.definition, printLayout: "annual_report", rendererVersion: "inspection-slip-v1" } } });
  assert.equal(invalid.status(), 400, await invalid.text());
  const publishedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname.endsWith(`/${version.id}/publish`) && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Publish", exact: true }).click();
  assert.equal((await publishedResponse).status(), 200);
  await admin.page.getByText("This version is active.", { exact: true }).waitFor();
  const publishedRows = (await getPool().query("select renderer_version,definition from template_versions where id=$1", [version.id])).rows;
  assert.equal(publishedRows[0].renderer_version, publishedRows[0].definition.rendererVersion);

  // No-key operation remains a normal manual textarea on a fresh real create page.
  await admin.page.route("**/api/config", async route => {
    const upstream = await route.fetch();
    const config = await upstream.json();
    await route.fulfill({ response: upstream, json: { ...config, maps: { ...config.maps, googleMapsBrowserApiKey: "" } } });
  });
  await newInspection(admin.page);
  await admin.page.getByLabel("Business address", { exact: true }).fill("Manual entry without Google key");
  assert.equal(await admin.page.getByLabel("Business address", { exact: true }).inputValue(), "Manual entry without Google key");
  assert.equal(await admin.page.getByRole("listbox", { name: "Address suggestions", exact: true }).count(), 0);
  await admin.page.unroute("**/api/config");
  await admin.page.route("**/api/config", async route => {
    const upstream = await route.fetch();
    const config = await upstream.json();
    await route.fulfill({ response: upstream, json: { ...config, maps: { ...config.maps, googleMapsBrowserApiKey: "qa-browser-key" } } });
  });
  await admin.page.addInitScript(() => {
    window.__qaPlaces = { calls: [], fetchedFields: [] };
    window.google = { maps: { importLibrary: async name => {
      if (name !== "places") throw new Error("Unexpected Google library");
      return {
        AutocompleteSessionToken: class {},
        AutocompleteSuggestion: { fetchAutocompleteSuggestions: async ({ input, sessionToken }) => {
          window.__qaPlaces.calls.push({ input, sessionToken: Boolean(sessionToken) });
          if (input.startsWith("Provider failure")) throw new Error("QA provider unavailable");
          return { suggestions: [{ placePrediction: { text: { toString: () => "789 Google Suggestion Way, Fresno, CA" }, toPlace: () => ({ formattedAddress: "789 Google Suggestion Way, Fresno, CA 93722", fetchFields: async ({ fields }) => { window.__qaPlaces.fetchedFields.push(fields); } }) } }] };
        } },
      };
    } } };
  });
  await newInspection(admin.page);
  await select(admin.page, "Inspection type", "Annual");
  await select(admin.page, "Assign mechanic", "Maintenance mechanic");
  await admin.page.getByLabel("Customer company", { exact: true }).fill("QA Annual");
  await admin.page.locator(".customer-company-combobox-trigger").click();
  await admin.page.getByRole("option", { name: carrierName, exact: true }).click();
  const businessAddress = admin.page.getByLabel("Business address", { exact: true });
  await businessAddress.waitFor();
  assert.equal(await businessAddress.inputValue(), savedCarrierAddress);
  await businessAddress.fill("Provider failure QA");
  await admin.page.waitForFunction(() => window.__qaPlaces.calls.some(call => call.input === "Provider failure QA"));
  assert.equal(await businessAddress.inputValue(), "Provider failure QA");
  await businessAddress.fill("789 Google");
  await admin.page.getByRole("listbox", { name: "Address suggestions", exact: true }).getByRole("option", { name: "789 Google Suggestion Way, Fresno, CA", exact: true }).click();
  assert.equal(await businessAddress.inputValue(), "789 Google Suggestion Way, Fresno, CA 93722");
  assert.deepEqual(await admin.page.evaluate(() => window.__qaPlaces.fetchedFields), [["formattedAddress"]]);
  assert.ok(await admin.page.evaluate(() => window.__qaPlaces.calls.every(call => call.sessionToken)));
  await businessAddress.fill(carrierAddress);
  await businessAddress.blur();
  assert.equal(await businessAddress.inputValue(), carrierAddress);
  assert.equal((await getPool().query("select address from customer_directory_customers where id=$1", [customerId])).rows[0].address, savedCarrierAddress);
  await geometry(admin.page, "annual-customer-create");
  const invalidCustomer = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { companyId: fixture.companyId, assetId: fixture.assetId, locationId: fixture.locationId, inspectionType: "annual", mechanicUserIds: [fixture.mechanicId], customerAccountId: "invalid-uuid", idempotencyKey: `invalid-customer-${randomUUID()}` } });
  assert.equal(invalidCustomer.status(), 400);
  const anonymous = await browser.newContext();
  const unauthenticated = await anonymous.request.post(`${baseUrl}/api/inspections`, { data: { companyId: fixture.companyId, assetId: fixture.assetId, locationId: fixture.locationId, inspectionType: "annual", mechanicUserIds: [fixture.mechanicId], customerAccountId: customerId, customerCompanyName: carrierName, customerAddress: carrierAddress, idempotencyKey: `anonymous-customer-${randomUUID()}` } });
  assert.equal(unauthenticated.status(), 401);
  await anonymous.close();
  const foreign = await admin.page.request.post(`${baseUrl}/api/inspections`, { data: { companyId: fixture.companyId, assetId: fixture.assetId, locationId: fixture.locationId, inspectionType: "annual", mechanicUserIds: [fixture.mechanicId], customerAccountId: foreignCustomerId, customerCompanyName: "Foreign QA Carrier", customerAddress: "Foreign address", idempotencyKey: `foreign-carrier-${randomUUID()}` } });
  assert.equal(foreign.status(), 409, await foreign.text());
  assert.equal((await foreign.json()).code, "INSPECTION_CUSTOMER_INVALID");
  const requestedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === "/api/inspections" && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Request inspection", exact: true }).click();
  const requested = await requestedResponse;
  assert.equal(requested.status(), 201);
  assert.equal(requested.request().postDataJSON().customerAccountId, customerId);
  let inspection = (await requested.json()).inspection;
  assert.equal(inspection.templateSnapshot.sections.length, 15);
  const items = inspection.templateSnapshot.sections.flatMap(section => section.items);
  assert.equal(items.length, 56);
  await admin.page.goto(`${baseUrl}/?adminView=operations&from=inspection&inspection=${inspection.id}&anchor=summary`);
  await admin.page.getByLabel("Odometer miles", { exact: true }).fill("9800");
  const reviewed = admin.page.getByText("Previous report reviewed", { exact: true });
  if (await reviewed.count()) await reviewed.click();
  const startedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === `/api/inspections/${inspection.id}/actions/start`);
  await admin.page.getByRole("button", { name: "Start inspection", exact: true }).click();
  const started = await startedResponse;
  assert.equal(started.status(), 200);
  inspection = (await started.json()).inspection;
  await admin.page.getByRole("region", { name: "Inspection checklist", exact: true }).getByText(items[0].label, { exact: true }).waitFor();
  assert.equal(await admin.page.locator(".annual-report").count(), 0);
  await geometry(admin.page, "annual-simple-checklist");
  inspection = (await api(admin.page, `/api/inspections/${inspection.id}/responses`, "PATCH", { expectedVersion: inspection.version, responses: items.map(item => ({ itemKey: item.key, response: "pass" })) })).inspection;
  await admin.page.reload();
  const completionNote = `QA concern ${randomUUID()}: Inspect rear marker wiring at next scheduled service.`;
  await admin.page.locator(".inspection-optional-notes summary").click();
  await admin.page.getByLabel("Notes", { exact: true }).fill(completionNote);
  const completedResponse = admin.page.waitForResponse(response => new URL(response.url()).pathname === `/api/inspections/${inspection.id}/actions/complete` && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Complete inspection", exact: true }).click();
  const completed = await completedResponse;
  assert.equal(completed.status(), 200, await completed.text());
  inspection = (await completed.json()).inspection;
  assert.equal(inspection.status, "completed");
  assert.equal(inspection.finalNotes, completionNote);
  await admin.page.reload();
  await admin.page.locator(".inspection-final-notes").getByText(completionNote, { exact: true }).waitFor();
  const persisted = (await api(admin.page, `/api/inspections/${inspection.id}`)).inspection;
  assert.equal(persisted.finalNotes, completionNote);
  const initialArchive = (await getPool().query("select status,pdf_sha256 from inspection_print_archives where inspection_id=$1 order by revision_number desc limit 1", [inspection.id])).rows[0];
  const downloadedBytes = await downloadFromUi(admin, inspection, "annual-ui-downloaded.pdf");
  if (initialArchive.status === "ready") assert.equal(digest(downloadedBytes), initialArchive.pdf_sha256);
  const archiveResult = await api(admin.page, `/api/inspections/${inspection.id}/print-archives`, "POST", { idempotencyKey: `annual-print-${randomUUID()}` });
  const archiveId = archiveResult.archive.id;
  assert.equal(archiveResult.archive.status, "ready");
  const archiveRow = (await getPool().query("select snapshot,snapshot_sha256,pdf_sha256 from inspection_print_archives where id=$1", [archiveId])).rows[0];
  const archivedHtml = archiveRow.snapshot.html;
  assert.equal(archiveRow.snapshot.unit.licensePlate, licensePlate);
  assert.ok(archivedHtml.includes(licensePlate));
  assert.equal(archiveRow.snapshot.unit.reportCarrier.name, carrierName);
  assert.equal(archiveRow.snapshot.unit.reportCarrier.address, carrierAddress);
  assert.equal(archiveRow.snapshot.inspector.name, "Maintenance mechanic");
  assert.match(archivedHtml, /QA Annual Carrier/);
  assert.match(archivedHtml, /456 Manual Inspection Way/);
  assert.match(archivedHtml, /Maintenance mechanic/);
  assert.match(archivedHtml, /annual-report/);
  assert.equal(archiveRow.snapshot.finalNotes, completionNote);
  const canonicalDownloadedBytes = await downloadFromUi(admin, inspection, "annual-ui-canonical.pdf");
  assert.equal(digest(canonicalDownloadedBytes), archiveRow.pdf_sha256);
  const archivePath = `/api/inspections/${inspection.id}/print-archives/${archiveId}`;
  const frozen = await api(admin.page, archivePath);
  assert.equal(frozen.html, archivedHtml);
  const pdf = await admin.page.request.get(`${baseUrl}${archivePath}/pdf`);
  assert.equal(pdf.status(), 200);
  assert.match(pdf.headers()["content-type"], /application\/pdf/);
  assert.match(pdf.headers()["content-disposition"], /attachment/i);
  const pdfBytes = await pdf.body();
  assert.equal(pdfBytes.subarray(0, 5).toString(), "%PDF-");
  assert.equal(digest(pdfBytes), archiveRow.pdf_sha256);
  assert.equal(digest(pdfBytes), digest(canonicalDownloadedBytes));
  // Edit live directory/profile data only after completion; archived identity must stay frozen.
  await getPool().query("update customer_directory_customers set name='Changed live carrier',address='Changed live address',version=version+1 where id=$1", [customerId]);
  await getPool().query("update user_profiles set display_name='Changed live mechanic' where id=$1", [fixture.mechanicId]);
  assert.equal((await api(admin.page, archivePath)).html, archivedHtml);
  const afterDirectoryChange = await admin.page.request.get(`${baseUrl}${archivePath}/pdf`);
  assert.equal(afterDirectoryChange.status(), 200);
  assert.equal(digest(await afterDirectoryChange.body()), digest(pdfBytes));
  await writeFile(join(artifacts, "annual-original.pdf"), pdfBytes);
  await writeFile(join(artifacts, "annual-original.html"), archivedHtml);
  const report = await admin.context.newPage();
  await report.setViewportSize({ width: 816, height: 1056 });
  await report.emulateMedia({ media: "print" });
  await report.setContent(archivedHtml);
  await report.locator(".annual-report").waitFor();
  const reportDimensions = await report.evaluate(() => ({ width: document.documentElement.clientWidth, scroll: document.documentElement.scrollWidth, report: document.querySelector(".annual-report").getBoundingClientRect().toJSON() }));
  assert.ok(reportDimensions.scroll <= 817, JSON.stringify(reportDimensions));
  assert.ok(reportDimensions.report.right <= 817, JSON.stringify(reportDimensions));
  const writingGeometry = await report.evaluate(() => {
    const area = document.querySelector(".other-writing-space");
    const columns = [...document.querySelectorAll(".component-column")].map(column => column.getBoundingClientRect().toJSON());
    return { area: area?.getBoundingClientRect().toJSON() || null, columns, bottom: Math.max(...columns.map(column => column.bottom)) };
  });
  assert.ok(writingGeometry.area, "Other handwriting area exists");
  assert.ok(writingGeometry.area.height > 100, JSON.stringify(writingGeometry));
  assert.ok(Math.abs(writingGeometry.area.bottom - writingGeometry.bottom) <= 2, JSON.stringify(writingGeometry));
  await report.screenshot({ path: join(artifacts, "annual-report-letter.png"), fullPage: true });

  await admin.page.goto(`${baseUrl}/?adminView=settings&settingsTab=templates`);
  await admin.page.locator(".inspection-template-catalog button").filter({ hasText: "Annual Truck Inspection" }).first().click();
  await admin.page.getByRole("button", { name: "Create revision", exact: true }).click();
  await admin.page.getByRole("button", { name: "Publish", exact: true }).waitFor();
  await saveLayout(admin.page, "Standard slip");
  await previewLayout(admin.page, false);
  const revisionPublished = admin.page.waitForResponse(response => new URL(response.url()).pathname.endsWith("/publish") && response.request().method() === "POST");
  await admin.page.getByRole("button", { name: "Publish", exact: true }).click();
  const revisionResult = await revisionPublished;
  assert.equal(revisionResult.status(), 200);
  const revisionId = (await revisionResult.json()).version.id;
  const revisedRow = (await getPool().query("select renderer_version,definition from template_versions where id=$1", [revisionId])).rows[0];
  assert.equal(revisedRow.renderer_version, revisedRow.definition.rendererVersion);
  assert.equal(revisedRow.renderer_version, "inspection-slip-v1");
  assert.equal((await api(admin.page, archivePath)).html, archivedHtml);
  const reloadedPdf = await admin.page.request.get(`${baseUrl}${archivePath}/pdf`);
  assert.equal(reloadedPdf.status(), 200);
  assert.equal(digest(await reloadedPdf.body()), digest(pdfBytes));
  const preserved = (await getPool().query("select snapshot_sha256,pdf_sha256 from inspection_print_archives where id=$1", [archiveId])).rows[0];
  assert.equal(preserved.snapshot_sha256, archiveRow.snapshot_sha256);
  assert.equal(preserved.pdf_sha256, archiveRow.pdf_sha256);
  const weekly = (await getPool().query("select renderer_version,definition from template_versions where id=$1", [fixture.templateVersionId])).rows[0];
  assert.equal(weekly.renderer_version, "inspection-slip-v1");
  assert.equal(weekly.definition.printLayout, undefined);
  console.log(JSON.stringify({ result: "PASS", checks: ["Annual default paper preview", "Standard/Annual layout persisted", "56 checks/15 sections", "device remains simple checklist", "invalid layout/renderer400", "no-key manual address entry", "mock Google suggestion selection and failure fallback", "saved carrier selected and manual report address edited through UI without changing directory", "invalid customer UUID400 and unauthenticated401", "cross-tenant carrier rejected", "carrier and inspector snapshot remains immutable after directory edits", "UI completion notes survive reload", "UI Download PDF filename and bytes match archive", "Other writing space reaches checklist bottom", "completed annual archived paper HTML", "real PDF route and stored digest", "Letter print width", "layout revision preserves original HTML/PDF bytes", "legacy standard renderer unchanged"], completionNote, initialArchive, writingGeometry, downloadedSha256: digest(downloadedBytes), canonicalDownloadedSha256: digest(canonicalDownloadedBytes), reportDimensions, artifacts }));
} catch (error) {
  console.error(error);
  if (browser) for (const [index, context] of browser.contexts().entries()) for (const [pageIndex, page] of context.pages().entries()) {
    try { console.error(await page.locator("body").ariaSnapshot({ timeout: 2000 })); await page.screenshot({ path: join(artifacts, `failure-${index}-${pageIndex}.png`), fullPage: true }); } catch {}
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
