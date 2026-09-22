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
const KINDS = ["damage_inspection", "receipt_exception", "missing_invoice", "invoice_po_decision", "no_po_approval", "transfer_receipt", "position_recount", "removed_part_custody"];
const hash = (value) => createHash("sha256").update(value).digest("hex");
const required = (name) => { const value = String(process.env[name] || "").trim(); if (!value) throw new Error(`${name} is required.`); return value; };

function settings() {
  const safety = assertQaTargetSafety({ environment: process.env, options: { target: process.env.QA_TARGET_ENVIRONMENT } });
  const baseUrl = new URL(process.env.QA_TASK_QUEUE_BASE_URL || "http://localhost:4173");
  const database = new URL(required("DATABASE_URL"));
  if (safety.production || !LOCAL.has(baseUrl.hostname) || !LOCAL.has(database.hostname)) throw new Error("Task-queue browser QA only runs against a local app and database.");
  return { baseUrl, password: required("QA_ACCOUNT_PASSWORD"), namespace: required("QA_ACCOUNT_NAMESPACE"), companySlug: process.env.QA_COMPANY_SLUG || "default", locationName: required("QA_LOCATION_NAME") };
}

async function createFixture(pool, config, actorId, viewport) {
  const scope = await pool.query(`select c.id company_id,l.id location_id from companies c join locations l on l.company_id=c.id
    where c.slug=$1 and c.active and l.active and lower(l.name)=lower($2) limit 1`, [config.companySlug, config.locationName]);
  assert.ok(scope.rows[0], "QA company/location was not found.");
  const token = randomUUID().replaceAll("-", "");
  const ids = Object.fromEntries(["origin", "part", "damage", "transfer", "delivery", "invoiceDelivery", "invoiceDecision", "receipt", "approval", "position", "count", "unit", "reuse", "reuseReceiptLine", "originalWorkorder"].map((key) => [key, randomUUID()]));
  const fixture = { ...scope.rows[0], ...ids, token, viewport, partNumber: `QA-TASK-${token.slice(0, 8).toUpperCase()}`, fillerTaskIds: [], fillerUnitIds: [], fillerCaseIds: [] };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role='replica'");
    await client.query("insert into locations(id,company_id,name) values($1,$2,$3)", [fixture.origin, fixture.company_id, `QA origin ${viewport.width} ${token.slice(0, 5)}`]);
    await client.query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Task queue browser part','ea','serialized')", [fixture.part, fixture.company_id, fixture.partNumber.replaceAll("-", ""), fixture.partNumber]);
    await client.query("insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by) values($1,$2,$3,$4,'damage','inspection',1,'ea','Browser damage',$5)", [fixture.damage, fixture.company_id, fixture.location_id, fixture.part, actorId]);
    await client.query("insert into inventory_stock_tasks(id,company_id,location_id,destination_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by) values($1,$2,$3,$4,$5,'transfer','in_transit',1,'ea','Browser transfer',$6)", [fixture.transfer, fixture.company_id, fixture.origin, fixture.location_id, fixture.part, actorId]);
    const draft = JSON.stringify({ invoiceNumber: { value: `QA-INV-${token.slice(0, 8)}` }, vendorName: { value: "QA Task Vendor" }, purchaseOrderNumber: { value: "" } });
    await client.query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,$6,'application/pdf',1,$7,'reviewed','qa','qa','qa',$8::jsonb,now()),
      ($9,$2,$3,$4,$4,$10,$11,'application/pdf',1,$12,'reviewed','qa','qa','qa',$8::jsonb,now())`,
    [fixture.invoiceDelivery, fixture.company_id, fixture.location_id, actorId, hash(`delivery-${token}`), `QA delivery ${token}.pdf`, `qa-delivery-${token}`, draft, fixture.invoiceDecision, hash(`decision-${token}`), `QA decision ${token}.pdf`, `qa-decision-${token}`]);
    await client.query("update invoice_extraction_runs set reviewed_draft=jsonb_set(reviewed_draft,'{invoiceNumber,value}',to_jsonb($3::text)) where company_id=$1 and id=$2", [fixture.company_id, fixture.invoiceDelivery, `QA-DEL-${token.slice(0, 8)}`]);
    await client.query("insert into inventory_purchase_deliveries(id,company_id,invoice_run_id,location_id,received_by,idempotency_key,request_hash,status) values($1,$2,$3,$4,$5,$6,$7,'posted')", [fixture.delivery, fixture.company_id, fixture.invoiceDelivery, fixture.location_id, actorId, `qa-delivery-${token}`, hash(`qa-delivery-${token}`)]);
    await client.query("insert into inventory_purchase_delivery_lines(company_id,delivery_id,purchase_line_id,outcome,expected_quantity,actual_quantity,usable_quantity,held_quantity,rejected_quantity,uom_code) values($1,$2,$3,'shortage',1,0,0,0,0,'ea')", [fixture.company_id, fixture.delivery, randomUUID()]);
    await client.query("insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,status,confirmed_at) values($1,$2,$3,$4,$5,'local_direct',$6,'confirmed',now())", [fixture.receipt, fixture.company_id, fixture.location_id, actorId, `qa-receipt-${token}`, `QA-DIRECT-${token}`]);
    await client.query(`insert into local_inventory_receipts(id,company_id,location_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,physical_confirmation,confirmation_hash,source_type,posting_route,no_purchase_order_reason)
      values($1,$2,$3,$4,$5,$6,'posted',0,0,'physically_received',$7,'direct','no_purchase_order','Browser direct arrival')`, [fixture.receipt, fixture.company_id, fixture.location_id, actorId, `qa-receipt-${token}`, hash(`receipt-${token}`), hash(`confirm-${token}`)]);
    await client.query(`insert into inventory_direct_receipt_approval_requests(id,company_id,location_id,catalog_part_id,submitted_by,idempotency_key,request_hash,original_command,receiver_evidence)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb,$9::jsonb)`, [fixture.approval, fixture.company_id, fixture.location_id, fixture.part, actorId, randomUUID(), hash(`approval-${token}`), JSON.stringify({ partNumber: fixture.partNumber }), JSON.stringify({ receiver: "QA" })]);
    await client.query("insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,$4,'Task queue bin','bin','storage',true,true,$5)", [fixture.position, fixture.company_id, fixture.location_id, `QA-Q-${token.slice(0, 6)}`, actorId]);
    await client.query("insert into inventory_position_count_sessions(id,company_id,location_id,position_id,status,created_by,idempotency_key,request_hash) values($1,$2,$3,$4,'needs_recount',$5,$6,$7)", [fixture.count, fixture.company_id, fixture.location_id, fixture.position, actorId, `qa-count-${token}`, hash(`count-${token}`)]);
    await client.query("insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode) values($1,$2,$3,0,$4,$5,$6,'Task queue removed part',1,'ea','serial')", [fixture.reuseReceiptLine, fixture.company_id, fixture.receipt, fixture.part, `local:${fixture.part}`, fixture.partNumber]);
    await client.query("insert into operational_workorders(id,company_id,serial,location_id) values($1,$2,$3,$4)", [fixture.originalWorkorder, fixture.company_id, `QA-WO-${token.slice(0, 8)}`, fixture.location_id]);
    await client.query("insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,custody_holder_type,custody_location_id) values($1,$2,$3,$4,$5,1,$6,'removed','handoff',$3)", [fixture.unit, fixture.company_id, fixture.location_id, fixture.receipt, fixture.reuseReceiptLine, `QA-SER-${token.slice(0, 8)}`]);
    await client.query(`insert into inventory_reuse_cases(id,company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,reason,ownership,ownership_evidence)
      values($1,$2,$3,$4,$5,$6,$7,$8,'installed_pending_approval','awaiting_handoff',$9,'Browser removal','unknown','')`, [fixture.reuse, fixture.company_id, fixture.location_id, fixture.unit, randomUUID(), randomUUID(), fixture.originalWorkorder, fixture.originalWorkorder, actorId]);
    await client.query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,'receive',$3) on conflict do nothing", [fixture.company_id, fixture.location_id, actorId]);
    await client.query("update inventory_stock_tasks set created_at=now()-interval '2 days' where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.damage, fixture.transfer]]);
    await client.query("update inventory_reuse_cases set created_at=now()-interval '2 days',updated_at=now()-interval '2 days' where company_id=$1 and id=$2", [fixture.company_id, fixture.reuse]);
    for (let index = 0; index < 26; index += 1) {
      const damageId = randomUUID(), transferId = randomUUID(), unitId = randomUUID();
      const caseId = `00000000-0000-4000-8000-${token.slice(0, 8)}${index.toString(16).padStart(4, "0")}`;
      fixture.fillerTaskIds.push(damageId, transferId); fixture.fillerUnitIds.push(unitId); fixture.fillerCaseIds.push(caseId);
      await client.query("insert into inventory_stock_tasks(id,company_id,location_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by,created_at) values($1,$2,$3,$4,'damage','inspection',1,'ea',$5,$6,now()+interval '2 days')", [damageId, fixture.company_id, fixture.location_id, fixture.part, `Off-page damage ${index}`, actorId]);
      await client.query("insert into inventory_stock_tasks(id,company_id,location_id,destination_id,catalog_part_id,kind,status,quantity,uom_code,reason,created_by,created_at) values($1,$2,$3,$4,$5,'transfer','in_transit',1,'ea',$6,$7,now()+interval '2 days')", [transferId, fixture.company_id, fixture.origin, fixture.location_id, fixture.part, `Off-page transfer ${index}`, actorId]);
      await client.query("insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,custody_holder_type,custody_location_id) values($1,$2,$3,$4,$5,$6,$7,'removed','handoff',$3)", [unitId, fixture.company_id, fixture.location_id, fixture.receipt, fixture.reuseReceiptLine, index + 2, `QA-OFFPAGE-${token.slice(0, 6)}-${index}`]);
      await client.query(`insert into inventory_reuse_cases(id,company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,reason,ownership,ownership_evidence,created_at,updated_at)
        values($1,$2,$3,$4,$5,$6,$7,$7,'installed_pending_approval','awaiting_handoff',$8,$9,'unknown','',now()+interval '2 days',now()+interval '2 days')`, [caseId, fixture.company_id, fixture.location_id, unitId, randomUUID(), randomUUID(), fixture.originalWorkorder, actorId, `Off-page custody ${index}`]);
    }
    await client.query("commit");
    return fixture;
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function cleanupFixture(pool, fixture) {
  if (!fixture?.company_id) return;
  const sources = [fixture.damage, fixture.transfer, fixture.delivery, fixture.receipt, fixture.invoiceDecision, fixture.approval, fixture.count, fixture.reuse, ...(fixture.fillerTaskIds || []), ...(fixture.fillerCaseIds || [])];
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("set local session_replication_role='replica'");
    for (const table of ["inventory_task_assignment_commands", "inventory_task_assignment_events", "inventory_task_assignments"]) await client.query(`delete from ${table} where company_id=$1 and source_id=any($2::uuid[])`, [fixture.company_id, sources]);
    await client.query("delete from inventory_reuse_capability_grants where company_id=$1 and location_id=$2 and user_id=$3", [fixture.company_id, fixture.location_id, fixture.actorId]);
    await client.query("delete from inventory_reuse_cases where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.reuse, ...(fixture.fillerCaseIds || [])]]);
    await client.query("delete from inventory_serialized_units where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.unit, ...(fixture.fillerUnitIds || [])]]);
    await client.query("delete from operational_workorders where company_id=$1 and id=$2", [fixture.company_id, fixture.originalWorkorder]);
    await client.query("delete from inventory_position_count_sessions where company_id=$1 and id=$2", [fixture.company_id, fixture.count]);
    await client.query("delete from inventory_positions where company_id=$1 and id=$2", [fixture.company_id, fixture.position]);
    await client.query("delete from inventory_direct_receipt_approval_events where company_id=$1 and request_id=$2", [fixture.company_id, fixture.approval]);
    await client.query("delete from inventory_direct_receipt_approval_requests where company_id=$1 and id=$2", [fixture.company_id, fixture.approval]);
    await client.query("delete from local_inventory_receipts where company_id=$1 and id=$2", [fixture.company_id, fixture.receipt]);
    await client.query("delete from inventory_receipt_lines where company_id=$1 and id=$2", [fixture.company_id, fixture.reuseReceiptLine]);
    await client.query("delete from inventory_receipts where company_id=$1 and id=$2", [fixture.company_id, fixture.receipt]);
    await client.query("delete from inventory_purchase_delivery_lines where company_id=$1 and delivery_id=$2", [fixture.company_id, fixture.delivery]);
    await client.query("delete from inventory_purchase_deliveries where company_id=$1 and id=$2", [fixture.company_id, fixture.delivery]);
    await client.query("delete from invoice_extraction_runs where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.invoiceDelivery, fixture.invoiceDecision]]);
    await client.query("delete from inventory_stock_tasks where company_id=$1 and id=any($2::uuid[])", [fixture.company_id, [fixture.damage, fixture.transfer, ...(fixture.fillerTaskIds || [])]]);
    await client.query("delete from parts_catalog where company_id=$1 and id=$2", [fixture.company_id, fixture.part]);
    await client.query("delete from locations where company_id=$1 and id=$2", [fixture.company_id, fixture.origin]);
    const residue = await client.query(`select
      (select count(*)::int from inventory_task_assignments where company_id=$1 and source_id=any($2::uuid[])) assignments,
      (select count(*)::int from inventory_stock_tasks where company_id=$1 and id=any($3::uuid[])) stock_tasks,
      (select count(*)::int from invoice_extraction_runs where company_id=$1 and id=any($4::uuid[])) invoice_runs`, [fixture.company_id, sources, [fixture.damage, fixture.transfer, ...(fixture.fillerTaskIds || [])], [fixture.invoiceDelivery, fixture.invoiceDecision]]);
    assert.deepEqual(residue.rows[0], { assignments: 0, stock_tasks: 0, invoice_runs: 0 });
    await client.query("commit");
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; } finally { client.release(); }
}

async function runViewport(browser, pool, api, config, fixture) {
  fixture.actorId = api.actor.id;
  const context = await browser.newContext({ storageState: await api.storageState(), viewport: fixture.viewport });
  const page = await context.newPage(); const pageErrors = []; const consoleErrors = []; const apiErrors = [];
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => { if (message.type() === "error") consoleErrors.push(message.text()); });
  page.on("response", async (response) => { if (response.url().includes("/api/office/inventory/task-queue") && !response.ok()) apiErrors.push({ status: response.status(), body: await response.text().catch(() => "") }); });
  try {
    const probe = await api.request(`/api/office/inventory/task-queue?view=my_work&locationId=${fixture.location_id}&page=1`);
    assert.equal(probe.status, 200);
    const tasks = probe.body.items.filter((item) => KINDS.includes(item.sourceType) && [fixture.damage, fixture.transfer, fixture.delivery, fixture.receipt, fixture.invoiceDecision, fixture.approval, fixture.count, fixture.reuse].includes(item.sourceId));
    assert.deepEqual(new Set(tasks.map((item) => item.sourceType)), new Set(KINDS));
    assert.ok(tasks.some((item) => item.blocker), "Fixture must include blocked work.");
    for (const [kind, target] of [["damage", fixture.damage], ["transfer", fixture.transfer]]) {
      const ownerPage = await api.request(`/api/office/inventory/stock-tasks?${new URLSearchParams({ locationId: fixture.location_id, kind, page: "1" })}`);
      assert.equal(ownerPage.status, 200);
      assert.equal(ownerPage.body.items.some((item) => item.id === target), false, `${kind} target must be beyond owner page 1.`);
      assert.equal(ownerPage.body.hasMore, true);
    }
    const custodyPage = await api.request(`/api/inventory-reuse/queue?${new URLSearchParams({ companyId: fixture.company_id, locationId: fixture.location_id, status: "awaiting_handoff", limit: "25" })}`);
    assert.equal(custodyPage.status, 200);
    assert.equal(custodyPage.body.items.some((item) => item.id === fixture.reuse), false, "Custody target must be beyond owner page 1.");
    assert.ok(custodyPage.body.nextCursor);

    const openQueue = async () => {
      await page.goto(new URL("/?view=inventory&adminView=inventory", config.baseUrl).href, { waitUntil: "domcontentloaded" });
      await page.getByRole("navigation", { name: "Other inventory sections" }).getByRole("button", { name: "Tasks", exact: true }).click();
      await page.locator('[aria-label="Inventory task queue"]').waitFor();
    };
    const openTask = async (task) => {
      const row = page.getByRole("row").filter({ hasText: task.statusLabel }).filter({ hasText: task.sourceLabel }).first();
      await row.locator("button.inventory-task-open").first().click();
      return page.getByRole("dialog");
    };

    try { await openQueue(); }
    catch (error) { throw new Error(`Inventory section navigation did not render. URL: ${page.url()}. Errors: ${JSON.stringify(pageErrors)}. Console: ${JSON.stringify(consoleErrors)}. Page: ${(await page.locator("body").innerText()).slice(0, 2500)}`, { cause: error }); }
    try { await page.locator('[aria-label="Inventory task queue"]').waitFor(); }
    catch (error) { throw new Error(`Task queue did not render. APIs: ${JSON.stringify(apiErrors)}. Page: ${(await page.locator("body").innerText()).slice(0, 2500)}`, { cause: error }); }
    for (const task of tasks) {
      const panel = await openTask(task);
      await panel.getByText(task.statusLabel, { exact: true }).waitFor();
      const open = panel.getByRole("link", { name: `Open · ${task.nextAction}`, exact: true });
      assert.equal(new URL(await open.getAttribute("href"), config.baseUrl).search, new URL(task.deepLink, config.baseUrl).search);
      await panel.getByRole("button", { name: "Close details", exact: true }).click();
    }

    const recount = tasks.find((item) => item.sourceType === "position_recount");
    await page.getByRole("row").filter({ hasText: recount.statusLabel }).filter({ hasText: recount.sourceLabel }).first().locator("button.inventory-task-open").first().click();
    await page.getByRole("dialog").getByRole("button", { name: "Claim task", exact: true }).click();
    await page.getByText("Task added to My work.", { exact: true }).waitFor();
    const claimedDetail = await api.request(`/api/office/inventory/task-queue/${recount.sourceType}/${recount.sourceId}?locationId=${recount.location.id}`);
    assert.equal(claimedDetail.status, 200);
    const assignedName = claimedDetail.body.item.assignedUser?.displayName;
    assert.ok(assignedName, "Claimed task must project the assigned user display name.");
    await page.reload({ waitUntil: "domcontentloaded" });
    await page.getByRole("dialog").getByText(assignedName, { exact: true }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Return to team", exact: true }).click();
    await page.getByText("Task returned to the available team.", { exact: true }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Close details", exact: true }).click();

    const stale = tasks.find((item) => item.sourceType === "damage_inspection");
    await page.getByRole("row").filter({ hasText: stale.statusLabel }).filter({ hasText: stale.sourceLabel }).first().locator("button.inventory-task-open").first().click();
    await pool.query("update inventory_stock_tasks set version=version+1 where company_id=$1 and id=$2", [fixture.company_id, fixture.damage]);
    await page.getByRole("dialog").getByRole("button", { name: "Claim task", exact: true }).click();
    await page.getByText("Task refreshed. Review the current owner and action.", { exact: true }).waitFor();
    await page.getByRole("dialog").getByRole("button", { name: "Close details", exact: true }).click();

    await page.getByLabel("Search inventory tasks").fill(`NO-MATCH-${fixture.token}`);
    try { await page.getByText("No inventory work needs you right now.", { exact: true }).waitFor({ timeout: 5_000 }); }
    catch (error) { throw new Error(`Filtered My work did not reach empty state. Page: ${(await page.locator("body").innerText()).slice(-1800)}`, { cause: error }); }
    await page.getByLabel("Search inventory tasks").fill("");
    await page.locator('[aria-label="Inventory task queue"]').waitFor();

    let failOnce = true;
    await page.route("**/api/office/inventory/task-queue?*", async (route) => { if (failOnce) { failOnce = false; await route.abort("failed"); } else await route.continue(); });
    await page.getByRole("button", { name: "Refresh", exact: true }).click();
    await page.getByRole("alert").waitFor();
    await page.unroute("**/api/office/inventory/task-queue?*");
    await page.getByRole("button", { name: "Retry", exact: true }).click();
    await page.locator('[aria-label="Inventory task queue"]').waitFor();

    const exactCases = [
      { kind: "damage_inspection", parameter: "taskId", expected: fixture.damage, evidence: fixture.partNumber },
      { kind: "position_recount", parameter: "positionId", expected: fixture.position, evidence: "Task queue bin" },
      { kind: "removed_part_custody", parameter: "reuseCaseId", expected: fixture.reuse, evidence: `QA-SER-${fixture.token.slice(0, 8)}` },
      { kind: "missing_invoice", parameter: "receiptId", expected: fixture.receipt, evidence: "Browser direct arrival" },
      { kind: "receipt_exception", parameter: "deliveryId", expected: fixture.delivery, evidence: fixture.delivery },
    ];
    for (const exactCase of exactCases) {
      await openQueue();
      const task = tasks.find((item) => item.sourceType === exactCase.kind);
      const panel = await openTask(task);
      await panel.getByRole("link", { name: `Open · ${task.nextAction}`, exact: true }).click();
      assert.equal(new URL(page.url()).searchParams.get(exactCase.parameter), exactCase.expected);
      await page.getByText(exactCase.evidence, { exact: false }).filter({ visible: true }).first().waitFor();
      await page.reload({ waitUntil: "domcontentloaded" });
      assert.equal(new URL(page.url()).searchParams.get(exactCase.parameter), exactCase.expected);
      await page.getByText(exactCase.evidence, { exact: false }).filter({ visible: true }).first().waitFor();
      if (exactCase.kind === "missing_invoice") {
        await page.keyboard.press("Escape");
        await page.getByRole("dialog").waitFor({ state: "hidden" });
        assert.equal(new URL(page.url()).searchParams.has("receiptId"), false);
        await page.waitForTimeout(250);
        assert.equal(await page.getByRole("dialog").count(), 0, "Consumed receipt source must stay closed after Escape.");
        await page.locator('[aria-label="Inbound work"]').waitFor();
      }
    }
    await openQueue();

    const directLinkCases = [
      { kind: "damage_inspection", owner: "damage", parameter: "taskId", expected: fixture.damage, evidence: "Browser damage" },
      { kind: "transfer_receipt", owner: "transfer", parameter: "taskId", expected: fixture.transfer, evidence: "Browser transfer" },
      { kind: "removed_part_custody", owner: "custody", parameter: "reuseCaseId", expected: fixture.reuse, evidence: `QA-SER-${fixture.token.slice(0, 8)}` },
      { kind: "position_recount", owner: "recount", parameter: "positionId", expected: fixture.position, evidence: "Task queue bin" },
    ];
    const copiedServerLinks = new Map();
    for (const directCase of directLinkCases) {
      await openQueue();
      const task = tasks.find((item) => item.sourceType === directCase.kind);
      const panel = await openTask(task);
      const anchor = panel.getByRole("link", { name: `Open · ${task.nextAction}`, exact: true });
      const href = await anchor.getAttribute("href");
      assert.ok(href, `${directCase.kind} must expose a server-provided link.`);
      copiedServerLinks.set(directCase.kind, href);
      const directUrl = new URL(href, config.baseUrl);
      assert.equal(directUrl.searchParams.get("taskOwner"), directCase.owner);
      assert.equal(directUrl.searchParams.get(directCase.parameter), directCase.expected);
      assert.equal(directUrl.searchParams.get("taskLocation"), fixture.location_id);
      const directPage = await context.newPage();
      const directErrors = [];
      const exactReadPath = ["damage_inspection", "transfer_receipt"].includes(directCase.kind)
        ? `/api/office/inventory/stock-tasks/${directCase.expected}`
        : directCase.kind === "removed_part_custody" ? `/api/inventory-reuse/cases/${directCase.expected}` : "";
      let exactReadCount = 0;
      directPage.on("pageerror", (error) => directErrors.push(error.message));
      directPage.on("response", (response) => { if (exactReadPath && new URL(response.url()).pathname === exactReadPath) exactReadCount += 1; });
      try {
        await directPage.goto(directUrl.href, { waitUntil: "domcontentloaded" });
        await directPage.getByText(directCase.evidence, { exact: false }).filter({ visible: true }).first().waitFor();
        if (exactReadPath) assert.equal(exactReadCount, 1, `${directCase.kind} must make one exact owner read per mount.`);
        await directPage.reload({ waitUntil: "domcontentloaded" });
        await directPage.getByText(directCase.evidence, { exact: false }).filter({ visible: true }).first().waitFor();
        if (exactReadPath) assert.equal(exactReadCount, 2, `${directCase.kind} must make one exact owner read after reload.`);
        assert.equal(await directPage.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `${directCase.kind} direct link overflow at ${fixture.viewport.width}px`);
        assert.deepEqual(directErrors, []);
      } finally { await directPage.close(); }
      await panel.getByRole("button", { name: "Close details", exact: true }).click();
    }
    for (const missingCase of [
      { kind: "damage_inspection", parameter: "taskId", listEvidence: fixture.partNumber },
      { kind: "removed_part_custody", parameter: "reuseCaseId", listEvidence: `QA-OFFPAGE-${fixture.token.slice(0, 6)}-0` },
    ]) {
      const missingUrl = new URL(copiedServerLinks.get(missingCase.kind), config.baseUrl);
      missingUrl.searchParams.set(missingCase.parameter, randomUUID());
      const missingPage = await context.newPage();
      try {
        await missingPage.goto(missingUrl.href, { waitUntil: "domcontentloaded" });
        await missingPage.getByRole("alert").waitFor();
        try { await missingPage.getByText(missingCase.listEvidence, { exact: false }).filter({ visible: true }).first().waitFor(); }
        catch (error) { throw new Error(`${missingCase.kind} missing-source fallback did not keep its generic list usable. Page: ${(await missingPage.locator("body").innerText()).slice(-2500)}`, { cause: error }); }
        await missingPage.reload({ waitUntil: "domcontentloaded" });
        await missingPage.getByRole("alert").waitFor();
        await missingPage.getByText(missingCase.listEvidence, { exact: false }).filter({ visible: true }).first().waitFor();
      } finally { await missingPage.close(); }
    }

    assert.equal(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1), true, `Horizontal overflow at ${fixture.viewport.width}px`);
    if (fixture.viewport.width <= 480) for (const element of await page.locator(".inventory-task-queue button, .inventory-task-queue a.inventory-task-primary").all()) {
      const box = await element.boundingBox();
      if (box) assert.ok(box.height >= 44, `Short task action at ${fixture.viewport.width}px`);
    }
    assert.deepEqual(pageErrors, []);
    assert.equal(apiErrors.filter((entry) => entry.status !== 409).length, 0, JSON.stringify(apiErrors));
    return { viewport: `${fixture.viewport.width}x${fixture.viewport.height}`, kinds: tasks.length, blocked: true, assignmentReload: true, staleRecovery: true, emptyErrorRetry: true, exactSourceReload: true, exactSourceClose: true, directServerLinkReload: true };
  } finally { await context.close(); }
}

async function main() {
  const config = settings(); const pool = getPool(); const fixtures = []; const failures = []; let browser; let api; let companyId = ""; let policySnapshot;
  try {
    await runQaAccountCommand({ argv: ["apply", "--target=local", `--namespace=${config.namespace}`], environment: process.env });
    const account = buildQaAccountManifest(config.namespace).find((entry) => entry.role === "admin");
    api = await RoleApiClient.create({ role: "admin", baseUrl: config.baseUrl, timeoutMs: 20_000 });
    await api.authenticate({ ...account, password: config.password });
    companyId = (await pool.query("select id from companies where slug=$1", [config.companySlug])).rows[0]?.id || "";
    assert.ok(companyId, "QA company was not found.");
    policySnapshot = (await pool.query("select * from inventory_purchase_approval_settings where company_id=$1", [companyId])).rows[0] || null;
    await pool.query(`insert into inventory_purchase_approval_settings(company_id,approval_limit,currency,approver_user_ids,approver_roles,updated_by)
      values($1,0,'USD',$2,array['admin']::text[],$3)
      on conflict(company_id) do update set approval_limit=0,currency='USD',approver_user_ids=$2,approver_roles=array['admin']::text[],updated_by=$3,version=inventory_purchase_approval_settings.version+1,updated_at=now()`, [companyId, [api.actor.id], api.actor.id]);
    browser = await chromium.launch({ channel: process.env.QA_BROWSER_CHANNEL || "chrome", headless: true });
    const results = [];
    for (const viewport of VIEWPORTS) {
      const fixture = await createFixture(pool, config, api.actor.id, viewport); fixture.actorId = api.actor.id; fixtures.push(fixture);
      results.push(await runViewport(browser, pool, api, config, fixture));
      await cleanupFixture(pool, fixture); fixtures.splice(fixtures.indexOf(fixture), 1);
    }
    console.log(JSON.stringify({ passed: true, results, cleanup: "complete" }));
  } catch (error) { failures.push(error); }
  finally {
    for (const fixture of [...fixtures].reverse()) try { await cleanupFixture(pool, fixture); } catch (error) { failures.push(error); }
    try { await browser?.close(); } catch (error) { failures.push(error); }
    try { await api?.dispose(); } catch (error) { failures.push(error); }
    try {
      if (companyId) {
        if (policySnapshot) await pool.query(`update inventory_purchase_approval_settings set approval_limit=$2,currency=$3,approver_user_ids=$4,approver_roles=$5,version=$6,updated_by=$7,updated_at=$8 where company_id=$1`, [companyId, policySnapshot.approval_limit, policySnapshot.currency, policySnapshot.approver_user_ids, policySnapshot.approver_roles, policySnapshot.version, policySnapshot.updated_by, policySnapshot.updated_at]);
        else await pool.query("delete from inventory_purchase_approval_settings where company_id=$1", [companyId]);
      }
    } catch (error) { failures.push(error); }
    try { await runQaAccountCommand({ argv: ["cleanup", "--target=local", `--namespace=${config.namespace}`], environment: process.env }); } catch (error) { failures.push(error); }
    await closePool().catch((error) => failures.push(error));
  }
  if (failures.length) { for (const failure of failures) console.error(redactQaError(failure), failure?.stack || ""); process.exitCode = 1; }
}

await main();
