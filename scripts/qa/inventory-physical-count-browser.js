import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { chromium } from "playwright";
import { getPool, closePool } from "../../src/server/db/pool.js";
import { RoleApiClient } from "./e2e/api-client.js";
import { runQaAccountCommand } from "./manage-qa-accounts.js";
import { buildQaAccountManifest } from "./account-manifest.js";
import { assertQaTargetSafety, redactQaError } from "./safety.js";

const LOCAL = new Set(["localhost", "127.0.0.1", "::1"]);
const VIEWPORTS = [{ width: 1440, height: 1000 }, { width: 820, height: 1180 }, { width: 390, height: 844 }];
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required.`); return value; };

function settings() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_PHYSICAL_COUNT_BASE_URL || "http://localhost:4173");
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOCAL.has(baseUrl.hostname) || !LOCAL.has(database.hostname)) throw new Error("Physical-count browser QA only runs against a local app and database.");
  const password = required("QA_ACCOUNT_PASSWORD");
  if (password.length < 12) throw new Error("QA_ACCOUNT_PASSWORD must be at least 12 characters.");
  return { baseUrl, password, namespace: required("QA_ACCOUNT_NAMESPACE"), companySlug: process.env.QA_COMPANY_SLUG || "default", locationName: required("QA_LOCATION_NAME") };
}

async function createFixture(pool, config, actorId, viewport) {
  const scope = await pool.query(`select c.id company_id,l.id location_id from companies c join locations l on l.company_id=c.id
    where c.slug=$1 and c.active=true and l.active=true and lower(l.name)=lower($2) limit 1`, [config.companySlug, config.locationName]);
  assert.ok(scope.rows[0], "QA company/location was not found.");
  const token = randomUUID().replaceAll("-", "");
  const ids = Object.fromEntries(["warehouse", "area", "aisle", "shelf", "bin", "otherBin", "aggregatePart", "serialPart", "aggregateItem", "serialItem", "run", "receipt", "receiptLine", "unit1", "unit2", "wrongUnit"].map((key) => [key, randomUUID()]));
  const fixture = { ...scope.rows[0], ...ids, viewport, token, aggregateNumber: `QA-COUNT-A-${token.slice(0, 7).toUpperCase()}`, serialPartNumber: `QA-COUNT-S-${token.slice(0, 7).toUpperCase()}`, serial1: `QA-CS-${token.slice(0, 10).toUpperCase()}-1`, serial2: `QA-CS-${token.slice(0, 10).toUpperCase()}-2`, wrongSerial: `QA-CS-${token.slice(0, 10).toUpperCase()}-WRONG`, unknownSerial: `QA-CS-${token.slice(0, 10).toUpperCase()}-UNKNOWN`, reason: `Verified physical count ${viewport.width}` };
  fixture.codes = { warehouse: `QA-W-${token.slice(0, 5).toUpperCase()}`, area: `QA-Z-${token.slice(0, 5).toUpperCase()}`, aisle: `QA-A-${token.slice(0, 5).toUpperCase()}`, shelf: `QA-SH-${token.slice(0, 5).toUpperCase()}`, bin: `QA-B1-${token.slice(0, 5).toUpperCase()}`, otherBin: `QA-B2-${token.slice(0, 5).toUpperCase()}` };
  const client = await pool.connect();
  try {
    await client.query("begin");
    const positionRows = [
      [fixture.warehouse, null, fixture.codes.warehouse, `QA Warehouse ${viewport.width}`, "warehouse", null, false, false],
      [fixture.area, fixture.warehouse, fixture.codes.area, "Parts area", "area", null, false, false],
      [fixture.aisle, fixture.area, fixture.codes.aisle, "Aisle 1", "aisle", null, false, false],
      [fixture.shelf, fixture.aisle, fixture.codes.shelf, "Shelf 1", "shelf", null, false, false],
      [fixture.bin, fixture.shelf, fixture.codes.bin, "Bin 1", "bin", "storage", true, true],
      [fixture.otherBin, fixture.shelf, fixture.codes.otherBin, "Bin 2", "bin", "storage", true, true],
    ];
    for (const row of positionRows) await client.query(`insert into inventory_positions(id,company_id,location_id,parent_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)`, [row[0], fixture.company_id, fixture.location_id, row[1], row[2], row[3], row[4], row[5], row[6], row[7], actorId]);
    await client.query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values
      ($1,$2,$3,$4,'Aggregate count part','ea','quantity'),($5,$2,$6,$7,'Serialized count part','ea','serialized')`,
    [fixture.aggregatePart, fixture.company_id, fixture.aggregateNumber.replaceAll("-", ""), fixture.aggregateNumber, fixture.serialPart, fixture.serialPartNumber.replaceAll("-", ""), fixture.serialPartNumber]);
    await client.query(`insert into inventory_items(id,company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values
      ($1,$2,$3,$4,$5,$6,'Aggregate count part',6,0,'ea','local',$7),($8,$2,$3,$9,$10,$11,'Serialized count part',3,0,'ea','local',$12)`,
    [fixture.aggregateItem, fixture.company_id, fixture.location_id, fixture.aggregatePart, fixture.aggregateNumber.replaceAll("-", ""), fixture.aggregateNumber, `qa-count-a:${token}`, fixture.serialItem, fixture.serialPart, fixture.serialPartNumber.replaceAll("-", ""), fixture.serialPartNumber, `qa-count-s:${token}`]);
    await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity) values
      ($1,$2,$3,$4,$5,'ea',4),($1,$2,$6,$4,$5,'ea',2)`, [fixture.company_id, fixture.location_id, fixture.bin, fixture.aggregateItem, fixture.aggregatePart, fixture.otherBin]);
    const hash = createHash("sha256").update(`qa-count:${token}`).digest("hex");
    await client.query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','qa','qa','qa','{}'::jsonb,now())`, [fixture.run, fixture.company_id, fixture.location_id, actorId, hash, `QA-COUNT-${token}.pdf`, `qa-count:${token}`]);
    await client.query(`insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,$6,'local',$7,'QA physical count','confirmed',now())`, [fixture.receipt, fixture.company_id, fixture.location_id, fixture.run, actorId, `qa-receipt:${token}`, `QA-${token}`]);
    await client.query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode)
      values($1,$2,$3,0,$4,$5,$6,'Serialized count part',3,'ea','serial')`, [fixture.receiptLine, fixture.company_id, fixture.receipt, fixture.serialPart, `local:${fixture.serialPart}`, fixture.serialPartNumber]);
    await client.query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id,current_position_id)
      values($1,$2,$3,$4,$5,1,$6,'in_stock','new','inventory_location',$3,$7),($8,$2,$3,$4,$5,2,$9,'in_stock','new','inventory_location',$3,$7),($10,$2,$3,$4,$5,3,$11,'in_stock','new','inventory_location',$3,$12)`,
    [fixture.unit1, fixture.company_id, fixture.location_id, fixture.receipt, fixture.receiptLine, fixture.serial1, fixture.bin, fixture.unit2, fixture.serial2, fixture.wrongUnit, fixture.wrongSerial, fixture.otherBin]);
    await client.query("commit");
    return fixture;
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function moveAggregateAfterObservation(pool, fixture, actorId) {
  const operationId = randomUUID();
  fixture.movementOperationId = operationId;
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query(`insert into inventory_position_operations(id,company_id,location_id,actor_id,command_type,idempotency_key,request_hash,reason)
      values($1,$2,$3,$4,'move',$5,$6,'QA count concurrency')`, [operationId, fixture.company_id, fixture.location_id, actorId, `qa-move:${fixture.token}`, createHash("sha256").update(`qa-move:${fixture.token}`).digest("hex")]);
    await client.query("update inventory_position_balances set quantity=quantity-1,version=version+1,updated_at=now() where company_id=$1 and position_id=$2 and inventory_item_id=$3", [fixture.company_id, fixture.bin, fixture.aggregateItem]);
    await client.query("update inventory_position_balances set quantity=quantity+1,version=version+1,updated_at=now() where company_id=$1 and position_id=$2 and inventory_item_id=$3", [fixture.company_id, fixture.otherBin, fixture.aggregateItem]);
    await client.query(`insert into inventory_position_movements(operation_id,company_id,location_id,catalog_part_id,uom_code,quantity,from_position_id,to_position_id)
      values($1,$2,$3,$4,'ea',1,$5,$6)`, [operationId, fixture.company_id, fixture.location_id, fixture.aggregatePart, fixture.bin, fixture.otherBin]);
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function cleanupFixture(pool, fixture) {
  if (!fixture?.company_id) return;
  const positionIds = [fixture.warehouse, fixture.area, fixture.aisle, fixture.shelf, fixture.bin, fixture.otherBin];
  const partIds = [fixture.aggregatePart, fixture.serialPart];
  const itemIds = [fixture.aggregateItem, fixture.serialItem];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local app.allow_inventory_evidence_teardown='on'");
    await client.query("delete from inventory_position_movements where company_id=$1 and (catalog_part_id=any($2::uuid[]) or from_position_id=any($3::uuid[]) or to_position_id=any($3::uuid[]))", [fixture.company_id, partIds, positionIds]);
    await client.query("delete from inventory_position_operations where company_id=$1 and (count_session_id in (select id from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[])) or id=$3)", [fixture.company_id, positionIds, fixture.movementOperationId || null]);
    await client.query("delete from inventory_stock_movements where company_id=$1 and catalog_part_id=any($2::uuid[])", [fixture.company_id, partIds]);
    await client.query("delete from inventory_position_count_unit_snapshots where company_id=$1 and session_id in (select id from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[]))", [fixture.company_id, positionIds]);
    await client.query("delete from inventory_position_count_commands where company_id=$1 and session_id in (select id from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[]))", [fixture.company_id, positionIds]);
    await client.query("delete from inventory_position_count_lines where company_id=$1 and session_id in (select id from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[]))", [fixture.company_id, positionIds]);
    await client.query("delete from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[])", [fixture.company_id, positionIds]);
    await client.query("delete from inventory_unit_events where company_id=$1 and unit_id=any($2::uuid[])", [fixture.company_id, [fixture.unit1, fixture.unit2, fixture.wrongUnit]]);
    await client.query("delete from inventory_serialized_units where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.unit1, fixture.unit2, fixture.wrongUnit]]);
    await client.query("delete from inventory_position_balances where company_id=$1 and inventory_item_id=any($2::uuid[])", [fixture.company_id, itemIds]);
    await client.query("delete from inventory_items where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, itemIds]);
    await client.query("delete from inventory_receipt_lines where company_id=$1 and id=$2", [fixture.company_id, fixture.receiptLine]);
    await client.query("delete from inventory_receipts where company_id=$1 and id=$2", [fixture.company_id, fixture.receipt]);
    await client.query("delete from invoice_extraction_runs where company_id=$1 and id=$2", [fixture.company_id, fixture.run]);
    await client.query("delete from inventory_positions where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, positionIds]);
    await client.query("delete from parts_catalog where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, partIds]);
    const residue = await client.query(`select
      (select count(*)::int from inventory_position_count_sessions where company_id=$1 and position_id=any($2::uuid[])) counts,
      (select count(*)::int from inventory_positions where company_id=$1 and id=any($2::uuid[])) positions,
      (select count(*)::int from inventory_items where company_id=$1 and id=any($3::uuid[])) items,
      (select count(*)::int from inventory_serialized_units where company_id=$1 and id=any($4::uuid[])) units`, [fixture.company_id, positionIds, itemIds, [fixture.unit1, fixture.unit2, fixture.wrongUnit]]);
    assert.deepEqual(residue.rows[0], { counts: 0, positions: 0, items: 0, units: 0 });
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function openByLocation(page, config, fixture) {
  await page.goto(new URL("/?view=inventory&adminView=inventory&inventorySection=stock", config.baseUrl).href, { waitUntil: "domcontentloaded" });
  await page.getByRole("group", { name: "Inventory stock view" }).getByRole("button", { name: "By location", exact: true }).click();
  await page.getByRole("button", { name: new RegExp(config.locationName, "i") }).click();
  const warehouse = page.locator(`#inventory-stock-position-button-${fixture.warehouse}`);
  await warehouse.waitFor();
  await warehouse.focus();
  for (const expected of [fixture.area, fixture.aisle]) {
    await page.keyboard.press("ArrowRight");
    await page.locator(`#inventory-stock-position-button-${expected}`).waitFor();
    await page.keyboard.press("ArrowDown");
    await page.waitForFunction((id) => document.activeElement?.id === id, `inventory-stock-position-button-${expected}`);
  }
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Aisle 1", exact: true }).waitFor();
  await page.getByText(`${fixture.aggregateNumber}`).waitFor();
  assert.match(await page.locator(".inventory-location-stock-list").textContent(), /6 ea/);
  assert.match(await page.locator(".inventory-location-stock-list").textContent(), /3 ea/);
  await page.getByRole("button", { name: /Stock scope/ }).click();
  await page.getByRole("option", { name: "This location only", exact: true }).click();
  await page.getByText("No stock in this scope", { exact: true }).waitFor();
  if (fixture.viewport.width <= 700) await page.getByRole("button", { name: "Back to location hierarchy" }).click();
  await page.locator(`#inventory-stock-position-button-${fixture.aisle}`).focus();
  await page.keyboard.press("ArrowRight");
  await page.locator(`#inventory-stock-position-button-${fixture.shelf}`).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction((id) => document.activeElement?.id === id, `inventory-stock-position-button-${fixture.shelf}`);
  await page.keyboard.press("ArrowRight");
  await page.locator(`#inventory-stock-position-button-${fixture.bin}`).waitFor();
  await page.keyboard.press("ArrowDown");
  await page.waitForFunction((id) => document.activeElement?.id === id, `inventory-stock-position-button-${fixture.bin}`);
  await page.keyboard.press("Enter");
  await page.getByRole("heading", { name: "Bin 1", exact: true }).waitFor();
}

async function enterAggregate(page, fixture, value) {
  const input = page.getByLabel(`Counted quantity for ${fixture.aggregateNumber}`, { exact: true });
  await input.fill(String(value));
  await input.focus();
  await page.keyboard.press("Enter");
  await page.locator(".position-count-line-state", { hasText: "Saved" }).waitFor();
}

async function serial(page, value, expectedFeedback) {
  const input = page.getByLabel(/Scan serial or barcode|Serial number/, { exact: true });
  await input.fill(value);
  await input.focus();
  await page.keyboard.press("Enter");
  await page.locator(".position-count-feedback", { hasText: expectedFeedback }).waitFor();
}

async function completeCount(page, fixture, expectedAggregate) {
  await enterAggregate(page, fixture, expectedAggregate);
  await serial(page, fixture.serial1, "confirmed");
  await serial(page, fixture.serial1, "already confirmed");
  await serial(page, fixture.wrongSerial, "belongs to another location");
  await serial(page, fixture.unknownSerial, "was not found");
  await page.getByRole("button", { name: "Manual", exact: true }).click();
  await serial(page, fixture.serial2, "confirmed");
  await page.getByText("2 of 2 confirmed", { exact: true }).waitFor();
}

async function runViewport(browser, pool, client, config, fixture) {
  const context = await browser.newContext({ storageState: await client.storageState(), viewport: fixture.viewport });
  const page = await context.newPage(); const pageErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  try {
    await openByLocation(page, config, fixture);
    await page.getByRole("button", { name: "Add stock", exact: true }).waitFor();
    await page.getByRole("button", { name: "Starting inventory", exact: true }).waitFor();
    await page.getByRole("button", { name: "Add stock here", exact: true }).first().waitFor();
    await page.getByRole("button", { name: "Start count", exact: true }).click();
    await page.getByText("In progress", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Add found part", exact: true }).click();
    await page.getByRole("combobox", { name: "Choose a found master catalog part", exact: true }).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Found-part controls overflow at ${fixture.viewport.width}px`);
    await page.getByRole("button", { name: "Cancel", exact: true }).click();
    await completeCount(page, fixture, 4);
    await moveAggregateAfterObservation(pool, fixture, client.actor.id);
    await page.getByLabel("Apply reason").fill("First pass after movement");
    await page.getByRole("button", { name: "Apply physical count", exact: true }).click();
    await page.getByText("Needs recount", { exact: true }).waitFor();
    await page.getByRole("button", { name: "Count stock again", exact: true }).click();
    await page.getByText("In progress", { exact: true }).waitFor();
    await enterAggregate(page, fixture, 3);
    await serial(page, fixture.serial1, "confirmed");
    await page.getByRole("button", { name: "Manual", exact: true }).click();
    await serial(page, fixture.serial2, "confirmed");
    await page.getByLabel("Apply reason").fill(fixture.reason);
    await page.getByRole("button", { name: "Apply physical count", exact: true }).click();
    await page.getByText("Applied", { exact: true }).waitFor();
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("group", { name: "Inventory stock view" }).getByRole("button", { name: "By location", exact: true }).click();
    await page.getByRole("button", { name: new RegExp(config.locationName, "i") }).click();
    for (const id of [fixture.warehouse, fixture.area, fixture.aisle, fixture.shelf]) await page.locator(`#inventory-stock-position-${id} .inventory-location-tree-toggle`).click();
    await page.locator(`#inventory-stock-position-button-${fixture.bin}`).click();
    await page.getByRole("button", { name: "Resume count", exact: true }).click();
    await page.getByText(fixture.reason, { exact: false }).waitFor();
    await page.getByText(/Applied by QA Admin/).waitFor();
    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Horizontal overflow at ${fixture.viewport.width}px`);
    const evidence = await pool.query(`select status,apply_reason,created_by,applied_by from inventory_position_count_sessions where company_id=$1 and position_id=$2 order by created_at desc limit 1`, [fixture.company_id, fixture.bin]);
    assert.deepEqual(evidence.rows[0], { status: "applied", apply_reason: fixture.reason, created_by: client.actor.id, applied_by: client.actor.id });
    assert.deepEqual(pageErrors, []);
    return { viewport: `${fixture.viewport.width}x${fixture.viewport.height}`, nestedKeyboard: true, directAndSubtree: true, serialized: true, recountAndReload: true };
  } finally { await context.close(); }
}

async function main() {
  const config = settings(); const pool = getPool(); const fixtures = []; const failures = []; let browser; let client;
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(config.namespace).find((entry) => entry.role === "admin");
    client = await RoleApiClient.create({ role: "admin", baseUrl: config.baseUrl, timeoutMs: 20_000 });
    await client.authenticate({ ...account, password: config.password });
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
    const viewports = [];
    for (const viewport of VIEWPORTS) {
      const fixture = await createFixture(pool, config, client.actor.id, viewport); fixtures.push(fixture);
      viewports.push(await runViewport(browser, pool, client, config, fixture));
      await cleanupFixture(pool, fixture); fixtures.splice(fixtures.indexOf(fixture), 1);
    }
    console.log(JSON.stringify({ passed: true, viewports, cleanup: "complete" }));
  } catch (error) { failures.push(error); }
  finally {
    for (const fixture of [...fixtures].reverse()) try { await cleanupFixture(pool, fixture); } catch (error) { failures.push(error); }
    try { await browser?.close(); } catch (error) { failures.push(error); }
    try { await client?.dispose(); } catch (error) { failures.push(error); }
    try {
      await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
      const residue = await pool.query("select count(*)::int count from user_profiles where active=true and contact_email like $1", [`${config.namespace}.%@qa.invalid`]);
      assert.equal(residue.rows[0].count, 0, "QA accounts remain active after cleanup.");
    } catch (error) { failures.push(error); }
    await closePool().catch((error) => failures.push(error));
  }
  if (failures.length) { for (const failure of failures) console.error(redactQaError(failure)); process.exitCode = 1; }
}

await main();
