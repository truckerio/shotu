import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }];
const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required.`); return value; };

function settings() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_INVOICE_RECEIPT_BASE_URL || "http://localhost:4173");
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOCAL.has(baseUrl.hostname) || !LOCAL.has(database.hostname)) throw new Error("Invoice receipt browser QA only runs locally.");
  const password = required("QA_ACCOUNT_PASSWORD");
  if (password.length < 12) throw new Error("QA_ACCOUNT_PASSWORD must be at least 12 characters.");
  return { baseUrl, password, namespace: required("QA_ACCOUNT_NAMESPACE"), companySlug: process.env.QA_COMPANY_SLUG || "default", locationName: required("QA_LOCATION_NAME") };
}

function field(value) { return { value, confidence: 100, evidence: "QA fixture" }; }
function invoiceDraft({ invoiceNumber, poNumber, partId, partNumber, vendor }) {
  return {
    documentType: field("invoice"), vendorName: field(vendor), vendorAccount: field(""), invoiceNumber: field(invoiceNumber),
    invoiceDate: field("2026-09-19"), purchaseOrderNumber: field(poNumber), currency: field("USD"), subtotal: field(10), tax: field(0),
    shipping: field(0), total: field(10), warnings: [], lines: [{ id: "line-1", catalogPartId: partId, partNumber: field(partNumber),
      description: field("Invoice receipt browser part"), quantity: field(1), unitOfMeasure: field("ea"), unitPrice: field(10), lineTotal: field(10) }],
  };
}

async function createFixture(pool, config, actorId, viewport) {
  const scope = await pool.query(`select c.id company_id,l.id location_id from companies c join locations l on l.company_id=c.id
    where c.slug=$1 and c.active=true and l.active=true and lower(l.name)=lower($2) limit 1`, [config.companySlug, config.locationName]);
  assert.ok(scope.rows[0], "QA company/location was not found.");
  const token = randomUUID().replaceAll("-", "");
  const ids = { supplier: randomUUID(), position: randomUUID(), poOrder: randomUUID(), poLine: randomUUID(), bypassOrder: randomUUID(), bypassLine: randomUUID(), poPart: randomUUID(), bypassPart: randomUUID(), poRun: randomUUID(), bypassRun: randomUUID() };
  const fixture = { ...scope.rows[0], ...ids, viewport, token, vendor: `QA Invoice Vendor ${token.slice(0, 6)}`, positionCode: `QA-INV-BIN-${token.slice(0, 6).toUpperCase()}` };
  fixture.positionName = `QA invoice bin ${viewport.width}`;
  fixture.positionLabel = `${fixture.positionCode} · ${fixture.positionName}`;
  fixture.poNumber = `PO-INV-${token.slice(0, 7).toUpperCase()}`;
  fixture.bypassPoNumber = `PO-NOP-${token.slice(0, 7).toUpperCase()}`;
  fixture.poPartNumber = `QA-INV-PO-${token.slice(0, 6).toUpperCase()}`;
  fixture.bypassPartNumber = `QA-INV-NOP-${token.slice(0, 6).toUpperCase()}`;
  fixture.serialNumber = `QA-INV-SERIAL-${token.slice(0, 12).toUpperCase()}`;
  const digest = (value) => createHash("sha256").update(value).digest("hex");
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("insert into inventory_suppliers(id,company_id,name) values($1,$2,$3)", [fixture.supplier, fixture.company_id, fixture.vendor]);
    await client.query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,$4,$5,'bin','storage',true,true,$6)`, [fixture.position, fixture.company_id, fixture.location_id, fixture.positionCode, fixture.positionName, actorId]);
    await client.query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode) values
      ($1,$2,$3,$4,'Invoice PO part','ea','serialized'),($5,$2,$6,$7,'Invoice bypass part','ea','quantity')`,
    [fixture.poPart, fixture.company_id, fixture.poPartNumber, fixture.poPartNumber.replaceAll("-", ""), fixture.bypassPart, fixture.bypassPartNumber, fixture.bypassPartNumber.replaceAll("-", "")]);
    await client.query(`insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status) values
      ($1,$2,$3,$4,$5,$6,'USD','ordered'),($7,$2,$3,$4,$5,$8,'USD','ordered')`, [fixture.poOrder, fixture.company_id, fixture.location_id, fixture.supplier, actorId, fixture.poNumber, fixture.bypassOrder, fixture.bypassPoNumber]);
    await client.query(`insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode) values
      ($1,$2,$3,$4,$5,'Invoice PO part','ea',1,10,'serialized'),($6,$2,$7,$8,$9,'Invoice bypass part','ea',1,10,'quantity')`,
    [fixture.poLine, fixture.company_id, fixture.poOrder, fixture.poPart, fixture.poPartNumber, fixture.bypassLine, fixture.bypassOrder, fixture.bypassPart, fixture.bypassPartNumber]);
    const drafts = [
      [fixture.poRun, `INV-PO-${token.slice(0, 8)}`, fixture.poNumber, fixture.poPart, fixture.poPartNumber, `po-${token}`],
      [fixture.bypassRun, `INV-NOP-${token.slice(0, 8)}`, fixture.bypassPoNumber, fixture.bypassPart, fixture.bypassPartNumber, `bypass-${token}`],
    ];
    for (const [runId, invoiceNumber, poNumber, partId, partNumber, key] of drafts) {
      await client.query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
        values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','qa','qa','qa',$8::jsonb,now())`,
      [runId, fixture.company_id, fixture.location_id, actorId, digest(key), `${invoiceNumber}.pdf`, key, JSON.stringify(invoiceDraft({ invoiceNumber, poNumber, partId, partNumber, vendor: fixture.vendor }))]);
    }
    const receiving = await client.query("select id from inventory_positions where company_id=$1 and location_id=$2 and system_key='receiving'", [fixture.company_id, fixture.location_id]);
    fixture.receivingPosition = receiving.rows[0].id;
    await client.query("commit");
    return fixture;
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function cleanupFixture(pool, fixture) {
  if (!fixture?.company_id) return;
  const partIds = [fixture.poPart, fixture.bypassPart]; const lineIds = [fixture.poLine, fixture.bypassLine]; const runIds = [fixture.poRun, fixture.bypassRun]; const orderIds = [fixture.poOrder, fixture.bypassOrder];
  const client = await pool.connect();
  try {
    await client.query("begin"); await client.query("set local app.allow_inventory_evidence_teardown='on'");
    const receipts = (await client.query("select id from local_inventory_receipts where company_id=$1 and invoice_run_id=any($2::uuid[])", [fixture.company_id, runIds])).rows.map((row) => row.id);
    const deliveries = (await client.query("select id from inventory_purchase_deliveries where company_id=$1 and invoice_run_id=any($2::uuid[])", [fixture.company_id, runIds])).rows.map((row) => row.id);
    for (const table of ["inventory_label_batch_items", "inventory_label_batches"]) await client.query(`delete from ${table} where company_id=$1 and receipt_id=any($2::uuid[])`, [fixture.company_id, receipts]);
    await client.query(`delete from inventory_unit_events where company_id=$1 and unit_id in (select id from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[]))`, [fixture.company_id, receipts]);
    await client.query(`delete from inventory_position_movements where company_id=$1 and operation_id in (select id from inventory_position_operations where company_id=$1 and receipt_id=any($2::uuid[]))`, [fixture.company_id, receipts]);
    await client.query("delete from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_position_operations where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_position_balances where company_id=$1 and catalog_part_id=any($2::uuid[])", [fixture.company_id, partIds]);
    await client.query("delete from inventory_purchase_delivery_lines where company_id=$1 and delivery_id=any($2::uuid[])", [fixture.company_id, deliveries]);
    await client.query("delete from inventory_purchase_deliveries where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, deliveries]);
    await client.query("delete from inventory_purchase_receipt_allocations where company_id=$1 and purchase_line_id=any($2::uuid[])", [fixture.company_id, lineIds]);
    await client.query("delete from inventory_purchase_invoice_allocations where company_id=$1 and invoice_run_id=any($2::uuid[])", [fixture.company_id, runIds]);
    await client.query("delete from inventory_authority_cutovers where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_authority_exceptions where company_id=$1 and requested_catalog_part_id=any($2::uuid[])", [fixture.company_id, partIds]);
    await client.query("delete from inventory_stock_movements where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from local_inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_items where company_id=$1 and catalog_part_id=any($2::uuid[])", [fixture.company_id, partIds]);
    await client.query("delete from local_inventory_receipts where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from inventory_receipts where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, receipts]);
    await client.query("delete from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, runIds]);
    await client.query("delete from inventory_purchase_events where company_id=$1 and order_id=any($2::uuid[])", [fixture.company_id, orderIds]);
    await client.query("delete from inventory_purchase_lines where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, lineIds]);
    await client.query("delete from inventory_purchase_orders where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, orderIds]);
    await client.query("delete from parts_catalog where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, partIds]);
    await client.query("delete from inventory_positions where company_id=$1 and id=$2", [fixture.company_id, fixture.position]);
    await client.query("delete from inventory_suppliers where company_id=$1 and id=$2", [fixture.company_id, fixture.supplier]);
    const residue = await client.query(`select
      (select count(*)::int from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])) runs,
      (select count(*)::int from local_inventory_receipts where company_id=$1 and invoice_run_id=any($2::uuid[])) receipts,
      (select count(*)::int from inventory_purchase_orders where company_id=$1 and id=any($3::uuid[])) orders,
      (select count(*)::int from parts_catalog where company_id=$1 and id=any($4::uuid[])) parts,
      (select count(*)::int from inventory_positions where company_id=$1 and id=$5) positions`,
    [fixture.company_id, runIds, orderIds, partIds, fixture.position]);
    assert.deepEqual(residue.rows[0], { runs: 0, receipts: 0, orders: 0, parts: 0, positions: 0 });
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function choose(page, trigger, name) { await trigger.focus(); await page.keyboard.press("Enter"); const option = page.getByRole("option", { name, exact: true }); await option.waitFor(); await option.focus(); await page.keyboard.press("Enter"); }

async function setPositionActive(pool, fixture, active) {
  const result = await pool.query("update inventory_positions set is_active=$3,version=version+1,updated_at=now() where company_id=$1 and id=$2 returning id", [fixture.company_id, fixture.position, active]);
  assert.equal(result.rowCount, 1);
}

async function receiveInvoice(page, pool, baseUrl, fixture, { runId, route, targetPosition, staleTarget = false }) {
  await page.goto(new URL(`/?view=inventory&adminView=inventory&invoiceRun=${encodeURIComponent(runId)}`, baseUrl).href, { waitUntil: "domcontentloaded" });
  const confirmation = page.locator(".physical-receipt-confirmation");
  await confirmation.getByRole("heading", { name: "Confirm delivery", exact: true }).waitFor();
  if (route === "no_purchase_order") {
    await confirmation.getByRole("button", { name: "No purchase order", exact: true }).click();
    await confirmation.getByLabel(new RegExp("Reason for receiving without")).fill("Invoice was received directly without using this PO.");
  } else {
    await confirmation.getByRole("button", { name: "Use this PO", exact: true }).click();
  }
  await confirmation.getByRole("button", { name: "Edit line", exact: true }).click();
  await confirmation.getByLabel("Available now for line 1", { exact: true }).fill("1");
  if (targetPosition) await choose(page, confirmation.locator(".add-inventory-storage-picker .dropdown-select-trigger"), fixture.positionLabel);
  if (runId === fixture.poRun) await confirmation.getByLabel("Serialized identities for line 1", { exact: true }).fill(fixture.serialNumber);
  await confirmation.getByRole("button", { name: "Done", exact: true }).click();
  await confirmation.getByLabel(/I confirm the quantities and delivery exceptions/).check();
  const payloads = [];
  page.on("request", (request) => { if (request.method() === "POST" && request.url().endsWith(`/api/office/invoice-extractions/${runId}/confirm-receipt`)) payloads.push(request.postDataJSON()); });
  const post = confirmation.getByRole("button", { name: "Post received items", exact: true });
  if (staleTarget) {
    await setPositionActive(pool, fixture, false);
    const failed = page.waitForResponse((response) => response.url().endsWith(`/api/office/invoice-extractions/${runId}/confirm-receipt`) && response.request().method() === "POST");
    await post.focus(); await page.keyboard.press("Enter");
    const response = await failed; const body = await response.json();
    assert.equal(response.status(), 422); assert.equal(body.code, "INVENTORY_RECEIPT_POSITION_INVALID");
    await page.getByRole("alert").filter({ hasText: body.message || "Receipt target position" }).first().waitFor();
    await confirmation.getByRole("button", { name: "Edit line", exact: true }).click();
    await confirmation.locator(".add-inventory-storage-picker .dropdown-select-trigger").getByText("Receiving area", { exact: true }).waitFor();
    await confirmation.getByRole("button", { name: "Done", exact: true }).click();
    await confirmation.getByLabel(/I confirm the quantities and delivery exceptions/).check();
  }
  await post.focus(); await page.keyboard.press("Enter");
  await page.getByText(/part line added to|Inventory receipt completed/).first().waitFor();
  assert.equal(payloads.length, staleTarget ? 2 : 1);
  if (staleTarget) assert.equal(payloads[0].idempotencyKey, payloads[1].idempotencyKey, "Invoice retry must preserve the command identity.");
  return payloads.at(-1);
}

async function databaseEvidence(pool, fixture, { staleTarget = false } = {}) {
  const receipts = await pool.query("select invoice_run_id,posting_route,id from local_inventory_receipts where company_id=$1 and invoice_run_id=any($2::uuid[]) order by invoice_run_id", [fixture.company_id, [fixture.poRun, fixture.bypassRun]]);
  assert.equal(receipts.rowCount, 2);
  const byRun = new Map(receipts.rows.map((row) => [row.invoice_run_id, row]));
  assert.equal(byRun.get(fixture.poRun).posting_route, "purchase_order"); assert.equal(byRun.get(fixture.bypassRun).posting_route, "no_purchase_order");
  const delivery = await pool.query("select d.invoice_run_id,d.order_id,l.purchase_line_id from inventory_purchase_deliveries d left join inventory_purchase_delivery_lines l on l.company_id=d.company_id and l.delivery_id=d.id where d.company_id=$1 and d.invoice_run_id=any($2::uuid[]) order by d.invoice_run_id", [fixture.company_id, [fixture.poRun, fixture.bypassRun]]);
  const deliveryByRun = new Map(delivery.rows.map((row) => [row.invoice_run_id, row]));
  assert.deepEqual(deliveryByRun.get(fixture.poRun), { invoice_run_id: fixture.poRun, order_id: fixture.poOrder, purchase_line_id: fixture.poLine });
  assert.deepEqual(deliveryByRun.get(fixture.bypassRun), { invoice_run_id: fixture.bypassRun, order_id: null, purchase_line_id: null });
  const balances = await pool.query("select catalog_part_id,position_id,quantity from inventory_position_balances where company_id=$1 and catalog_part_id=$2", [fixture.company_id, fixture.bypassPart]);
  const byPart = new Map(balances.rows.map((row) => [row.catalog_part_id, row]));
  assert.equal(byPart.get(fixture.bypassPart).position_id, fixture.receivingPosition); assert.equal(Number(byPart.get(fixture.bypassPart).quantity), 1);
  const unit = await pool.query("select serial_number,current_position_id,status from inventory_serialized_units where company_id=$1 and serial_number=$2", [fixture.company_id, fixture.serialNumber]);
  assert.deepEqual(unit.rows[0], { serial_number: fixture.serialNumber, current_position_id: staleTarget ? fixture.receivingPosition : fixture.position, status: "in_stock" });
}

async function runViewport(browser, pool, client, config, fixture) {
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: fixture.viewport }); const page = await context.newPage(); const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  try {
    const staleTarget = fixture.viewport.width === 1440;
    const po = await receiveInvoice(page, pool, config.baseUrl, fixture, { runId: fixture.poRun, route: "purchase_order", targetPosition: true, staleTarget });
    assert.equal(po.postingRoute, "purchase_order"); assert.equal(po.receiptLines[0].purchaseLineId, fixture.poLine); assert.deepEqual(po.receiptLines[0].serialNumbers, [fixture.serialNumber]);
    if (staleTarget) assert.equal(Object.hasOwn(po.receiptLines[0], "targetPositionId"), false); else assert.equal(po.receiptLines[0].targetPositionId, fixture.position);
    const noPo = await receiveInvoice(page, pool, config.baseUrl, fixture, { runId: fixture.bypassRun, route: "no_purchase_order", targetPosition: false });
    assert.equal(noPo.postingRoute, "no_purchase_order"); assert.equal(Object.hasOwn(noPo.receiptLines[0], "purchaseLineId"), false); assert.equal(noPo.noPurchaseOrderReason, "Invoice was received directly without using this PO.");
    await databaseEvidence(pool, fixture, { staleTarget });
    await page.reload({ waitUntil: "domcontentloaded" }); await page.getByText("Inventory receipt completed", { exact: false }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Horizontal overflow at ${fixture.viewport.width}px`);
    assert.deepEqual(errors, []);
    return { viewport: `${fixture.viewport.width}x${fixture.viewport.height}`, staleTargetRecovered: staleTarget, serialized: true };
  } finally { await context.close(); }
}

async function main() {
  const config = settings(); const pool = getPool(); const fixtures = []; const failures = []; let browser; let client;
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(config.namespace).find((entry) => entry.role === "admin");
    client = await RoleApiClient.create({ role: "admin", baseUrl: config.baseUrl, timeoutMs: 20_000 }); await client.authenticate({ ...account, password: config.password });
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true }); const viewports = [];
    for (const viewport of VIEWPORTS) { const fixture = await createFixture(pool, config, client.actor.id, viewport); fixtures.push(fixture); viewports.push(await runViewport(browser, pool, client, config, fixture)); await cleanupFixture(pool, fixture); fixtures.splice(fixtures.indexOf(fixture), 1); }
    console.log(JSON.stringify({ passed: true, viewports, poAndExplicitNoPo: true, cleanup: "complete" }));
  } catch (error) { failures.push(error); }
  finally {
    for (const fixture of [...fixtures].reverse()) try { await cleanupFixture(pool, fixture); } catch (error) { failures.push(error); }
    try { await browser?.close(); } catch (error) { failures.push(error); } try { await client?.dispose(); } catch (error) { failures.push(error); }
    try {
      await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
      const accountResidue = await pool.query("select count(*)::int count from user_profiles where active=true and contact_email like $1", [`${config.namespace}.%@qa.invalid`]);
      assert.equal(accountResidue.rows[0].count, 0, "QA accounts remain active after cleanup.");
    } catch (error) { failures.push(error); }
    try { await closePool(); } catch (error) { failures.push(error); }
  }
  if (failures.length === 1) throw failures[0]; if (failures.length > 1) throw new AggregateError(failures, "Invoice receipt browser QA or cleanup failed.");
}

main().catch((error) => {
  console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD]));
  for (const nested of error?.errors || []) console.error(redactQaError(nested, [process.env.QA_ACCOUNT_PASSWORD]));
  process.exitCode = 1;
});
