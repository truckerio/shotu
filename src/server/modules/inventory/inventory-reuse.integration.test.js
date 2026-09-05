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

test("PostgreSQL custody prevents bypass, separates duties, retries exactly once, preserves invoice and supports reinstallation",{skip:!run},async()=>{
  const f = await createInventoryReuseFixture();
  const base = {companyId:f.companyId,locationId:f.locationId};
  const command = (action,actorId,extra={}) => ({...base,action,actorId,idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID()),...extra});
  const remove = command("remove",f.removerId,{usageId:f.usageId,removalWorkorderId:f.removalWorkorderId,reason:"Bench inspection",ownership:"company",ownershipEvidence:"Original company purchase verified"});
  const stock = async()=> (await query("select quantity_on_hand,quantity_reserved from inventory_items where company_id=$1",[f.companyId])).rows[0];
  try {
    await assert.rejects(mutateInventoryReuse({...remove,actorId:f.adminId}),{code:"INVENTORY_REUSE_FORBIDDEN"});
    await assert.rejects(mutateInventoryReuse({...remove,removalWorkorderId:f.secondWorkorderId}),{code:"INVENTORY_REUSE_CHANGED"});
    assert.equal((await finalizeSerializedUnitUsage({...base,workorderId:f.workorderId,usageId:f.usageId,disposition:"removed",actorId:f.removerId,actorRole:"office",idempotencyKey:randomUUID(),requestHash:reuseDigest("old-remove")})).kind,"custody_required");
    const results = await Promise.all([mutateInventoryReuse(remove),mutateInventoryReuse(remove)]);
    assert.deepEqual(results.map((r)=>r.replayed).sort(),[false,true]);
    const c = results[0].case;
    assert.equal(c.status,"awaiting_handoff");
    assert.equal((await stock()).quantity_on_hand,"1.000");
    await assert.rejects(mutateInventoryReuse({...remove,reason:"changed",requestHash:reuseDigest("changed")}),{code:"INVENTORY_REUSE_REPLAY_CONFLICT"});
    const issueScope = {...base,workorderId:f.secondWorkorderId,actorRole:"office",actorId:f.removerId};
    assert.equal((await issueSerializedUnitToWorkorder({...issueScope,unitId:f.unitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("unsafe")})).kind,"unit_state");
    await assert.rejects(mutateInventoryReuse(command("release",f.releaseId,{caseId:c.id,decision:"release",inspectionEvidence:"Pass",reason:"Inspected"})),{code:"INVENTORY_REUSE_CHANGED"});
    // Even explicitly granted Admin/remover may not self-receive or self-release.
    await configureInventoryReuse({...base,actorId:f.adminId,kind:"grant",userId:f.removerId,capabilities:["remove","receive","release"],reason:"Separation test"});
    await assert.rejects(mutateInventoryReuse(command("receive",f.removerId,{caseId:c.id,evidence:"In shop"})),{code:"INVENTORY_REUSE_SEPARATION_REQUIRED"});
    const receive = command("receive",f.receiverId,{caseId:c.id,evidence:"Physical serial matched at shop counter"});
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
    const pending=await issueSerializedUnitToWorkorder({...issueScope,unitId:f.pendingUnitId,idempotencyKey:randomUUID(),requestHash:reuseDigest("pending")});
    await finalizeSerializedUnitUsage({...issueScope,usageId:pending.usage.id,disposition:"installed",idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-install")});
    assert.equal((await finalizeSerializedUnitUsage({...issueScope,usageId:pending.usage.id,disposition:"returned",idempotencyKey:randomUUID(),requestHash:reuseDigest("pending-return")})).kind,"custody_required");
    const held=(await mutateInventoryReuse(command("remove",f.removerId,{usageId:pending.usage.id,removalWorkorderId:f.secondWorkorderId,reason:"Fitted but damaged",ownership:"customer",ownershipEvidence:"Customer title retained"}))).case;
    assert.equal(held.installationStatus,"installed_pending_approval");
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
    const removed=await mutateInventoryReuse(command("remove",f.removerId,{usageId:issued.usage.id,removalWorkorderId:f.workorderId,reason:"Remove fitted test unit",ownership:"company",ownershipEvidence:"Verified company purchase"}));
    assert.equal(removed.case.installationStatus,"installed_pending_approval");
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

test("PostgreSQL office/admin can remove against a newly created open workorder; assigned mechanics cannot",{skip:!run},async()=>{
  for (const role of ["office","admin"]) {
    const f=await createInventoryReuseFixture();
    const base={companyId:f.companyId,locationId:f.locationId,actorId:f.removerId};
    const removal={...base,action:"remove",usageId:f.usageId,removalWorkorderId:f.removalWorkorderId,
      ownership:"company",ownershipEvidence:"Verified purchase",reason:"New open removal workorder",
      idempotencyKey:randomUUID(),requestHash:reuseDigest(randomUUID())};
    try {
      await query("update operational_workorders set status='open' where id=$1",[f.removalWorkorderId]);
      // Explicit mechanic module grant ensures denial is the open lifecycle guard,
      // not a hidden default module masking a permissive repository transition.
      const policyId=randomUUID();
      await query("insert into workorder_module_policy_scopes(id,scope_type,company_id) values($1,'company',$2)",[policyId,f.companyId]);
      await query(`insert into workorder_module_access_rules(scope_id,subject_type,subject_id,role_key,surface,module_key,access)
        values($1,'role','mechanic','mechanic','detail','partsScanning','write')`,[policyId]);
      await query("update user_company_memberships set role='mechanic' where company_id=$1 and user_id=$2",[f.companyId,f.removerId]);
      await query(`insert into workorder_mechanic_assignments(workorder_id,mechanic_user_id,assignment_role,active,assigned_by_user_id)
        values($1,$2,'primary',true,$3)`,[f.removalWorkorderId,f.removerId,f.adminId]);
      await assert.rejects(mutateInventoryReuse(removal),{code:"INVENTORY_REUSE_CHANGED"});
      await assert.rejects(readInventoryReuse({...base,view:"asset",assetId:f.assetId}),{code:"INVENTORY_REUSE_FORBIDDEN"});
      await query("update user_company_memberships set role=$3 where company_id=$1 and user_id=$2",[f.companyId,f.removerId,role]);
      const view=await readInventoryReuse({...base,view:"asset",assetId:f.assetId});
      assert.ok(view.removalWorkorders.some((w)=>w.id===f.removalWorkorderId && w.status==="open"));
      assert.equal((await mutateInventoryReuse(removal)).case.status,"awaiting_handoff");
    } finally {await f.cleanup();}
  }
});
