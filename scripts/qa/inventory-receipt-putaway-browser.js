import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const VIEWPORTS = [
  { width: 1440, height: 1000 },
  { width: 820, height: 1180 },
  { width: 390, height: 844 },
];
const required = (name) => {
  const value = String(process.env[name] || "").trim();
  if (!value) throw new Error(`${name} is required.`);
  return value;
};

function config() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_RECEIPT_PUTAWAY_BASE_URL || "http://localhost:4173");
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOCAL.has(baseUrl.hostname) || !LOCAL.has(database.hostname)) {
    throw new Error("Receipt put-away browser QA only runs against a local app and database.");
  }
  const password = required("QA_ACCOUNT_PASSWORD");
  if (password.length < 12) throw new Error("QA_ACCOUNT_PASSWORD must be at least 12 characters.");
  return {
    baseUrl,
    password,
    namespace: required("QA_ACCOUNT_NAMESPACE"),
    companySlug: process.env.QA_COMPANY_SLUG || "default",
    locationName: required("QA_LOCATION_NAME"),
  };
}

async function createFixture(pool, { companySlug, locationName, actorId, viewport }) {
  const token = randomUUID().replaceAll("-", "");
  const scope = await pool.query(`select company.id company_id,location.id location_id
    from companies company join locations location on location.company_id=company.id
    where company.slug=$1 and company.active=true and location.active=true and lower(location.name)=lower($2) limit 1`, [companySlug, locationName]);
  if (!scope.rows[0]) throw new Error("QA company/location was not found.");
  const { company_id: companyId, location_id: locationId } = scope.rows[0];
  const lineIds = Array.from({ length: 6 }, () => randomUUID()).sort();
  const specs = [
    { key: "aggregateExact", partNumber: `QA-QTY-BIN-${token.slice(0, 8)}`, description: "Aggregate exact put-away", tracking: "quantity", quantity: 2, price: "12.3400" },
    { key: "serializedExact", partNumber: `QA-SER-BIN-${token.slice(0, 8)}`, description: "Serialized exact put-away", tracking: "serialized", quantity: 1, price: "44.5000" },
    { key: "aggregateReceiving", partNumber: `QA-QTY-REC-${token.slice(0, 8)}`, description: "Aggregate receiving default", tracking: "quantity", quantity: 1, price: "2.2500" },
    { key: "serializedHeld", partNumber: `QA-SER-HOLD-${token.slice(0, 8)}`, description: "Serialized held exception", tracking: "serialized", quantity: 1, price: "9.0000" },
    { key: "aggregateRejected", partNumber: `QA-QTY-REJ-${token.slice(0, 8)}`, description: "Aggregate rejected exception", tracking: "quantity", quantity: 1, price: "7.0000" },
    { key: "aggregateShort", partNumber: `QA-QTY-SHORT-${token.slice(0, 8)}`, description: "Aggregate shortage", tracking: "quantity", quantity: 1, price: "5.0000" },
  ].map((spec, index) => ({ ...spec, partId: randomUUID(), lineId: lineIds[index] }));
  const fixture = {
    token,
    viewport,
    companyId,
    locationId,
    supplierId: randomUUID(),
    orderId: randomUUID(),
    positionId: randomUUID(),
    positionCode: `QA-BIN-${token.slice(0, 8).toUpperCase()}`,
    positionName: `QA Bin ${viewport.width}`,
    orderNumber: `PO-PUTAWAY-${viewport.width}-${token.slice(0, 7).toUpperCase()}`,
    reference: `QA-PUTAWAY-${token}`,
    acceptedSerial: `QA-SERIAL-${token.slice(0, 12).toUpperCase()}`,
    heldSerial: `QA-HOLD-${token.slice(0, 12).toUpperCase()}`,
    specs,
  };
  fixture.positionLabel = `${fixture.positionCode} · ${fixture.positionName}`;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("insert into inventory_suppliers(id,company_id,name) values($1,$2,$3)", [fixture.supplierId, companyId, `QA Put-away Supplier ${token.slice(0, 8)}`]);
    await client.query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,$4,$5,'bin','storage',true,true,$6)`, [fixture.positionId, companyId, locationId, fixture.positionCode, fixture.positionName, actorId]);
    await client.query(`insert into inventory_purchase_orders(id,company_id,location_id,supplier_id,created_by,number,currency,status,notes)
      values($1,$2,$3,$4,$5,$6,'CAD','ordered',$7)`, [fixture.orderId, companyId, locationId, fixture.supplierId, actorId, fixture.orderNumber, fixture.reference]);
    for (const spec of specs) {
      await client.query(`insert into parts_catalog(id,company_id,part_number,normalized_part_number,description,uom_code,tracking_mode)
        values($1,$2,$3,$4,$5,'ea',$6)`, [spec.partId, companyId, spec.partNumber, spec.partNumber.replaceAll("-", ""), spec.description, spec.tracking]);
      await client.query(`insert into inventory_purchase_lines(id,company_id,order_id,catalog_part_id,part_number,description,uom_code,quantity,unit_price,tracking_mode)
        values($1,$2,$3,$4,$5,$6,'ea',$7,$8,$9)`, [spec.lineId, companyId, fixture.orderId, spec.partId, spec.partNumber, spec.description, spec.quantity, spec.price, spec.tracking]);
    }
    const receiving = await client.query("select id from inventory_positions where company_id=$1 and location_id=$2 and system_key='receiving'", [companyId, locationId]);
    assert.ok(receiving.rows[0]?.id, "The QA location must have SYS-RECEIVING.");
    fixture.receivingPositionId = receiving.rows[0].id;
    await client.query("commit");
    return fixture;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function setPositionActive(pool, fixture, active) {
  const result = await pool.query("update inventory_positions set is_active=$4,version=version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3 returning id", [fixture.companyId, fixture.locationId, fixture.positionId, active]);
  assert.equal(result.rowCount, 1, "QA put-away position must exist.");
}

async function cleanupFixture(pool, fixture) {
  if (!fixture?.companyId) return;
  const partIds = fixture.specs.map((spec) => spec.partId);
  const lineIds = fixture.specs.map((spec) => spec.lineId);
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local app.allow_inventory_evidence_teardown='on'");
    const receiptRows = await client.query(`select distinct receipt_id from inventory_receipt_lines
      where company_id=$1 and catalog_part_id=any($2::uuid[])`, [fixture.companyId, partIds]);
    const receiptIds = receiptRows.rows.map((row) => row.receipt_id);
    await client.query("delete from inventory_label_batch_items where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_label_batches where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query(`delete from inventory_unit_events where company_id=$1 and unit_id in
      (select id from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[]))`, [fixture.companyId, receiptIds]);
    await client.query(`delete from inventory_position_movements where company_id=$1 and operation_id in
      (select id from inventory_position_operations where company_id=$1 and receipt_id=any($2::uuid[]))`, [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_position_operations where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_position_balances where company_id=$1 and catalog_part_id=any($2::uuid[])", [fixture.companyId, partIds]);
    await client.query("delete from inventory_position_reconciliation_exceptions where company_id=$1 and catalog_part_id=any($2::uuid[])", [fixture.companyId, partIds]);
    await client.query(`delete from inventory_purchase_delivery_lines where company_id=$1 and
      (purchase_line_id=any($2::uuid[]) or receipt_line_id=any($3::uuid[]))`, [fixture.companyId, lineIds, receiptIds]);
    await client.query("delete from inventory_purchase_deliveries where company_id=$1 and order_id=$2", [fixture.companyId, fixture.orderId]);
    await client.query("delete from inventory_stock_movements where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_purchase_receipt_allocations where company_id=$1 and purchase_line_id=any($2::uuid[])", [fixture.companyId, lineIds]);
    await client.query("delete from inventory_authority_cutovers where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_authority_exceptions where company_id=$1 and requested_catalog_part_id=any($2::uuid[])", [fixture.companyId, partIds]);
    await client.query("delete from local_inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=any($3::uuid[])", [fixture.companyId, fixture.locationId, partIds]);
    await client.query("delete from local_inventory_receipts where company_id=$1 and id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_receipts where company_id=$1 and id=any($2::uuid[])", [fixture.companyId, receiptIds]);
    await client.query("delete from inventory_purchase_events where company_id=$1 and order_id=$2", [fixture.companyId, fixture.orderId]);
    await client.query("delete from inventory_purchase_lines where company_id=$1 and id=any($2::uuid[])", [fixture.companyId, lineIds]);
    await client.query("delete from inventory_purchase_orders where company_id=$1 and id=$2", [fixture.companyId, fixture.orderId]);
    await client.query("delete from inventory_positions where company_id=$1 and id=$2", [fixture.companyId, fixture.positionId]);
    await client.query("delete from inventory_suppliers where company_id=$1 and id=$2", [fixture.companyId, fixture.supplierId]);
    await client.query("delete from parts_catalog where company_id=$1 and id=any($2::uuid[])", [fixture.companyId, partIds]);
    const residue = await client.query(`select
      (select count(*)::integer from inventory_purchase_orders where company_id=$1 and id=$2) orders,
      (select count(*)::integer from inventory_purchase_lines where company_id=$1 and id=any($3::uuid[])) purchase_lines,
      (select count(*)::integer from parts_catalog where company_id=$1 and id=any($4::uuid[])) parts,
      (select count(*)::integer from inventory_positions where company_id=$1 and id=$5) positions,
      (select count(*)::integer from local_inventory_receipts where company_id=$1 and id=any($6::uuid[])) receipts`,
    [fixture.companyId, fixture.orderId, lineIds, partIds, fixture.positionId, receiptIds]);
    assert.deepEqual(residue.rows[0], { orders: 0, purchase_lines: 0, parts: 0, positions: 0, receipts: 0 });
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function chooseDropdownOption(page, trigger, optionName) {
  await trigger.focus();
  assert.equal(await trigger.evaluate((element) => document.activeElement === element), true, `Keyboard focus must reach ${await trigger.getAttribute("aria-label") || "dropdown"}.`);
  await page.keyboard.press("Enter");
  const option = page.getByRole("option", { name: optionName, exact: true });
  await option.waitFor();
  await option.focus();
  await page.keyboard.press("Enter");
  await assert.doesNotReject(trigger.getByText(optionName, { exact: true }).waitFor());
}

async function openPurchaseReceipt(page, fixture, locationName) {
  await page.goto(new URL("/?view=inventory&adminView=inventory&inventorySection=purchases", page.url()).href, { waitUntil: "domcontentloaded" });
  const sectionHeader = page.locator(".operational-collection-section-header");
  await sectionHeader.getByRole("heading", { name: "Purchasing", exact: true }).waitFor();
  const purchaseOrders = page.getByRole("group", { name: "Purchases views" }).getByRole("button", { name: "Purchase orders", exact: true });
  await purchaseOrders.focus();
  await page.keyboard.press("Enter");
  const locationTrigger = page.locator(".purchase-orders-toolbar .dropdown-select-trigger");
  await locationTrigger.waitFor();
  if ((await locationTrigger.textContent()).trim() !== locationName) await chooseDropdownOption(page, locationTrigger, locationName);
  const row = page.getByRole("row").filter({ hasText: fixture.orderNumber });
  await row.waitFor();
  const receive = row.getByRole("button", { name: "Receive items", exact: true });
  await receive.click();
  const dialog = page.getByRole("dialog", { name: "Receive purchase order" });
  await dialog.waitFor();
  await dialog.getByRole("button", { name: "Edit line", exact: true }).first().waitFor();
  return dialog;
}

async function editLine(page, dialog, lineNumber, action) {
  const edit = dialog.getByRole("button", { name: "Edit line", exact: true }).nth(lineNumber - 1);
  await edit.focus();
  await page.keyboard.press("Enter");
  await action();
  await dialog.getByRole("button", { name: "Done", exact: true }).click();
}

async function fillReceipt(page, dialog, fixture) {
  await editLine(page, dialog, 1, async () => {
    await dialog.getByLabel("Available now for line 1", { exact: true }).fill("2");
    const destination = dialog.locator(".receipt-line-card.is-expanded .add-inventory-storage-picker .dropdown-select-trigger");
    await destination.waitFor({ state: "visible" });
    await chooseDropdownOption(page, destination, fixture.positionLabel);
  });
  await editLine(page, dialog, 2, async () => {
    await dialog.getByLabel("Available now for line 2", { exact: true }).fill("1");
    await chooseDropdownOption(page, dialog.locator(".receipt-line-card.is-expanded .add-inventory-storage-picker .dropdown-select-trigger"), fixture.positionLabel);
    const identities = dialog.getByLabel("Serialized identities for line 2", { exact: true });
    if (fixture.viewport.width === 1440) {
      await identities.focus();
      await page.keyboard.type(fixture.acceptedSerial);
      await page.keyboard.press("Enter");
    } else {
      await identities.fill(`${fixture.acceptedSerial}\n`);
    }
  });
  await editLine(page, dialog, 3, async () => {
    await dialog.getByLabel("Available now for line 3", { exact: true }).fill("1");
    assert.equal((await dialog.locator(".receipt-line-card.is-expanded .add-inventory-storage-picker .dropdown-select-trigger").textContent()).trim(), "Receiving area");
  });
  await editLine(page, dialog, 4, async () => {
    await dialog.getByLabel("Serialized identities for line 4", { exact: true }).fill(fixture.heldSerial);
    await dialog.getByRole("button", { name: "Report an exception", exact: true }).click();
    await dialog.getByLabel("Held now for line 4", { exact: true }).fill("1");
    await chooseDropdownOption(page, dialog.locator(".receipt-line-card.is-expanded .receipt-exception-fields .dropdown-select-trigger"), "Damaged");
    await dialog.getByLabel(/Hold location/).fill("QA quarantine");
    await dialog.getByLabel(/Findings/).fill("Housing damaged in transit");
  });
  await editLine(page, dialog, 5, async () => {
    await dialog.getByRole("button", { name: "Report an exception", exact: true }).click();
    await dialog.getByLabel("Rejected now for line 5", { exact: true }).fill("1");
    await chooseDropdownOption(page, dialog.locator(".receipt-line-card.is-expanded .receipt-exception-fields .dropdown-select-trigger"), "Wrong item");
    await dialog.getByLabel(/Findings/).fill("Wrong supplier part");
  });
  await editLine(page, dialog, 6, async () => {
    await dialog.getByRole("button", { name: "Report an exception", exact: true }).click();
    await dialog.getByLabel("Not delivered for line 6", { exact: true }).fill("1");
    await chooseDropdownOption(page, dialog.locator(".receipt-line-card.is-expanded .receipt-exception-fields .dropdown-select-trigger"), "Short delivery");
    await dialog.getByLabel(/Findings/).fill("Carrier shortage");
  });
  await dialog.getByLabel("Delivery reference (optional)", { exact: true }).fill(fixture.reference);
  await assert.doesNotReject(dialog.getByRole("button", { name: "Post received items", exact: true }).waitFor());
  assert.equal(await dialog.getByRole("button", { name: "Post received items", exact: true }).isEnabled(), true);
}

async function databaseEvidence(pool, fixture, { staleTarget = false } = {}) {
  const { rows: receiptRows } = await pool.query(`select distinct receipt.id,local.source_type,local.posting_route,local.source_reference
    from inventory_purchase_delivery_lines delivery_line
    join inventory_receipt_lines line on line.company_id=delivery_line.company_id and line.id=delivery_line.receipt_line_id
    join inventory_receipts receipt on receipt.company_id=line.company_id and receipt.id=line.receipt_id
    join local_inventory_receipts local on local.company_id=receipt.company_id and local.id=receipt.id
    where delivery_line.company_id=$1 and delivery_line.purchase_line_id=any($2::uuid[])`, [fixture.companyId, fixture.specs.map((spec) => spec.lineId)]);
  assert.equal(receiptRows.length, 1);
  assert.deepEqual({ source_type: receiptRows[0].source_type, posting_route: receiptRows[0].posting_route, source_reference: receiptRows[0].source_reference },
    { source_type: "direct", posting_route: "purchase_order", source_reference: fixture.reference });
  const receiptId = receiptRows[0].id;
  const costs = await pool.query(`select part_number,quantity,unit_cost,line_total,currency,cost_source,catalog_tracking_mode
    from inventory_receipt_lines where company_id=$1 and receipt_id=$2 order by line_index`, [fixture.companyId, receiptId]);
  const costByPart = new Map(costs.rows.map((row) => [row.part_number, row]));
  for (const spec of fixture.specs.slice(0, 5)) {
    const line = costByPart.get(spec.partNumber);
    assert.ok(line, `Receipt cost evidence is missing for ${spec.key}.`);
    assert.equal(line.currency, "CAD");
    assert.equal(line.unit_cost, spec.price);
    assert.equal(line.cost_source, "purchase_order");
    assert.equal(line.catalog_tracking_mode, spec.tracking);
    assert.equal(Number(line.line_total), Number(spec.price) * Number(line.quantity));
  }
  assert.equal(costByPart.has(fixture.specs[5].partNumber), false, "Short-only line must not create a receipt batch.");

  const items = await pool.query(`select catalog_part_id,quantity_on_hand,quantity_reserved from inventory_items
    where company_id=$1 and location_id=$2 and catalog_part_id=any($3::uuid[])`, [fixture.companyId, fixture.locationId, fixture.specs.map((spec) => spec.partId)]);
  const itemByPart = new Map(items.rows.map((row) => [row.catalog_part_id, row]));
  assert.equal(Number(itemByPart.get(fixture.specs[0].partId)?.quantity_on_hand), 2);
  assert.equal(Number(itemByPart.get(fixture.specs[1].partId)?.quantity_on_hand), 1);
  assert.equal(Number(itemByPart.get(fixture.specs[2].partId)?.quantity_on_hand), 1);
  for (const spec of fixture.specs.slice(3)) assert.equal(itemByPart.has(spec.partId), false, `${spec.key} must not become usable stock.`);

  const positions = await pool.query(`select balance.catalog_part_id,balance.position_id,balance.quantity
    from inventory_position_balances balance where balance.company_id=$1 and balance.location_id=$2 and balance.catalog_part_id=any($3::uuid[])
    order by balance.catalog_part_id`, [fixture.companyId, fixture.locationId, fixture.specs.map((spec) => spec.partId)]);
  assert.deepEqual(positions.rows.map((row) => ({ ...row, quantity: Number(row.quantity) })).sort((a, b) => a.catalog_part_id.localeCompare(b.catalog_part_id)), [
    { catalog_part_id: fixture.specs[0].partId, position_id: staleTarget ? fixture.receivingPositionId : fixture.positionId, quantity: 2 },
    { catalog_part_id: fixture.specs[2].partId, position_id: fixture.receivingPositionId, quantity: 1 },
  ].sort((a, b) => a.catalog_part_id.localeCompare(b.catalog_part_id)));

  const units = await pool.query(`select line.catalog_part_id,unit.serial_number,unit.status,unit.current_position_id
    from inventory_serialized_units unit join inventory_receipt_lines line
      on line.company_id=unit.company_id and line.id=unit.receipt_line_id
    where unit.company_id=$1 and unit.receipt_id=$2 order by unit.serial_number`, [fixture.companyId, receiptId]);
  assert.deepEqual(units.rows, [
    { catalog_part_id: fixture.specs[3].partId, serial_number: fixture.heldSerial, status: "held", current_position_id: null },
    { catalog_part_id: fixture.specs[1].partId, serial_number: fixture.acceptedSerial, status: "in_stock", current_position_id: staleTarget ? fixture.receivingPositionId : fixture.positionId },
  ].sort((a, b) => a.serial_number.localeCompare(b.serial_number)));

  const outcomes = await pool.query(`select purchase_line_id,outcome,usable_quantity,held_quantity,rejected_quantity,actual_quantity
    from inventory_purchase_delivery_lines where company_id=$1 and delivery_id in
      (select id from inventory_purchase_deliveries where company_id=$1 and order_id=$2)`, [fixture.companyId, fixture.orderId]);
  const outcomeByLine = new Map(outcomes.rows.map((row) => [row.purchase_line_id, row]));
  assert.deepEqual({ outcome: outcomeByLine.get(fixture.specs[3].lineId).outcome, usable: Number(outcomeByLine.get(fixture.specs[3].lineId).usable_quantity), held: Number(outcomeByLine.get(fixture.specs[3].lineId).held_quantity) }, { outcome: "damaged", usable: 0, held: 1 });
  assert.deepEqual({ outcome: outcomeByLine.get(fixture.specs[4].lineId).outcome, usable: Number(outcomeByLine.get(fixture.specs[4].lineId).usable_quantity), rejected: Number(outcomeByLine.get(fixture.specs[4].lineId).rejected_quantity) }, { outcome: "wrong_item", usable: 0, rejected: 1 });
  assert.deepEqual({ outcome: outcomeByLine.get(fixture.specs[5].lineId).outcome, actual: Number(outcomeByLine.get(fixture.specs[5].lineId).actual_quantity) }, { outcome: "shortage", actual: 0 });
  const order = await pool.query("select status,version from inventory_purchase_orders where company_id=$1 and id=$2", [fixture.companyId, fixture.orderId]);
  assert.equal(order.rows[0].status, "partially_received");
  return { receiptId, lineCount: costs.rowCount, orderVersion: Number(order.rows[0].version) };
}

async function runViewport({ browser, pool, client, baseUrl, locationName, fixture, staleTarget }) {
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: fixture.viewport });
  const page = await context.newPage();
  const pageErrors = [];
  const consoleErrors = [];
  const failedInventoryResponses = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", async (response) => {
    if (response.url().includes("/api/office/inventory/") && !response.ok()) failedInventoryResponses.push({ status: response.status(), url: response.url() });
  });
  try {
    await page.goto(new URL("/?view=inventory&adminView=inventory&inventorySection=purchases", baseUrl).href, { waitUntil: "domcontentloaded" });
    const dialog = await openPurchaseReceipt(page, fixture, locationName);
    await fillReceipt(page, dialog, fixture);
    const post = dialog.getByRole("button", { name: "Post received items", exact: true });
    const requests = [];
    page.on("request", (request) => {
      if (request.method() === "POST" && request.url().endsWith(`/api/office/inventory/purchasing/${fixture.orderId}/receipts`)) requests.push(request.postDataJSON());
    });
    if (staleTarget) {
      await setPositionActive(pool, fixture, false);
      const rejectedResponse = page.waitForResponse((response) => response.url().endsWith(`/api/office/inventory/purchasing/${fixture.orderId}/receipts`) && response.request().method() === "POST");
      await post.focus();
      await page.keyboard.press("Enter");
      const rejected = await rejectedResponse;
      const rejectedBody = await rejected.json();
      assert.equal(rejected.status(), 422);
      assert.equal(rejectedBody.code, "INVENTORY_RECEIPT_POSITION_INVALID");
      await dialog.getByRole("alert").filter({ hasText: rejectedBody.message || rejectedBody.error || "Receipt target position" }).first().waitFor();
      assert.equal(await dialog.isVisible(), true, "Invalid target must keep the receipt draft open.");
      await editLine(page, dialog, 1, async () => {
        await dialog.locator(".receipt-line-card.is-expanded .add-inventory-storage-picker .dropdown-select-trigger").getByText("Receiving area", { exact: true }).waitFor();
      });
      await editLine(page, dialog, 2, async () => {
        await dialog.locator(".receipt-line-card.is-expanded .add-inventory-storage-picker .dropdown-select-trigger").getByText("Receiving area", { exact: true }).waitFor();
      });
    }
    await post.focus();
    await page.keyboard.press("Enter");
    await dialog.waitFor({ state: "hidden" });
    assert.equal(requests.length, staleTarget ? 2 : 1);
    if (staleTarget) assert.equal(requests[0].idempotencyKey, requests[1].idempotencyKey, "Retry must preserve receipt identity.");
    const posted = requests.at(-1);
    const byLine = new Map(posted.lines.map((line) => [line.purchaseLineId, line]));
    if (staleTarget) {
      assert.equal(Object.hasOwn(byLine.get(fixture.specs[0].lineId), "targetPositionId"), false);
      assert.equal(Object.hasOwn(byLine.get(fixture.specs[1].lineId), "targetPositionId"), false);
    } else {
      assert.equal(byLine.get(fixture.specs[0].lineId).targetPositionId, fixture.positionId);
      assert.equal(byLine.get(fixture.specs[1].lineId).targetPositionId, fixture.positionId);
    }
    assert.equal(Object.hasOwn(byLine.get(fixture.specs[2].lineId), "targetPositionId"), false);
    for (const spec of fixture.specs.slice(3)) assert.equal(Object.hasOwn(byLine.get(spec.lineId), "targetPositionId"), false);
    assert.deepEqual(byLine.get(fixture.specs[1].lineId).serialNumbers, [fixture.acceptedSerial]);
    assert.deepEqual(byLine.get(fixture.specs[3].lineId).serialNumbers, [fixture.heldSerial]);
    const evidence = await databaseEvidence(pool, fixture, { staleTarget });

    await page.reload({ waitUntil: "domcontentloaded" });
    const sectionHeader = page.locator(".operational-collection-section-header");
    await sectionHeader.getByRole("heading", { name: "Purchasing", exact: true }).waitFor();
    await page.getByRole("group", { name: "Purchases views" }).getByRole("button", { name: "Purchase orders", exact: true }).click();
    const locationTrigger = page.locator(".purchase-orders-toolbar .dropdown-select-trigger");
    await locationTrigger.waitFor();
    if ((await locationTrigger.textContent()).trim() !== locationName) await chooseDropdownOption(page, locationTrigger, locationName);
    const persistedRow = page.getByRole("row").filter({ hasText: fixture.orderNumber });
    await persistedRow.waitFor();
    await persistedRow.getByText("Partially received", { exact: true }).waitFor();
    assert.equal(await persistedRow.getByRole("button", { name: "Receive items", exact: true }).count(), 1, "Short quantity must remain open after refresh.");
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Horizontal overflow at ${fixture.viewport.width}px`);
    assert.deepEqual(pageErrors, [], `Page errors at ${fixture.viewport.width}px`);
    assert.equal(consoleErrors.length, staleTarget ? 1 : 0, `Unexpected console errors at ${fixture.viewport.width}px: ${consoleErrors.join(" | ")}`);
    if (staleTarget) assert.match(consoleErrors[0], /status of 422/);
    assert.deepEqual(failedInventoryResponses.map((entry) => entry.status), staleTarget ? [422] : [], `Unexpected inventory API errors at ${fixture.viewport.width}px`);
    return { viewport: `${fixture.viewport.width}x${fixture.viewport.height}`, staleTargetRecovered: staleTarget, ...evidence };
  } finally {
    await context.close();
  }
}

async function main() {
  const settings = config();
  const pool = getPool();
  const fixtures = [];
  const cleanupErrors = [];
  let client;
  let browser;
  let primaryError;
  const results = [];
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${settings.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(settings.namespace).find((entry) => entry.role === "admin");
    client = await RoleApiClient.create({ role: "admin", baseUrl: settings.baseUrl, timeoutMs: 20_000 });
    await client.authenticate({ ...account, password: settings.password });
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
    for (const [index, viewport] of VIEWPORTS.entries()) {
      const fixture = await createFixture(pool, { ...settings, actorId: client.actor.id, viewport });
      fixtures.push(fixture);
      results.push(await runViewport({ browser, pool, client, baseUrl: settings.baseUrl, locationName: settings.locationName, fixture, staleTarget: index === 0 }));
      await cleanupFixture(pool, fixture);
      fixtures.splice(fixtures.indexOf(fixture), 1);
    }
  } catch (error) {
    primaryError = error;
  } finally {
    for (const fixture of [...fixtures].reverse()) {
      try { await cleanupFixture(pool, fixture); } catch (error) { cleanupErrors.push(error); }
    }
    try { await browser?.close(); } catch (error) { cleanupErrors.push(error); }
    try { await client?.dispose(); } catch (error) { cleanupErrors.push(error); }
    try { await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${settings.namespace}`], environment: process.env }); } catch (error) { cleanupErrors.push(error); }
    try { await closePool(); } catch (error) { cleanupErrors.push(error); }
  }
  if (primaryError || cleanupErrors.length) throw new AggregateError([primaryError, ...cleanupErrors].filter(Boolean), primaryError ? primaryError.message : "Receipt put-away QA cleanup failed.");
  console.log(JSON.stringify({ passed: true, viewports: results, fixturesRemaining: 0, qaAccountCleanup: "complete" }));
}

main().catch((error) => {
  console.error(redactQaError(error, [process.env.QA_ACCOUNT_PASSWORD]));
  for (const nested of error?.errors || []) console.error(redactQaError(nested, [process.env.QA_ACCOUNT_PASSWORD]));
  process.exitCode = 1;
});
