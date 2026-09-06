import assert from "node:assert/strict";
import { test, after } from "node:test";
import { randomUUID } from "node:crypto";
import { createInventoryReuseFixture, reuseDigest } from "./inventory-reuse.fixture.js";
import { closePool, getPool, query } from "../../db/pool.js";
import { mutateInventoryReuse, readInventoryReuse, configureInventoryReuse } from "../../db/repositories/inventory-reuse.repo.js";
import { issueSerializedUnitToWorkorder, finalizeSerializedUnitUsage, consumePendingSerializedInstallationsForApproval } from "../../db/repositories/inventory-unit-workorder-usage.repo.js";
import { listUnitsDirectory } from "../../db/repositories/units-directory.repo.js";
const run = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async()=>{if(run) await closePool();});

test("PostgreSQL exact-unit state filters distinguish reusable availability from stored stock",{skip:!run},async()=>{
  const f=await createInventoryReuseFixture({installed:false});
  const base={companyId:f.companyId,locationId:f.locationId,actorId:f.adminId,view:"units",catalogPartId:f.catalogPartId,limit:25};
  try {
    await query("update inventory_serialized_units set condition_code='needs_repair' where company_id=$1 and id=$2",[f.companyId,f.pendingUnitId]);
    const available=await readInventoryReuse({...base,unitState:"available"});
    const inStock=await readInventoryReuse({...base,unitState:"in_stock"});
    assert.ok(available.items.some((unit)=>unit.id===f.unitId));
    assert.ok(!available.items.some((unit)=>unit.id===f.pendingUnitId));
    assert.ok(inStock.items.some((unit)=>unit.id===f.unitId));
    assert.ok(inStock.items.some((unit)=>unit.id===f.pendingUnitId));
    assert.deepEqual((await readInventoryReuse({...base,unitState:"in_stock",condition:"needs_repair"})).items.map((unit)=>unit.id),[f.pendingUnitId]);
  } finally {await f.cleanup();}
});

test("PostgreSQL custody prevents bypass, permits an authorized remover to receive, retries exactly once, preserves invoice and supports reinstallation",{skip:!run},async()=>{
  const f = await createInventoryReuseFixture();
  const base = {companyId:f.companyId,locationId:f.locationId};
  const command = (action,actorId,extra={}) => ({...base,action,actorId,idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID()),...extra});
  const remove = command("remove",f.removerId,{usageId:f.usageId,reason:"Bench inspection"});
  const stock = async()=> (await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1",[f.companyId])).rows[0];
  try {
    await query("update inventory_serialized_units set custody_bin_location='OLD-SHELF',custody_external_reference='old holder' where company_id=$1 and id=$2",[f.companyId,f.unitId]);
    await assert.rejects(mutateInventoryReuse({...remove,actorId:f.adminId}),{code:"INVENTORY_REUSE_FORBIDDEN"});
    assert.equal((await finalizeSerializedUnitUsage({...base,workorderId:f.workorderId,usageId:f.usageId,disposition:"removed",actorId:f.removerId,actorRole:"office",idempotencyKey:randomUUID(),requestHash:reuseDigest("old-remove")})).kind,"custody_required");
    const results = await Promise.all([mutateInventoryReuse(remove),mutateInventoryReuse(remove)]);
    assert.deepEqual(results.map((r)=>r.replayed).sort(),[false,true]);
    const c = results[0].case;
    assert.equal(c.status,"awaiting_handoff");
    assert.equal(c.removalWorkorderId,null);
    assert.equal(c.ownership,"company");
    assert.match(c.ownershipEvidence,new RegExp(f.receiptId));
    assert.deepEqual((await query("select custody_holder_type,custody_bin_location,custody_external_reference from inventory_serialized_units where company_id=$1 and id=$2",[f.companyId,f.unitId])).rows[0],{custody_holder_type:"handoff",custody_bin_location:"",custody_external_reference:null});
    assert.equal((await stock()).quantity_on_hand,"1.000");
    await assert.rejects(mutateInventoryReuse({...remove,reason:"changed",requestHash:reuseDigest("changed")}),{code:"INVENTORY_REUSE_REPLAY_CONFLICT"});
    const issueScope = {...base,workorderId:f.secondWorkorderId,actorRole:"office",actorId:f.removerId};
    assert.equal((await issueSerializedUnitToWorkorder({...issueScope,unitId:f.unitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("unsafe")})).kind,"unit_state");
    await assert.rejects(mutateInventoryReuse(command("release",f.releaseId,{caseId:c.id,decision:"release",inspectionEvidence:"Pass",reason:"Inspected"})),{code:"INVENTORY_REUSE_CHANGED"});
    // Explicit capability and exact-unit confirmation are sufficient; removal and receipt remain separate audited events.
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.removerId,capabilities:["remove","receive"],reason:"Authorized self-receipt test"});
    const receive = command("receive",f.removerId,{caseId:c.id,evidence:"Physical serial matched at shop counter"});
    assert.equal((await mutateInventoryReuse(receive)).case.status,"received_pending_review");
    assert.equal((await mutateInventoryReuse(receive)).replayed,true);
    await query("delete from inventory_reuse_catalog_policies where company_id=$1",[f.companyId]);
    const release = command("release",f.releaseId,{caseId:c.id,decision:"release",inspectionEvidence:"Bench test passed; no refurbishment needed",reason:"Release tested item"});
    await assert.rejects(mutateInventoryReuse(release),{code:"INVENTORY_REUSE_POLICY_REQUIRED"});
    assert.equal((await mutateInventoryReuse(command("release",f.releaseId,{caseId:c.id,decision:"hold",inspectionEvidence:"Waiting policy",reason:"Policy absent"}))).case.status,"hold");
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"policy",catalogPartId:f.catalogPartId,reuseAllowed:true,evidence:"Manufacturer reusable approval"});
    const released = await Promise.all([mutateInventoryReuse(release),mutateInventoryReuse(release)]);
    assert.deepEqual(released.map((r)=>r.replayed).sort(),[false,true]);
    assert.equal((await stock()).quantity_on_hand,"2.000");
    await assert.rejects(mutateInventoryReuse(command("release",f.releaseId,{caseId:c.id,decision:"release",inspectionEvidence:"Pass",reason:"Duplicate"})),{code:"INVENTORY_REUSE_CHANGED"});
    assert.equal((await readInventoryReuse({...base,actorId:f.releaseId,view:"operation",idempotencyKey:release.idempotencyKey})).case.status,"released");
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.releaseId,capabilities:[],reason:"Revoke during retry"});
    await assert.rejects(mutateInventoryReuse(release),{code:"INVENTORY_REUSE_FORBIDDEN"});
    await assert.rejects(readInventoryReuse({...base,actorId:f.releaseId,view:"operation",idempotencyKey:release.idempotencyKey}),{code:"INVENTORY_REUSE_FORBIDDEN"});
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.releaseId,capabilities:["release"],reason:"Restore test grant"});
    const reused = await issueSerializedUnitToWorkorder({...issueScope,unitId:f.unitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("reissue")});
    assert.equal(reused.kind,"reserved"); assert.notEqual(reused.usage.id,f.usageId);
    await finalizeSerializedUnitUsage({...issueScope,usageId:reused.usage.id,disposition:"installed",idempotencyKey:randomUUID(),requestHash:reuseDigest("reinstall")});
    const client=await getPool().connect(); try {await client.query("begin");await consumePendingSerializedInstallationsForApproval(client,{workorderId:f.secondWorkorderId,companyId:f.companyId,officeUserId:f.adminId});await client.query("commit");} finally {client.release();}
    const identity=(await query("select receipt_id,receipt_line_id,status from inventory_serialized_units where id=$1",[f.unitId])).rows[0];
    assert.deepEqual(identity,{receipt_id:f.receiptId,receipt_line_id:f.lineId,status:"installed"});
    assert.equal((await query("select count(*)::int as n from inventory_stock_movements where company_id=$1 and usage_id=$2 and movement_type='return'",[f.companyId,f.usageId])).rows[0].n,1);
    const events=(await query("select event_type from inventory_unit_events where company_id=$1 and unit_id=$2",[f.companyId,f.unitId])).rows.map((r)=>r.event_type);
    for(const event of ["removed","reuse_received","reuse_hold","reuse_released"]) assert.ok(events.includes(event));

    // Physically fitted preapproval parts also require custody; no unused shortcut.
    await query("update inventory_receipts set provider='legacy_tracking',invoice_run_id=null,count_import_id=null,serialization_batch_id=null where company_id=$1 and id=$2",[f.companyId,f.receiptId]);
    const pending=await issueSerializedUnitToWorkorder({...issueScope,unitId:f.pendingUnitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("pending")});
    await finalizeSerializedUnitUsage({...issueScope,usageId:pending.usage.id,disposition:"installed",idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-install")});
    assert.equal((await finalizeSerializedUnitUsage({...issueScope,usageId:pending.usage.id,disposition:"returned",idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-return")})).kind,"custody_required");
    const held=(await mutateInventoryReuse(command("remove",f.removerId,{usageId:pending.usage.id,reason:"Fitted but damaged",ownership:"customer",ownershipEvidence:"Customer title retained"}))).case;
    assert.equal(held.installationStatus,"installed_pending_approval");
    assert.equal(held.ownership,"customer");
    assert.deepEqual(await stock(),{quantity_on_hand:"0.000",quantity_reserved:"0.000"});
    await mutateInventoryReuse(command("receive",f.receiverId,{caseId:held.id,evidence:"Observed damaged serial"}));
    await assert.rejects(mutateInventoryReuse(command("release",f.releaseId,{caseId:held.id,decision:"release",inspectionEvidence:"Condition okay",reason:"Attempt customer property release"})),{code:"INVENTORY_REUSE_OWNERSHIP_REQUIRED"});
    assert.equal((await mutateInventoryReuse(command("release",f.releaseId,{caseId:held.id,decision:"hold",inspectionEvidence:"Customer property",reason:"Await reviewed title"}))).case.status,"hold");
    // Cross-tenant/cross-location scope is denied before returning case details.
    await assert.rejects(readInventoryReuse({...base,companyId:randomUUID(),actorId:f.adminId,view:"queue"}),{code:"INVENTORY_REUSE_FORBIDDEN"});
    await assert.rejects(readInventoryReuse({...base,locationId:randomUUID(),actorId:f.adminId,view:"queue"}),{code:"INVENTORY_REUSE_FORBIDDEN"});
  } finally {await f.cleanup();}
});

test("PostgreSQL pending company-owned installation follows physical custody and restores stock once",{skip:!run},async()=>{
  const f=await createInventoryReuseFixture({installed:false});
  const base={companyId:f.companyId,locationId:f.locationId};
  const scope={...base,actorId:f.removerId,actorRole:"office",workorderId:f.workorderId};
  const command=(action,actorId,details)=>({...base,action,actorId,idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID()),...details});
  try {
    const issued=await issueSerializedUnitToWorkorder({...scope,unitId:f.unitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-stock")});
    await finalizeSerializedUnitUsage({...scope,usageId:issued.usage.id,disposition:"installed",idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-fit")});
    const removed=await mutateInventoryReuse(command("remove",f.removerId,{usageId:issued.usage.id,reason:"Remove fitted test unit"}));
    assert.equal(removed.case.installationStatus,"installed_pending_approval");
    assert.equal(removed.case.removalWorkorderId,null);
    assert.equal(removed.case.ownership,"company");
    assert.deepEqual((await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1",[f.companyId])).rows[0],{quantity_on_hand:"1.000",quantity_reserved:"0.000"});
    await mutateInventoryReuse(command("receive",f.receiverId,{caseId:removed.case.id,evidence:"Exact serial physically received"}));
    const release=command("release",f.releaseId,{caseId:removed.case.id,decision:"release",inspectionEvidence:"Bench test passed; no repair outstanding",reason:"Return inspected serial"});
    await Promise.all([mutateInventoryReuse(release),mutateInventoryReuse(release)]);
    assert.deepEqual((await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1",[f.companyId])).rows[0],{quantity_on_hand:"2.000",quantity_reserved:"0.000"});
    assert.equal((await query("select count(*)::int n from inventory_stock_movements where company_id=$1 and usage_id=$2",[f.companyId,issued.usage.id])).rows[0].n,2);
  } finally {await f.cleanup();}
});

test("PostgreSQL Units custody finds two serialized installations independently when the asset has no home location",{skip:!run},async()=>{
  const f=await createInventoryReuseFixture({installed:false});
  const scope={companyId:f.companyId,locationId:f.locationId,workorderId:f.workorderId,actorId:f.removerId,actorRole:"office"};
  try {
    const usages=[];
    for (const [index,unitId] of [f.unitId,f.pendingUnitId].entries()) {
      const issued=await issueSerializedUnitToWorkorder({...scope,unitId,idempotencyKey:`two-issued-${index}-${f.suffix}`,requestHash:reuseDigest(`two-issued-${index}-${f.suffix}`)});
      usages.push(issued.usage);
      await finalizeSerializedUnitUsage({...scope,usageId:issued.usage.id,disposition:"installed",idempotencyKey:`two-installed-${index}-${f.suffix}`,requestHash:reuseDigest(`two-installed-${index}-${f.suffix}`)});
    }
    const client=await getPool().connect();
    try {
      await client.query("begin");
      assert.equal(await consumePendingSerializedInstallationsForApproval(client,{workorderId:f.workorderId,companyId:f.companyId,officeUserId:f.adminId}),2);
      await client.query("update operational_workorders set status='closed' where id=$1",[f.workorderId]);
      await client.query("update assets set location_id=null where company_id=$1 and id=$2",[f.companyId,f.assetId]);
      await client.query("commit");
    } catch(error) { await client.query("rollback"); throw error; }
    finally { client.release(); }

    const directory=await listUnitsDirectory({companyIds:[f.companyId],locationIds:[],isAdmin:true,q:`CQ-A-${f.suffix.slice(0,8)}`,unitType:null,limit:25,cursor:null});
    const unit=directory.items.find((item)=>item.id===f.assetId);
    assert.equal(unit.locationId,null);
    assert.equal(unit.custodyLocationId,f.locationId);
    const custody=await readInventoryReuse({companyId:f.companyId,locationId:unit.custodyLocationId,assetId:f.assetId,actorId:f.adminId,view:"asset"});
    assert.equal(custody.installedParts.length,2);
    assert.deepEqual(new Set(custody.installedParts.map((part)=>part.usageId)),new Set(usages.map((usage)=>usage.id)));
    assert.equal(new Set(custody.installedParts.map((part)=>part.serialNumber)).size,2);
  } finally { await f.cleanup(); }
});

test("PostgreSQL explicit removal capability works from Unit detail without workorder write access",{skip:!run},async()=>{
  const f=await createInventoryReuseFixture();
  const base={companyId:f.companyId,locationId:f.locationId,actorId:f.removerId};
  const removal={...base,action:"remove",usageId:f.usageId,reason:"Direct Unit removal",
    idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID())};
  try {
    const policyId=randomUUID();
    await query("insert into workorder_module_policy_scopes(id,scope_type,company_id) values($1,'company',$2)",[policyId,f.companyId]);
    await query(`insert into workorder_module_access_rules(scope_id,subject_type,subject_id,role_key,surface,module_key,access)
      values($1,'role','office','office','detail','partsScanning','read')`,[policyId]);
    const view=await readInventoryReuse({...base,view:"asset",assetId:f.assetId});
    assert.equal(view.installedParts[0].ownershipRequired,false);
    assert.equal(view.installedParts[0].inferredOwnership,"company");
    assert.equal("removalWorkorders" in view,false);
    const before=(await query("select count(*)::int n from operational_workorders where company_id=$1",[f.companyId])).rows[0].n;
    const removed=(await mutateInventoryReuse(removal)).case;
    assert.equal(removed.status,"awaiting_handoff");
    assert.equal(removed.removalWorkorderId,null);
    assert.equal((await query("select count(*)::int n from operational_workorders where company_id=$1",[f.companyId])).rows[0].n,before);
  } finally {await f.cleanup();}
});
