import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import { after, test } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { placeSerializedInventoryReceipt } from "../../db/repositories/inventory-positions.repo.js";
import { mutateInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import {
  consumePendingSerializedInstallationsForApproval,
  finalizeSerializedUnitUsage,
  issueSerializedUnitToWorkorder,
} from "../../db/repositories/inventory-unit-workorder-usage.repo.js";

const run = process.env.RUN_POSTGRES_INTEGRATION === "1";
const digest = (value) => createHash("sha256").update(value).digest("hex");

after(async () => { if (run) await closePool(); });

test("exact units retain shelf reservations, leave once when fitted, and return to the inspected storage position", { skip: !run }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const ids = {
    company: randomUUID(), location: randomUUID(), asset: randomUUID(), workorder: randomUUID(),
    catalogPart: randomUUID(), storagePosition:randomUUID(), run: randomUUID(), receipt: randomUUID(), line: randomUUID(),
    admin: randomUUID(), remover: randomUUID(), receiver: randomUUID(),
  };
  const units = Array.from({ length: 10 }, () => randomUUID());
  const serials = units.map((_, index) => `POSITION-${suffix}-${index + 1}`);
  const base = { companyId: ids.company, locationId: ids.location };
  const usageScope = { ...base, workorderId: ids.workorder, actorId: ids.remover, actorRole: "office" };
  const command = (action, actorId, extra = {}) => ({
    ...base, action, capability: action === "return" ? "receive" : action, actorId,
    idempotencyKey: randomUUID(), requestHash: digest(randomUUID()), ...extra,
  });
  const stock = async () => (await query(
    "select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3",
    [ids.company, ids.location, ids.catalogPart],
  )).rows[0];
  const positioned = async () => (await query(
    "select count(*)::int as count from inventory_serialized_units where company_id=$1 and current_position_id is not null",
    [ids.company],
  )).rows[0].count;
  const movementCount = async () => (await query(
    "select count(*)::int as count from inventory_position_movements where company_id=$1",
    [ids.company],
  )).rows[0].count;

  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Exact position lifecycle QA')", [ids.company, `exact-position-${suffix}`]);
    await query("insert into locations(id,company_id,name) values($1,$2,'Exact position shop')", [ids.location, ids.company]);
    for (const [id, role, name] of [[ids.admin,"admin","Admin"],[ids.remover,"office","Remover"],[ids.receiver,"office","Receiver"]]) {
      await query("insert into user_profiles(id,display_name) values($1,$2)", [id, `${name} ${suffix.slice(0, 8)}`]);
      await query("insert into user_company_memberships(user_id,company_id,role,active) values($1,$2,$3,true)", [id, ids.company, role]);
      await query("insert into user_location_memberships(user_id,company_id,location_id,active) values($1,$2,$3,true)", [id, ids.company, ids.location]);
    }
    await query("insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,'remove',$5),($1,$2,$4,'receive',$5),($1,$2,$4,'release',$5)", [ids.company,ids.location,ids.remover,ids.receiver,ids.admin]);
    await query(`insert into inventory_positions(id,company_id,location_id,code,name,kind,usage,can_store,is_pickable,created_by)
      values($1,$2,$3,$4,'Reuse release shelf','shelf','storage',true,true,$5)`,[ids.storagePosition,ids.company,ids.location,`REL-${suffix.slice(0,8)}`,ids.admin]);
    await query("insert into assets(id,company_id,location_id,provider,name,unit_no) values($1,$2,$3,'manual','Exact-position truck',$4)", [ids.asset,ids.company,ids.location,`EP-${suffix.slice(0,8)}`]);
    await query("insert into operational_workorders(id,company_id,serial,asset_id,location_id,created_by_user_id,concern,status) values($1,$2,$3,$4,$5,$6,'Exact position lifecycle','in_progress')", [ids.workorder,ids.company,`WO-EP-${suffix}`,ids.asset,ids.location,ids.admin]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code,tracking_mode) values($1,$2,$3,$4,'Exact-position filter','ea','serialized')", [ids.catalogPart,ids.company,`EP${suffix}`,`EP-${suffix}`]);
    await query("insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,evidence,updated_by_user_id) values($1,$2,$3,true,'Exact position integration policy',$4)", [ids.company,ids.location,ids.catalogPart,ids.admin]);
    await query(`insert into invoice_extraction_runs(id,company_id,location_id,created_by,reviewed_by,document_hash,file_name,mime_type,byte_size,idempotency_key,status,provider,model,prompt_version,reviewed_draft,reviewed_at)
      values($1,$2,$3,$4,$4,$5,'exact-position.pdf','application/pdf',1,$6,'reviewed','local-test','local-test','local-v1',$7::jsonb,now())`, [ids.run,ids.company,ids.location,ids.admin,digest(suffix),`extract-${suffix}`,JSON.stringify({documentType:{value:"invoice"},lines:[]})]);
    await query("insert into inventory_receipts(id,company_id,location_id,invoice_run_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at) values($1,$2,$3,$4,$5,$6,'local',$7,'Exact position receipt','confirmed',now())", [ids.receipt,ids.company,ids.location,ids.run,ids.admin,`receipt-${suffix}`,`LOCAL-${suffix}`]);
    await query("insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode) values($1,$2,$3,0,$4,$5,$6,'Exact-position filter',10,'ea','serial')", [ids.line,ids.company,ids.receipt,ids.catalogPart,`local:${ids.catalogPart}`,`EP-${suffix}`]);
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id)
      select input.id,$1,$2,$3,$4,input.ordinal,input.serial,'in_stock','new','inventory_location',$2
      from unnest($5::uuid[],$6::int[],$7::text[]) as input(id,ordinal,serial)`, [ids.company,ids.location,ids.receipt,ids.line,units,units.map((_,index)=>index+1),serials]);
    await query("insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id) values($1,$2,$3,$4,$5,'Exact-position filter',10,0,'ea','local',$6)", [ids.company,ids.location,ids.catalogPart,`EP${suffix}`,`EP-${suffix}`,`local:${suffix}`]);

    assert.equal((await issueSerializedUnitToWorkorder({
      ...usageScope, unitId:units[2], idempotencyKey:`reserve-without-position-${suffix}`,
      requestHash:digest(`reserve-without-position-${suffix}`),
    })).kind, "unit_state");
    assert.deepEqual(await stock(), { quantity_on_hand:"10.000", quantity_reserved:"0.000" });

    const setupClient = await getPool().connect();
    try {
      await setupClient.query("begin");
      await placeSerializedInventoryReceipt(setupClient, {
        companyId:ids.company, locationId:ids.location, catalogPartId:ids.catalogPart, uomCode:"ea",
        unitIds:units, actorId:ids.admin, idempotencyKey:`receipt-position-${suffix}`, receiptId:ids.receipt,
      });
      await setupClient.query("commit");
    } catch (error) {
      await setupClient.query("rollback");
      throw error;
    } finally { setupClient.release(); }
    const originalPosition = (await query("select current_position_id from inventory_serialized_units where id=$1", [units[1]])).rows[0].current_position_id;

    const reserved = [];
    for (let index = 0; index < 2; index += 1) {
      const result = await issueSerializedUnitToWorkorder({ ...usageScope, unitId:units[index], idempotencyKey:`reserve-${index}-${suffix}`, requestHash:digest(`reserve-${index}-${suffix}`) });
      assert.equal(result.kind, "reserved");
      reserved.push(result.usage);
    }
    assert.deepEqual(await stock(), { quantity_on_hand:"10.000", quantity_reserved:"2.000" });
    assert.equal(await positioned(), 10);
    assert.equal(await movementCount(), 10);

    assert.equal((await finalizeSerializedUnitUsage({ ...usageScope, usageId:reserved[0].id, disposition:"installed", idempotencyKey:`fit-${suffix}`, requestHash:digest(`fit-${suffix}`) })).kind, "finalized");
    assert.deepEqual(await stock(), { quantity_on_hand:"10.000", quantity_reserved:"2.000" });
    assert.equal(await positioned(), 9);
    assert.equal(await movementCount(), 11);
    const pick = (await query(`select operation.id,operation.actor_id,operation.workorder_id,operation.command_type,movement.unit_id,movement.from_position_id,movement.to_position_id
      from inventory_position_operations operation join inventory_position_movements movement on movement.operation_id=operation.id
      where operation.company_id=$1 and operation.command_type='workorder_pick'`, [ids.company])).rows[0];
    assert.deepEqual(pick, { id:pick.id, actor_id:ids.remover, workorder_id:ids.workorder, command_type:"workorder_pick", unit_id:units[0], from_position_id:originalPosition, to_position_id:null });
    const fitEvent = (await query("select details from inventory_unit_events where company_id=$1 and unit_id=$2 and event_type='installed_pending_approval'", [ids.company,units[0]])).rows[0];
    assert.equal(fitEvent.details.source, "workorder_parts_scan");
    assert.equal(fitEvent.details.positionOperationId, pick.id);

    const approvalClient = await getPool().connect();
    try {
      await approvalClient.query("begin");
      assert.equal(await consumePendingSerializedInstallationsForApproval(approvalClient, { workorderId:ids.workorder, companyId:ids.company, officeUserId:ids.admin }), 1);
      await approvalClient.query("commit");
    } catch (error) {
      await approvalClient.query("rollback");
      throw error;
    } finally { approvalClient.release(); }
    assert.deepEqual(await stock(), { quantity_on_hand:"9.000", quantity_reserved:"1.000" });
    assert.equal(await positioned(), 9);
    assert.equal(await movementCount(), 11);

    assert.equal((await finalizeSerializedUnitUsage({ ...usageScope, usageId:reserved[1].id, disposition:"returned", idempotencyKey:`unused-return-${suffix}`, requestHash:digest(`unused-return-${suffix}`) })).kind, "finalized");
    assert.deepEqual(await stock(), { quantity_on_hand:"9.000", quantity_reserved:"0.000" });
    assert.equal((await query("select current_position_id from inventory_serialized_units where id=$1", [units[1]])).rows[0].current_position_id, originalPosition);
    assert.equal(await movementCount(), 11);

    const removed = (await mutateInventoryReuse(command("remove", ids.remover, { usageId:reserved[0].id, reason:"Remove fitted exact unit" }))).case;
    assert.equal(removed.status, "awaiting_handoff");
    assert.equal(await positioned(), 9);
    assert.equal(await movementCount(), 11);
    const returnInput = command("return", ids.receiver, {
      caseId:removed.id, exactUnitId:units[0], outcome:"reuse", evidence:"Exact serial received", expectedVersion:removed.caseVersion,
    });
    const returned = await mutateInventoryReuse(returnInput);
    assert.equal(returned.case.status, "received_pending_review");
    assert.equal(returned.ledgerEffect, 0);
    assert.deepEqual(await stock(), { quantity_on_hand:"9.000", quantity_reserved:"0.000" });
    assert.equal(await positioned(), 9);
    const releaseInput=command("release",ids.receiver,{
      caseId:removed.id,decision:"release",inspectionEvidence:"Bench test passed",reason:"Approved reusable unit",
      targetPositionId:ids.storagePosition,expectedVersion:returned.case.caseVersion,
    });
    const released=await mutateInventoryReuse(releaseInput);
    assert.equal(released.case.status,"released");
    assert.equal(released.ledgerEffect,1);
    assert.deepEqual(await stock(), { quantity_on_hand:"10.000", quantity_reserved:"0.000" });
    assert.equal(await positioned(), 10);
    assert.equal(await movementCount(), 12);
    assert.equal((await mutateInventoryReuse(returnInput)).replayed, true);
    assert.equal((await mutateInventoryReuse(releaseInput)).replayed,true);
    assert.equal(await movementCount(), 12);
    const reuseMove = (await query(`select operation.id,operation.actor_id,operation.workorder_id,operation.command_type,position.id position_id,position.system_key,movement.unit_id,movement.from_position_id
      from inventory_position_operations operation join inventory_position_movements movement on movement.operation_id=operation.id
      join inventory_positions position on position.id=movement.to_position_id
      where operation.company_id=$1 and operation.command_type='reuse_release'`, [ids.company])).rows[0];
    assert.deepEqual(reuseMove, { id:reuseMove.id, actor_id:ids.receiver, workorder_id:ids.workorder, command_type:"reuse_release", position_id:ids.storagePosition, system_key:null, unit_id:units[0], from_position_id:null });
    const reuseEvents = (await query("select event_type,details from inventory_unit_events where company_id=$1 and unit_id=$2 and event_type in ('reuse_received','reuse_released') order by id", [ids.company,units[0]])).rows;
    assert.equal(reuseEvents.length, 2);
    const byType=Object.fromEntries(reuseEvents.map((event)=>[event.event_type,event.details]));
    assert.equal(byType.reuse_received.source,"reuse_return_compatibility");
    assert.equal(byType.reuse_released.source,"reuse_lifecycle");
    assert.equal(byType.reuse_released.positionOperationId,reuseMove.id);
  } finally {
    for (const table of ["inventory_reuse_operations","inventory_reuse_audit_events","inventory_reuse_cases","inventory_reuse_capability_grants","inventory_reuse_catalog_policies","inventory_unit_events","inventory_stock_movements","inventory_position_movements","inventory_position_operations","workorder_serialized_part_usage_commands","workorder_serialized_part_usages","inventory_serialized_units","inventory_receipt_lines","inventory_receipts","inventory_items","parts_catalog"]) {
      await query(`delete from ${table} where company_id=$1`, [ids.company]).catch(() => {});
    }
    await query("delete from inventory_positions where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from operational_workorders where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from workorder_serial_counters where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from assets where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from invoice_extraction_runs where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from user_location_memberships where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from user_company_memberships where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from user_profiles where id=any($1::uuid[])", [[ids.admin,ids.remover,ids.receiver]]).catch(() => {});
    await query("delete from locations where company_id=$1", [ids.company]).catch(() => {});
    await query("delete from companies where id=$1", [ids.company]).catch(() => {});
  }
});
