import assert from "node:assert/strict";
import { randomUUID, createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import { after, test } from "node:test";
import { closePool, getPool, query } from "../../db/pool.js";
import { configureInventoryReuse, mutateInventoryReuse, readInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import { issueSerializedUnitToWorkorder, finalizeSerializedUnitUsage, consumePendingSerializedInstallationsForApproval } from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import { createInventoryReuseFixture } from "./inventory-reuse.fixture.js";

const run = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (run) await closePool(); });
const digest = (value) => createHash("sha256").update(value).digest("hex");

test("PostgreSQL removal derives an existing active workorder without creating another", { skip: !run }, async () => {
  const f = await createInventoryReuseFixture();
  try {
    const before = (await query("select count(*)::int n from operational_workorders where company_id=$1", [f.companyId])).rows[0].n;
    const version = (await query("select custody_version from inventory_serialized_units where company_id=$1 and id=$2", [f.companyId, f.unitId])).rows[0].custody_version;
    const input = { companyId:f.companyId, locationId:f.locationId, action:"remove", capability:"remove", actorId:f.removerId, usageId:f.usageId, expectedVersion:version, reason:"failed", ownership:"company", ownershipEvidence:"purchase", idempotencyKey:randomUUID(), requestHash:digest(randomUUID()) };
    const result = await mutateInventoryReuse(input);
    assert.equal(result.case.removalWorkorderId, f.removalWorkorderId);
    assert.equal((await mutateInventoryReuse(input)).replayed, true);
    assert.equal((await query("select count(*)::int n from operational_workorders where company_id=$1", [f.companyId])).rows[0].n, before);
  } finally { await f.cleanup(); }
});

test("PostgreSQL repair route retains identity and releases refurbished stock once", { skip: !run }, async () => {
  const f = await createInventoryReuseFixture(); const base={companyId:f.companyId,locationId:f.locationId};
  const command=(action,actorId,extra={})=>({...base,action,capability:({repair_start:"repair",repair_complete:"repair",core_return:"disposition",scrap:"disposition",quarantine_resolve:"quarantine"})[action] || action,actorId,idempotencyKey:randomUUID(),requestHash:digest(randomUUID()),...extra});
  try {
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.receiverId,capabilities:["receive","route","repair"],reason:"repair QA"});
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.releaseId,capabilities:["release"],reason:"repair QA"});
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"policy",catalogPartId:f.catalogPartId,reuseAllowed:true,repairAllowed:true,coreReturnAllowed:true,scrapAllowed:true,evidence:"repair QA"});
    const removed=(await mutateInventoryReuse(command("remove",f.removerId,{usageId:f.usageId,removalWorkorderId:f.removalWorkorderId,reason:"failed",ownership:"company",ownershipEvidence:"purchase"}))).case;
    const received=(await mutateInventoryReuse(command("receive",f.receiverId,{caseId:removed.id,evidence:"matched",actualHolderType:"inventory_location"}))).case;
    const routed=(await mutateInventoryReuse(command("route",f.receiverId,{caseId:removed.id,route:"repair",evidence:"bench failed",expectedVersion:received.caseVersion}))).case;
    assert.equal(routed.status,"repair");
    await mutateInventoryReuse(command("repair_start",f.receiverId,{caseId:removed.id,handlerType:"external",handlerReference:"Rebuilder",evidence:"sent",expectedVersion:routed.caseVersion}));
    const complete=(await mutateInventoryReuse(command("repair_complete",f.receiverId,{caseId:removed.id,evidence:"rebuilt",receiptEvidence:"physically returned",exactUnitId:f.unitId,release:false,inspectionEvidence:"",binLocation:"A-1",expectedVersion:routed.caseVersion+1}))).case;
    const rerouted=(await mutateInventoryReuse(command("route",f.receiverId,{caseId:removed.id,route:"repair",evidence:"second defect",expectedVersion:complete.caseVersion}))).case;
    const secondStart=command("repair_start",f.receiverId,{caseId:removed.id,handlerType:"internal",handlerReference:"shop",evidence:"second start",expectedVersion:rerouted.caseVersion});
    assert.equal((await mutateInventoryReuse(secondStart)).replayed,false);
    assert.equal((await mutateInventoryReuse(secondStart)).replayed,true);
    await assert.rejects(mutateInventoryReuse(command("repair_start",f.receiverId,{caseId:removed.id,handlerType:"internal",handlerReference:"shop",evidence:"duplicate",expectedVersion:rerouted.caseVersion+1})),{code:"INVENTORY_REUSE_CHANGED"});
    const secondComplete=(await mutateInventoryReuse(command("repair_complete",f.receiverId,{caseId:removed.id,evidence:"rebuilt twice",receiptEvidence:"returned again",exactUnitId:f.unitId,release:false,inspectionEvidence:"",binLocation:"A-1",expectedVersion:rerouted.caseVersion+1}))).case;
    assert.equal((await query("select count(*)::int n from inventory_reuse_repairs where company_id=$1 and case_id=$2",[f.companyId,removed.id])).rows[0].n,2);
    const released=(await mutateInventoryReuse(command("release",f.releaseId,{caseId:removed.id,decision:"release",inspectionEvidence:"bench pass",reason:"approved",binLocation:"A-1",expectedVersion:secondComplete.caseVersion}))).case;
    assert.equal(released.status,"released");
    const unit=(await query("select status,condition_code,custody_holder_type from inventory_serialized_units where id=$1",[f.unitId])).rows[0];
    assert.deepEqual(unit,{status:"in_stock",condition_code:"refurbished",custody_holder_type:"inventory_location"});
    const reissued=await issueSerializedUnitToWorkorder({...base,workorderId:f.secondWorkorderId,unitId:f.unitId,actorId:f.removerId,actorRole:"office",idempotencyKey:randomUUID(),requestHash:digest("reissue")});
    assert.equal(reissued.kind,"reserved");
  } finally { await f.cleanup(); }
});

test("PostgreSQL correction is versioned, replay-safe, scoped, and mechanic stock reads are denied", { skip: !run }, async () => {
  const f=await createInventoryReuseFixture({installed:false}); const base={companyId:f.companyId,locationId:f.locationId};
  try {
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.adminId,capabilities:["route"],reason:"correction QA"});
    const input={...base,action:"correct_location",capability:"route",actorId:f.adminId,unitId:f.unitId,custodyVersion:1,holderType:"inventory_location",binLocation:"A-2",externalReference:"",evidence:"counted",idempotencyKey:"correct-qa-key",requestHash:digest("correct")};
    const first=await mutateInventoryReuse(input); assert.equal(first.unitProjection.custodyBinLocation,"A-2");
    assert.equal((await mutateInventoryReuse(input)).replayed,true);
    await assert.rejects(mutateInventoryReuse({...input,idempotencyKey:"stale-qa-key",requestHash:digest("stale")}),{code:"INVENTORY_REUSE_CHANGED"});
    await query("update user_company_memberships set role='mechanic' where company_id=$1 and user_id=$2",[f.companyId,f.removerId]);
    await assert.rejects(readInventoryReuse({...base,actorId:f.removerId,view:"stock",limit:2,q:""}),{code:"INVENTORY_REUSE_FORBIDDEN"});
  } finally { await f.cleanup(); }
});

test("PostgreSQL receive requires the locked exact unit and scan accepts only scoped exact serials", { skip: !run }, async () => {
  const f=await createInventoryReuseFixture(); const base={companyId:f.companyId,locationId:f.locationId}; const c=(action,actorId,extra={})=>({...base,action,capability:action,actorId,idempotencyKey:randomUUID(),requestHash:digest(randomUUID()),...extra});
  try {
    const removed=(await mutateInventoryReuse(c("remove",f.removerId,{usageId:f.usageId,removalWorkorderId:f.removalWorkorderId,reason:"failed",ownership:"company",ownershipEvidence:"purchase"}))).case;
    await assert.rejects(mutateInventoryReuse(c("receive",f.receiverId,{caseId:removed.id,evidence:"seen",exactUnitId:f.pendingUnitId})),{code:"INVENTORY_REUSE_EXACT_UNIT_MISMATCH"});
    const exact=(await query("select serial_number from inventory_serialized_units where id=$1",[f.unitId])).rows[0].serial_number;
    const scan=await readInventoryReuse({...base,actorId:f.receiverId,view:"scan",code:exact,limit:2,q:""});
    assert.equal(scan.unit.id,f.unitId);
    await assert.rejects(readInventoryReuse({...base,actorId:f.receiverId,view:"scan",code:exact.slice(0,-1),limit:2,q:""}),{code:"INVENTORY_REUSE_NOT_FOUND"});
  } finally { await f.cleanup(); }
});

test("migration120 deterministically backfills custody without changing balances or events", { skip: !run }, async () => {
  const f=await createInventoryReuseFixture();
  try {
    const extra=Array.from({length:5},()=>randomUUID());
    await query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id,custody_legacy_available)
      select id,$1,$2,$3,$4,ordinal,'M120SER-'||ordinal,status,'unknown','inventory_location',$2,false
      from unnest($5::uuid[],$6::int[],$7::text[]) as x(id,ordinal,status)`,[f.companyId,f.locationId,f.receiptId,f.lineId,extra,[3,4,5,6,7],["reserved","in_stock","removed","removed","removed"]]);
    const [reserved,stock,removed,handoff,hold]=extra;
    const usage=async(unitId)=>{const id=randomUUID(),key=`m120-${id}`;await query(`insert into workorder_serialized_part_usages(id,company_id,workorder_id,asset_id,location_id,unit_id,catalog_part_id,uom_code,repair_order,status,issued_by_user_id,issue_idempotency_key,issue_request_hash,finalized_by_user_id,finalized_at,finalize_idempotency_key,finalize_request_hash) values($1,$2,$3,$4,$5,$6,$7,'ea','','removed',$8,$9,$10,$8,now(),$9,$10)`,[id,f.companyId,f.workorderId,f.assetId,f.locationId,unitId,f.catalogPartId,f.adminId,key,digest(key)]);return id};
    for (const [unitId,status] of [[handoff,"awaiting_handoff"],[hold,"hold"]]) { const usageId=await usage(unitId); await query(`insert into inventory_reuse_cases(company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,received_by_user_id,reason,ownership,ownership_evidence,receipt_evidence) values($1,$2,$3,$4,$5,$6,$7,'installed_pending_approval',$8,$9,$10,'seed','unknown','',case when $8='awaiting_handoff' then null else 'received' end)`,[f.companyId,f.locationId,unitId,usageId,f.assetId,f.workorderId,f.removalWorkorderId,status,f.removerId,status==='hold'?f.receiverId:null]); }
    const before=await query(`select (select count(*) from inventory_stock_movements where company_id=$1)::int moves,(select count(*) from inventory_unit_events where company_id=$1)::int events,(select quantity_on_hand from inventory_items where company_id=$1 limit 1) qty`,[f.companyId]);
    const client=await getPool().connect();try{await client.query("begin");await client.query(await readFile(new URL("../../db/migrations/120_inventory_custody_backfill_correction.sql",import.meta.url),"utf8"));const rows=(await client.query(`select id,status,custody_holder_type,custody_asset_id,custody_location_id,custody_legacy_available from inventory_serialized_units where id=any($1::uuid[])`,[[f.unitId,f.pendingUnitId,reserved,stock,removed,handoff,hold]])).rows;const by=Object.fromEntries(rows.map(r=>[r.id,r]));assert.equal(by[f.unitId].custody_holder_type,"asset");assert.equal(by[f.unitId].custody_asset_id,f.assetId);assert.equal(by[reserved].custody_holder_type,"inventory_location");assert.equal(by[reserved].custody_legacy_available,true);assert.equal(by[stock].custody_holder_type,"inventory_location");assert.equal(by[handoff].custody_holder_type,"handoff");assert.equal(by[hold].custody_holder_type,"unknown");assert.equal(by[removed].custody_holder_type,"unknown");const after=(await client.query(`select (select count(*) from inventory_stock_movements where company_id=$1)::int moves,(select count(*) from inventory_unit_events where company_id=$1)::int events,(select quantity_on_hand from inventory_items where company_id=$1 limit 1) qty`,[f.companyId])).rows[0];assert.deepEqual(after,before.rows[0]);await client.query("rollback")}finally{client.release()}
  } finally { await f.cleanup(); }
});
