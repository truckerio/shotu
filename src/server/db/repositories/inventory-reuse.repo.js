import { getPool } from "../pool.js";
import { InventoryError } from "../../modules/inventory/inventory.errors.js";
import { isApplicationOwnedInventoryProvider } from "../../../../shared/inventory-provider.js";
import { listProductModuleAccessRules } from "./product-module-access.repo.js";
import { getNormalizedModulePolicy } from "./module-access-rules.repo.js";
import { modeAllows, resolveProductModuleMode } from "../../../../shared/product-modules.js";
import { resolveEffectiveWorkorderModuleAccess } from "../../../../shared/workorder-modules.js";
import { inventoryTokenFromCode, readInventoryQrToken } from "../../modules/inventory/inventory-qr.js";

const fail = (code, message, statusCode = 409) => { throw new InventoryError(message, { code, statusCode }); };
const changed = () => fail("INVENTORY_REUSE_CHANGED", "This part changed — review its current status.");
const denied = () => fail("INVENTORY_REUSE_FORBIDDEN", "Current location access and an explicit inventory capability are required.", 403);
export function publicReuseCase(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}

const CASE_SELECT = `select c.*, u.serial_number,u.status as unit_status,u.condition_code,u.custody_holder_type,u.custody_location_id,u.custody_asset_id,u.custody_bin_location,u.custody_external_reference,u.custody_version,
  (select repair.started_at from inventory_reuse_repairs repair where repair.company_id=c.company_id and repair.case_id=c.id order by repair.started_at desc limit 1) as repair_started_at,
  (select repair.completed_at from inventory_reuse_repairs repair where repair.company_id=c.company_id and repair.case_id=c.id order by repair.started_at desc limit 1) as repair_completed_at,
  case when u.custody_holder_type='asset' then concat('Unit ',coalesce((select a.unit_no from assets a where a.company_id=u.company_id and a.id=u.custody_asset_id), 'unknown'))
       when u.custody_holder_type='inventory_location' then concat(coalesce((select location.name from locations location where location.company_id=u.company_id and location.id=u.custody_location_id),'Inventory'),case when coalesce(u.custody_bin_location,'')='' then '' else concat(' · ',u.custody_bin_location) end)
       else coalesce(nullif(u.custody_external_reference,''),replace(u.custody_holder_type,'_',' ')) end as custody_holder_label, l.part_number, l.description, w.serial as original_workorder_serial
  from inventory_reuse_cases c
  join inventory_serialized_units u on u.company_id=c.company_id and u.id=c.unit_id
  join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id
  join operational_workorders w on w.company_id=c.company_id and w.id=c.original_workorder_id`;
async function loadCase(client, input, id) {
  const result = await client.query(`${CASE_SELECT} where c.company_id=$1 and c.location_id=$2 and c.id=$3`, [input.companyId,input.locationId,id]);
  return publicReuseCase(result.rows[0]);
}

// All custody/config commands share a scope lock, then lock membership/grants,
// workorder, exact usage/unit, and aggregate balance in that order.
async function scopeAccess(client, input, capability, admin = false) {
  const member = await client.query(`select m.role from user_company_memberships m
    join user_profiles p on p.id=m.user_id
    join locations l on l.company_id=m.company_id and l.id=$2
    where m.company_id=$1 and m.user_id=$3 and m.active and p.active and p.deleted_at is null and l.active
    for share of m,p,l`, [input.companyId,input.locationId,input.actorId]);
  const role = member.rows[0]?.role;
  if (!role) denied();
  if (admin && role !== "admin") denied();
  if (role !== "admin") {
    const location = await client.query(`select user_id from user_location_memberships
      where company_id=$1 and location_id=$2 and user_id=$3 and active for share`, [input.companyId,input.locationId,input.actorId]);
    if (!location.rows[0]) denied();
  }
  const grants = await client.query(`select capability from inventory_reuse_capability_grants
    where company_id=$1 and location_id=$2 and user_id=$3 order by capability for share`, [input.companyId,input.locationId,input.actorId]);
  const capabilities = Object.fromEntries(["remove","receive","release","route","repair","disposition","quarantine"].map((key) => [key,grants.rows.some((r) => r.capability===key)]));
  if (capability && !capabilities[capability]) denied();
  capabilities.configure = role === "admin";
  await moduleAccess(client,input,role,Boolean(capability || admin && input.kind));
  return { role, capabilities };
}

async function moduleAccess(client,input,role,write) {
  // SHARE also protects absent rules against an insertion revoking a compatibility
  // default during this short transaction. No second pool connection is used.
  await client.query("lock table product_module_access_rules, workorder_module_policy_scopes, workorder_module_access_rules in share mode");
  const dependencies = {query:client.query.bind(client)};
  const rules = await listProductModuleAccessRules({companyIds:[input.companyId],locationIds:[input.locationId]},dependencies);
  const product = resolveProductModuleMode({moduleKey:"workorders",role,userId:input.actorId,
    companyRules:rules.filter((r)=>!r.locationId),locationRules:rules.filter((r)=>r.locationId===input.locationId)});
  if (!modeAllows(product.mode,write ? "write" : "read")) denied();
  if (input.action === "remove" || input.view === "asset") {
    const companyPolicy = await getNormalizedModulePolicy({companyId:input.companyId},dependencies);
    const locationPolicy = await getNormalizedModulePolicy({companyId:input.companyId,locationId:input.locationId},dependencies);
    const decision = resolveEffectiveWorkorderModuleAccess({role,userId:input.actorId,surface:"detail",moduleKey:"partsScanning",companyPolicy,locationPolicy});
    if (!(write ? ["write","required"] : ["read","write","required"]).includes(decision.access)) denied();
  }
}

async function transaction(input, callback) {
  const client = await (input.pool || getPool()).connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`inventory-reuse:${input.companyId}:${input.locationId}`]);
    const result = await callback(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    // Only a concurrent operation replay is a normal stale-state outcome.
    // Preserve other uniqueness failures as migration/data defects instead of
    // disguising them as a user retry.
    if (error.code === "23505" && error.constraint === "inventory_reuse_operations_pkey") changed();
    throw error;
  } finally { client.release(); }
}
async function audit(client,input,action,caseId,details) {
  await client.query(`insert into inventory_reuse_audit_events(company_id,location_id,actor_id,action,case_id,details)
    values($1,$2,$3,$4,$5,$6::jsonb)`,[input.companyId,input.locationId,input.actorId,action,caseId,JSON.stringify(details)]);
}

export async function mutateInventoryReuse(input) {
  return transaction(input, async (client) => {
    const { role } = await scopeAccess(client,input,input.capability || input.action);
    const prior = await client.query(`select request_hash,result from inventory_reuse_operations
      where company_id=$1 and actor_id=$2 and idempotency_key=$3`, [input.companyId,input.actorId,input.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== input.requestHash) fail("INVENTORY_REUSE_REPLAY_CONFLICT", "This request key was already used with different details.");
      return { case: prior.rows[0].result, replayed: true, operationId: input.idempotencyKey, ledgerEffect: 0, unitProjection: prior.rows[0].result };
    }
    let caseId = input.caseId;
    if (input.action === "legacy_track") {
      if (!["office","admin"].includes(role)) denied();
      const asset = await client.query(`select id from assets where company_id=$1 and location_id=$2 and id=$3 for share`,[input.companyId,input.locationId,input.assetId]);
      if (!asset.rows[0]) fail("INVENTORY_REUSE_NOT_FOUND","Source unit not found.",404);
      let workorderId=input.removalWorkorderId;
      if (workorderId) {
        const supplied=await client.query(`select id from operational_workorders where company_id=$1 and location_id=$2 and asset_id=$3 and id=$4 and status in ('open','accepted','in_progress') for update`,[input.companyId,input.locationId,input.assetId,workorderId]);
        if (!supplied.rows[0]) changed();
      }
      if (!workorderId) {
        const existing=await client.query(`select id from operational_workorders where company_id=$1 and location_id=$2 and asset_id=$3 and status in ('open','accepted','in_progress') order by created_at desc,id limit 1 for update`,[input.companyId,input.locationId,input.assetId]);
        if (existing.rows[0]) workorderId=existing.rows[0].id;
        else { const made=await client.query(`insert into operational_workorders(company_id,serial,asset_id,location_id,created_by_user_id,concern,office_notes,form_data,work_performed) values($1,$2,$3,$4,$5,'Legacy part removal tracking',$6,'{}'::jsonb,'') returning id`,[input.companyId,`RM-${Date.now()}-${input.assetId.slice(0,8)}`,input.assetId,input.locationId,input.actorId,input.reason]); workorderId=made.rows[0].id; }
      }
      const part=await client.query(`select id,part_number,description,uom_code from parts_catalog where company_id=$1 and id=$2 for share`,[input.companyId,input.catalogPartId]); if(!part.rows[0]) fail("INVENTORY_REUSE_NOT_FOUND","Catalog part not found.",404);
      const ids=await client.query(`select gen_random_uuid() receipt_id,gen_random_uuid() line_id,gen_random_uuid() unit_id,gen_random_uuid() usage_id`); const id=ids.rows[0];
      const marker=`legacy-tracking-${id.unit_id}`;
      await client.query(`insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at) values($1,$2,$3,$4,$5,'legacy_tracking',$5,'Tracking began at removal; earlier physical history unavailable','confirmed',now())`,[id.receipt_id,input.companyId,input.locationId,input.actorId,marker]);
      await client.query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode) values($1,$2,$3,0,$4,$5,$6,$7,1,$8,'serial')`,[id.line_id,input.companyId,id.receipt_id,input.catalogPartId,`legacy_tracking:${input.catalogPartId}`,part.rows[0].part_number,part.rows[0].description,part.rows[0].uom_code]);
      await client.query(`insert into inventory_serialized_units(id,company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id,custody_legacy_available) values($1,$2,$3,$4,$5,1,$6,'removed','unknown','handoff',$3,false)`,[id.unit_id,input.companyId,input.locationId,id.receipt_id,id.line_id,input.serialNumber || `LEGACY-${id.unit_id.slice(0,8).toUpperCase()}`]);
      await client.query(`insert into workorder_serialized_part_usages(id,company_id,workorder_id,asset_id,location_id,unit_id,catalog_part_id,uom_code,repair_order,status,issued_by_user_id,issue_idempotency_key,issue_request_hash,finalized_by_user_id,finalized_at,finalize_idempotency_key,finalize_request_hash) values($1,$2,$3,$4,$5,$6,$7,$8,'','removed',$9,$10,$11,$9,now(),$10,$11)`,[id.usage_id,input.companyId,workorderId,input.assetId,input.locationId,id.unit_id,input.catalogPartId,part.rows[0].uom_code,input.actorId,`legacy:${id.usage_id}`,input.requestHash]);
      const created=await client.query(`insert into inventory_reuse_cases(company_id,location_id,unit_id,usage_id,asset_id,original_workorder_id,removal_workorder_id,installation_status,status,removed_by_user_id,reason,ownership,ownership_evidence,intended_route) values($1,$2,$3,$4,$5,$6,$6,'installed_pending_approval','awaiting_handoff',$7,$8,$9,$10,$11) returning id`,[input.companyId,input.locationId,id.unit_id,id.usage_id,input.assetId,workorderId,input.actorId,input.reason,input.ownership,input.ownershipEvidence,input.intendedRoute]); caseId=created.rows[0].id;
      await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,usage_id,workorder_id,asset_id,details) values($1,$2,'removed',$3,$4,$5,$6,$7::jsonb)`,[input.companyId,id.unit_id,input.actorId,id.usage_id,workorderId,input.assetId,JSON.stringify({caseId,origin:'legacy_tracking_started_at_removal',earlierPhysicalHistoryUnavailable:true,note:input.note})]);
    } else if (input.action === "remove") {
      let removalWorkorderId = input.removalWorkorderId;
      if (!removalWorkorderId && ["office", "admin"].includes(role)) {
        const usageForWorkorder = await client.query(`select asset_id from workorder_serialized_part_usages where company_id=$1 and location_id=$2 and id=$3 for share`, [input.companyId,input.locationId,input.usageId]);
        if (!usageForWorkorder.rows[0]) changed();
        const existingWorkorders = await client.query(`select id from operational_workorders where company_id=$1 and location_id=$2 and asset_id=$3 and status in ('open','accepted','in_progress') order by id limit 2 for update`, [input.companyId,input.locationId,usageForWorkorder.rows[0].asset_id]);
        if (existingWorkorders.rows.length > 1) fail("INVENTORY_REUSE_WORKORDER_REQUIRED", "Choose the workorder that records this removal.");
        if (existingWorkorders.rows.length === 1) removalWorkorderId = existingWorkorders.rows[0].id;
        else {
          const serial = `RM-${Date.now()}-${input.usageId.slice(0, 8)}`;
          const createdWorkorder = await client.query(`insert into operational_workorders(company_id,serial,asset_id,location_id,created_by_user_id,concern,office_notes,form_data,work_performed)
            values($1,$2,$3,$4,$5,$6,$7,'{}'::jsonb,'') returning id`, [input.companyId,serial,usageForWorkorder.rows[0].asset_id,input.locationId,input.actorId,"Removed part custody",input.reason]);
          removalWorkorderId = createdWorkorder.rows[0].id;
        }
      }
      const workorders = await client.query(`select id,asset_id,status from operational_workorders
        where company_id=$1 and location_id=$2 and id=$3 for update`, [input.companyId,input.locationId,removalWorkorderId]);
      const workorder = workorders.rows[0];
      const removalStatuses = ["office","admin"].includes(role) ? ["open","accepted","in_progress"] : ["accepted","in_progress"];
      if (!workorder || !removalStatuses.includes(workorder.status)) changed();
      if (role === "mechanic") {
        const assigned = await client.query(`select mechanic_user_id from workorder_mechanic_assignments
          where workorder_id=$1 and mechanic_user_id=$2 and active for share`,[workorder.id,input.actorId]);
        if (!assigned.rows[0]) denied();
      }
      const result = await client.query(`select s.*,u.status as unit_status,u.custody_version,r.provider
        from workorder_serialized_part_usages s
        join inventory_serialized_units u on u.company_id=s.company_id and u.id=s.unit_id and u.location_id=s.location_id
        join inventory_receipts r on r.company_id=u.company_id and r.id=u.receipt_id
        where s.company_id=$1 and s.location_id=$2 and s.id=$3 for update of s,u`,[input.companyId,input.locationId,input.usageId]);
      const usage = result.rows[0];
      if (input.expectedVersion && usage?.custody_version !== input.expectedVersion) changed();
      const pending = usage?.status === "installed_pending_approval" && usage.unit_status === "installed_pending_approval";
      if (!usage || !(pending || usage.status === "installed" && usage.unit_status === "installed")
        || usage.asset_id !== workorder.asset_id || !pending && usage.workorder_id === workorder.id
        || !isApplicationOwnedInventoryProvider(usage.provider)) changed();
      if (pending) {
        const item = await client.query(`select id from inventory_items where company_id=$1 and location_id=$2
          and catalog_part_id=$3 and uom_code=$4 and source_provider='local' order by updated_at desc,id limit 1 for update`,[input.companyId,input.locationId,usage.catalog_part_id,usage.uom_code]);
        if (!item.rows[0]) changed();
        const consumed = await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand-1,quantity_reserved=quantity_reserved-1,updated_at=now()
          where id=$1 and quantity_on_hand>=1 and quantity_reserved>=1 returning id`,[item.rows[0].id]);
        if (!consumed.rows[0]) changed();
        await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,
          actor_id,reason,idempotency_key,unit_id,usage_id,workorder_id,asset_id)
          values($1,$2,$3,'issue',-1,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.companyId,input.locationId,usage.catalog_part_id,usage.uom_code,input.actorId,
          "Physically fitted pending part removed into custody hold",`reuse-pending:${usage.id}`,usage.unit_id,usage.id,workorder.id,usage.asset_id]);
      }
      const created = await client.query(`insert into inventory_reuse_cases(company_id,location_id,unit_id,usage_id,asset_id,
          original_workorder_id,removal_workorder_id,status,removed_by_user_id,reason,ownership,ownership_evidence,installation_status,intended_route)
        values($1,$2,$3,$4,$5,$6,$7,'awaiting_handoff',$8,$9,$10,$11,$12,$13) returning id`,
      [input.companyId,input.locationId,usage.unit_id,usage.id,usage.asset_id,usage.workorder_id,workorder.id,input.actorId,input.reason,input.ownership,input.ownershipEvidence,usage.status,input.intendedRoute || "not_sure"]);
      caseId = created.rows[0].id;
      await client.query(`update workorder_serialized_part_usages set status='removed',updated_at=now() where company_id=$1 and id=$2`,[input.companyId,usage.id]);
      await client.query(`update inventory_serialized_units set status='removed',custody_holder_type='handoff',custody_asset_id=null,custody_location_id=$3,condition_code='unknown',custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,usage.unit_id,input.locationId]);
      await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,usage_id,workorder_id,asset_id,details)
        values($1,$2,'removed',$3,$4,$5,$6,$7::jsonb)`,[input.companyId,usage.unit_id,input.actorId,usage.id,workorder.id,usage.asset_id,JSON.stringify({caseId,originalWorkorderId:usage.workorder_id,custody:"awaiting_handoff",reason:input.reason})]);
    } else if (input.action === "correct_location") {
      const unit = await client.query(`select id,status,custody_version,custody_holder_type,custody_location_id,custody_bin_location,custody_external_reference from inventory_serialized_units where company_id=$1 and location_id=$2 and id=$3 for update`,[input.companyId,input.locationId,input.unitId]);
      const current = unit.rows[0];
      if (!current) fail("INVENTORY_REUSE_NOT_FOUND","Exact inventory unit not found.",404);
      if (current.custody_version !== input.custodyVersion) changed();
      if (current.status !== "in_stock" || current.custody_holder_type !== "inventory_location" || input.holderType !== "inventory_location") fail("INVENTORY_REUSE_LOCATION_CORRECTION_FORBIDDEN","Only an in-stock inventory-held exact unit may have its bin corrected.");
      await client.query(`update inventory_serialized_units set custody_bin_location=$3,custody_external_reference=null,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,input.unitId,input.binLocation]);
      await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,details) values($1,$2,'reuse_location_corrected',$3,$4::jsonb)`,[input.companyId,input.unitId,input.actorId,JSON.stringify({before:current,evidence:input.evidence})]);
      const result = publicReuseCase((await client.query(`select id,serial_number,status,condition_code,custody_holder_type,custody_location_id,custody_bin_location,custody_external_reference,custody_version from inventory_serialized_units where company_id=$1 and id=$2`,[input.companyId,input.unitId])).rows[0]);
      await audit(client,input,"location_corrected",null,{unitId:input.unitId,before:current,after:result,evidence:input.evidence});
      await client.query(`insert into inventory_reuse_operations(company_id,location_id,actor_id,idempotency_key,action,request_hash,case_id,result) values($1,$2,$3,$4,$5,$6,null,$7::jsonb)`,[input.companyId,input.locationId,input.actorId,input.idempotencyKey,input.action,input.requestHash,JSON.stringify(result)]);
      return {case:null,replayed:false,operationId:input.idempotencyKey,ledgerEffect:0,unitProjection:result};
    } else {
      const result = await client.query(`select c.*,u.status as unit_status,u.custody_holder_type,u.custody_location_id,s.status as usage_status,s.catalog_part_id,s.uom_code
        from inventory_reuse_cases c
        join workorder_serialized_part_usages s on s.company_id=c.company_id and s.id=c.usage_id
        join inventory_serialized_units u on u.company_id=c.company_id and u.id=c.unit_id and u.location_id=c.location_id
        where c.company_id=$1 and c.location_id=$2 and c.id=$3 for update of c,s,u`,[input.companyId,input.locationId,caseId]);
      const current = result.rows[0];
      if (!current) fail("INVENTORY_REUSE_NOT_FOUND", "Removed-part case not found.",404);
      if (current.removed_by_user_id === input.actorId) fail("INVENTORY_REUSE_SEPARATION_REQUIRED", "A different authorized person must receive, release, or dispose this part.",403);
      if (current.unit_status !== "removed" || current.usage_status !== "removed") changed();
      if (input.expectedVersion && current.case_version !== input.expectedVersion) changed();
      if (input.action === "receive") {
        if (current.status !== "awaiting_handoff") changed();
        if (input.exactUnitId && input.exactUnitId !== current.unit_id) fail("INVENTORY_REUSE_EXACT_UNIT_MISMATCH", "The scanned unit does not match this removed-part case.");
        if (input.actualLocationId && input.actualLocationId !== input.locationId) fail("INVENTORY_REUSE_CROSS_LOCATION_FORBIDDEN", "A returned part cannot be received into a different owning inventory location.");
        await client.query(`update inventory_reuse_cases set status='received_pending_review',received_by_user_id=$4,
          receipt_evidence=$5,received_bin_location=$6,final_route=coalesce($7,final_route),case_version=case_version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId,input.actorId,input.evidence,input.binLocation || "",input.correctedRoute || null]);
        await client.query(`update inventory_serialized_units set custody_holder_type=$3,custody_location_id=coalesce($4,custody_location_id),custody_bin_location=$5,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,input.actualHolderType || "inventory_location",input.actualLocationId || input.locationId,input.binLocation || ""]);
      } else if (input.action === "release") {
        if (!["received_pending_review","hold","repair_complete_pending_review"].includes(current.status) || !current.received_by_user_id) changed();
        if (current.custody_holder_type !== "inventory_location" || current.custody_location_id !== input.locationId) fail("INVENTORY_REUSE_PHYSICAL_RETURN_REQUIRED","Confirm physical return to this shop before releasing stock.");
        if (input.decision === "release") {
          const policy = await client.query(`select reuse_allowed,evidence from inventory_reuse_catalog_policies
            where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`,[input.companyId,input.locationId,current.catalog_part_id]);
          if (!policy.rows[0]?.reuse_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED", "Catalog reuse approval is missing or reuse is prohibited. Keep this part on hold.");
          if (current.ownership !== "company" || !current.ownership_evidence.trim()) fail("INVENTORY_REUSE_OWNERSHIP_REQUIRED", "Documented company ownership is required. Keep customer or unknown property on hold.");
          const item = await client.query(`select id from inventory_items where company_id=$1 and location_id=$2
            and catalog_part_id=$3 and uom_code=$4 and source_provider='local' order by updated_at desc,id limit 1 for update`,[input.companyId,input.locationId,current.catalog_part_id,current.uom_code]);
          if (!item.rows[0]) {
            const part=await client.query(`select normalized_part_number,part_number,description from parts_catalog where company_id=$1 and id=$2 for share`,[input.companyId,current.catalog_part_id]);
            if (!part.rows[0]) fail("INVENTORY_SERIAL_BALANCE_MISMATCH","Matching local stock balance is missing. Inventory review is required.");
            const createdItem=await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,description,quantity_on_hand,quantity_reserved,uom_code,source_provider,external_id,last_seen_at,updated_at)
              values($1,$2,$3,$4,$5,$6,0,0,$7,'local',$8,now(),now()) on conflict do nothing returning id`,[input.companyId,input.locationId,current.catalog_part_id,part.rows[0].normalized_part_number,part.rows[0].part_number,part.rows[0].description,current.uom_code,`legacy-release:${current.catalog_part_id}:${input.locationId}:${current.uom_code}`]);
            if (!createdItem.rows[0]) { const reloaded=await client.query(`select id from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and uom_code=$4 and source_provider='local' order by updated_at desc,id limit 1 for update`,[input.companyId,input.locationId,current.catalog_part_id,current.uom_code]); item.rows[0]=reloaded.rows[0]; } else item.rows[0]=createdItem.rows[0];
            if (!item.rows[0]) fail("INVENTORY_SERIAL_BALANCE_MISMATCH","Matching local stock balance is missing. Inventory review is required.");
          }
          await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand+1,updated_at=now() where id=$1`,[item.rows[0].id]);
          await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,
            actor_id,reason,idempotency_key,unit_id,usage_id,workorder_id,asset_id)
            values($1,$2,$3,'return',1,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.companyId,input.locationId,current.catalog_part_id,current.uom_code,input.actorId,input.reason,`reuse-release:${caseId}`,current.unit_id,current.usage_id,current.removal_workorder_id,current.asset_id]);
          await client.query(`update inventory_serialized_units set status='in_stock',condition_code=$3,custody_holder_type='inventory_location',custody_location_id=$4,custody_asset_id=null,custody_bin_location=$5,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,current.status === "repair_complete_pending_review" ? "refurbished" : "serviceable_used",input.locationId,input.binLocation || current.received_bin_location || ""]);
        }
        await client.query(`update inventory_reuse_cases set status=$4,inspection_evidence=$5,review_reason=$6,
          released_by_user_id=$7,case_version=case_version+1,completed_at=case when $4='released' then now() else null end,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,
        [input.companyId,input.locationId,caseId,input.decision === "release" ? "released" : "hold",input.inspectionEvidence,input.reason,input.decision === "release" ? input.actorId : null]);
      } else if (input.action === "route" || input.action === "quarantine_resolve") {
        if (!["received_pending_review","hold","quarantine","repair_complete_pending_review"].includes(current.status)) changed();
        const route = input.action === "route" ? input.route : input.resolution;
        const policy=await client.query(`select repair_allowed,core_return_allowed,scrap_allowed from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`,[input.companyId,input.locationId,current.catalog_part_id]);
        if (route === "repair" && !policy.rows[0]?.repair_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog repair approval is missing.");
        if (route === "core_return" && !policy.rows[0]?.core_return_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog core-return approval is missing.");
        if (route === "scrap" && !policy.rows[0]?.scrap_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog scrap approval is missing.");
        const next = route === "repair" ? "repair" : route === "core_return" ? "core_pending_return" : route === "scrap" ? "scrap_pending_approval" : route === "not_sure" ? "quarantine" : "received_pending_review";
        const condition = route === "repair" ? "needs_repair" : ["core_return","scrap"].includes(route) ? "unserviceable" : "unknown";
        await client.query(`update inventory_reuse_cases set status=$4,final_route=$5,review_reason=$6,case_version=case_version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId,next,route,input.evidence]);
        await client.query(`update inventory_serialized_units set condition_code=$3,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,condition]);
      } else if (input.action === "repair_start") {
        if (current.status !== "repair") changed();
        const policy=await client.query(`select repair_allowed from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`,[input.companyId,input.locationId,current.catalog_part_id]); if (!policy.rows[0]?.repair_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog repair approval is missing.");
        const started=await client.query(`insert into inventory_reuse_repairs(company_id,case_id,handler_type,handler_reference,evidence) values($1,$2,$3,$4,$5) on conflict do nothing returning id`,[input.companyId,caseId,input.handlerType,input.handlerReference,input.evidence]); if (!started.rows[0]) changed();
        await client.query(`update inventory_serialized_units set custody_holder_type=$3,custody_external_reference=$4,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,input.handlerType === "external" ? "external_repair" : "internal_repair",input.handlerReference]);
        await client.query(`update inventory_reuse_cases set case_version=case_version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId]);
      } else if (input.action === "repair_complete") {
        if (current.status !== "repair") changed();
        const policy = await client.query(`select repair_allowed from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`, [input.companyId,input.locationId,current.catalog_part_id]);
        if (!policy.rows[0]?.repair_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED", "Catalog repair approval is missing.");
        if (input.exactUnitId !== current.unit_id) fail("INVENTORY_REUSE_EXACT_UNIT_MISMATCH","The returned unit does not match this repair case.");
        const repair=await client.query(`update inventory_reuse_repairs set completed_at=now(),evidence=$3,version=version+1 where company_id=$1 and case_id=$2 and completed_at is null returning id`,[input.companyId,caseId,input.evidence]);
        if (!repair.rows[0]) changed();
        await client.query(`update inventory_reuse_cases set status='repair_complete_pending_review',receipt_evidence=$4,received_bin_location=$5,review_reason=$6,case_version=case_version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId,input.receiptEvidence,input.binLocation,input.evidence]);
        await client.query(`update inventory_serialized_units set custody_holder_type='inventory_location',custody_location_id=$3,custody_asset_id=null,custody_bin_location=$4,custody_external_reference=null,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,input.locationId,input.binLocation]);
      } else if (input.action === "core_return" || input.action === "scrap") {
        const required = input.action === "core_return" ? "core_pending_return" : "scrap_pending_approval";
        if (current.status !== required) changed();
        const policy=await client.query(`select core_return_allowed,scrap_allowed from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`,[input.companyId,input.locationId,current.catalog_part_id]); if (input.action === "core_return" && !policy.rows[0]?.core_return_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog core-return approval is missing."); if (input.action === "scrap" && !policy.rows[0]?.scrap_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED","Catalog scrap approval is missing.");
        const next = input.action === "core_return" ? "core_returned" : "scrapped";
        await client.query(`update inventory_reuse_cases set status=$4,external_reference=$5,review_reason=$6,disposition_occurred_on=$7::date,completed_at=now(),case_version=case_version+1,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId,next,input.externalReference,input.evidence,input.dispositionDate]);
        await client.query(`update inventory_serialized_units set status=$3,custody_holder_type=$4,custody_external_reference=$5,custody_version=custody_version+1,updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id,input.action === "scrap" ? "scrapped" : "removed",input.action === "scrap" ? "disposed" : "core_vendor",input.externalReference || ""]);
      }
    }
    const result = await loadCase(client,input,caseId);
    if (!['remove','legacy_track'].includes(input.action)) await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,usage_id,workorder_id,asset_id,details)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[input.companyId,result.unitId,({receive:"reuse_received",release:input.decision === "hold" ? "reuse_hold" : "reuse_released",route:"reuse_routed",repair_start:"reuse_repair_started",repair_complete:"reuse_repair_completed",core_return:"reuse_core_returned",scrap:"reuse_scrapped",quarantine_resolve:"reuse_quarantine_resolved"})[input.action],
      input.actorId,result.usageId,result.removalWorkorderId,result.assetId,JSON.stringify({caseId,status:result.status,evidence:input.evidence || input.inspectionEvidence,reason:input.reason || null,externalReference:input.externalReference || null,dispositionDate:input.dispositionDate || null})]);
    await audit(client,input,input.action === "release" ? input.decision : input.action,caseId,result);
    await client.query(`insert into inventory_reuse_operations(company_id,location_id,actor_id,idempotency_key,action,request_hash,case_id,result)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[input.companyId,input.locationId,input.actorId,input.idempotencyKey,input.action,input.requestHash,caseId,JSON.stringify(result)]);
    const ledgerEffect = input.action === "release" && input.decision === "release" ? 1 : input.action === "remove" && result.installationStatus === "installed_pending_approval" ? -1 : 0;
    return { case: result,replayed:false,operationId:input.idempotencyKey,ledgerEffect,unitProjection:result };
  });
}

export async function readInventoryReuse(input) {
  return transaction(input,async (client) => {
    const access = await scopeAccess(client,input,null,input.view === "config");
    if (input.view === "operation") {
      const result = await client.query(`select action,result from inventory_reuse_operations
        where company_id=$1 and location_id=$2 and actor_id=$3 and idempotency_key=$4`,[input.companyId,input.locationId,input.actorId,input.idempotencyKey]);
      if (!result.rows[0]) fail("INVENTORY_REUSE_OPERATION_NOT_FOUND","No confirmation was found for this request.",404);
      const recoveredCapability=({legacy_track:"remove",correct_location:"route",repair_start:"repair",repair_complete:"repair",core_return:"disposition",scrap:"disposition",quarantine_resolve:"quarantine"})[result.rows[0].action] || result.rows[0].action;
      if (!access.capabilities[recoveredCapability]) denied();
      await moduleAccess(client,{...input,action:recoveredCapability},access.role,true);
      return { case:result.rows[0].result,replayed:true };
    }
    if (input.view === "config") {
      const staff = await client.query(`select p.id,p.display_name as name,m.role,
        coalesce((select jsonb_agg(g.capability order by g.capability) from inventory_reuse_capability_grants g
          where g.company_id=$1 and g.location_id=$2 and g.user_id=p.id),'[]'::jsonb) as capabilities
        from user_company_memberships m join user_profiles p on p.id=m.user_id
        where m.company_id=$1 and m.active and p.active and p.deleted_at is null
          and (m.role='admin' or exists(select 1 from user_location_memberships lm where lm.company_id=$1 and lm.location_id=$2 and lm.user_id=p.id and lm.active))
        order by p.display_name,p.id limit 200`,[input.companyId,input.locationId]);
      const parts = input.catalogPartId
        ? await client.query(`select id,part_number,description from parts_catalog where company_id=$1 and id=$2`,[input.companyId,input.catalogPartId])
        : { rows: [] };
      const policies = input.catalogPartId
        ? await client.query(`select p.catalog_part_id,c.part_number,c.description,p.reuse_allowed,p.repair_allowed,p.core_return_allowed,p.scrap_allowed,p.evidence
          from inventory_reuse_catalog_policies p join parts_catalog c on c.company_id=p.company_id and c.id=p.catalog_part_id
          where p.company_id=$1 and p.location_id=$2 and p.catalog_part_id=$3`,[input.companyId,input.locationId,input.catalogPartId])
        : { rows: [] };
      return {staff:staff.rows,parts:parts.rows.map(publicReuseCase),policies:policies.rows.map(publicReuseCase),limits:{staff:200},possiblyTruncated:staff.rows.length===200};
    }
    if (["stock", "units", "unit", "scan"].includes(input.view)) {
      // Inventory-wide exact-stock reads are never a mechanic shortcut around
      // assigned-work access; mechanics use the existing asset view below.
      if (access.role === "mechanic") denied();
      let unitId = input.unitId;
      if (input.view === "scan") {
        const token = inventoryTokenFromCode(input.code);
        unitId = readInventoryQrToken(token);
        if (!unitId) {
          const matched = await client.query(`select id from inventory_serialized_units where company_id=$1 and location_id=$2 and serial_number=$3 limit 2`,[input.companyId,input.locationId,String(input.code || "").trim()]);
          if (matched.rows.length !== 1) fail("INVENTORY_REUSE_NOT_FOUND", "The scanned inventory label is invalid or unavailable.", 404);
          unitId = matched.rows[0].id;
        }
      }
      if (input.view === "unit" || input.view === "scan") {
        const detail = await client.query(`select u.id,u.serial_number,u.status,u.condition_code,u.custody_holder_type,u.custody_location_id,u.custody_asset_id,u.custody_bin_location,u.custody_external_reference,u.custody_version,u.custody_legacy_available,
          l.catalog_part_id,l.part_number,l.description,c.id as case_id,c.status as case_status,c.case_version,c.intended_route,c.final_route,c.reason as removal_reason,c.ownership,(select repair.started_at from inventory_reuse_repairs repair where repair.company_id=u.company_id and repair.case_id=c.id order by repair.started_at desc limit 1) as repair_started_at,(select repair.completed_at from inventory_reuse_repairs repair where repair.company_id=u.company_id and repair.case_id=c.id order by repair.started_at desc limit 1) as repair_completed_at,
          coalesce((select jsonb_agg(jsonb_build_object('eventType',e.event_type,'at',e.created_at,'details',e.details) order by e.created_at,e.id) from inventory_unit_events e where e.company_id=u.company_id and e.unit_id=u.id),'[]'::jsonb) timeline
          from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id
          left join lateral (select * from inventory_reuse_cases c where c.company_id=u.company_id and c.unit_id=u.id order by c.updated_at desc,c.id desc limit 1) c on true
          where u.company_id=$1 and u.location_id=$2 and u.id=$3`, [input.companyId,input.locationId,unitId]);
        if (!detail.rows[0]) fail("INVENTORY_REUSE_NOT_FOUND", "Exact inventory unit not found.", 404);
        const exact = publicReuseCase(detail.rows[0]);
        return { unit: exact, case: exact.caseId ? { id:exact.caseId,status:exact.caseStatus,caseVersion:exact.caseVersion,intendedRoute:exact.intendedRoute,finalRoute:exact.finalRoute,repairStarted:Boolean(exact.repairStartedAt && !exact.repairCompletedAt),repair:{startedAt:exact.repairStartedAt || null,completedAt:exact.repairCompletedAt || null} } : null, timeline: exact.timeline, capabilities: access.capabilities };
      }
      const where = ["u.company_id=$1", "u.location_id=$2"], values = [input.companyId,input.locationId];
      if (input.catalogPartId) { values.push(input.catalogPartId); where.push(`l.catalog_part_id=$${values.length}`); }
      if (input.condition) { values.push(input.condition); where.push(`u.condition_code=$${values.length}`); }
      if (input.status) { values.push(input.status); where.push(`u.status=$${values.length}`); }
      if (input.q) { values.push(`%${input.q}%`); where.push(`(u.serial_number ilike $${values.length} or l.part_number ilike $${values.length} or l.description ilike $${values.length})`); }
      if (input.cursor) { values.push(input.cursor); where.push(`${input.view === "units" ? "u.id" : "l.catalog_part_id"} > $${values.length}`); }
      values.push(input.limit + 1);
      if (input.view === "units") {
        const rows = await client.query(`select u.id,u.serial_number,u.status,u.condition_code,u.custody_holder_type,u.custody_location_id,u.custody_bin_location,u.custody_version,u.custody_legacy_available,
          case when u.custody_holder_type='asset' then concat('Unit ',coalesce((select a.unit_no from assets a where a.company_id=u.company_id and a.id=u.custody_asset_id),'unknown')) else concat(coalesce((select location.name from locations location where location.company_id=u.company_id and location.id=u.custody_location_id),replace(u.custody_holder_type,'_',' ')),case when coalesce(u.custody_bin_location,'')='' then '' else concat(' · ',u.custody_bin_location) end) end as custody_holder_label,l.catalog_part_id,l.part_number,l.description
          from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id where ${where.join(" and ")} order by u.id limit $${values.length}`, values);
        const counts=await client.query(`select count(*) filter(where u.status='in_stock' and u.custody_holder_type='inventory_location' and u.condition_code='new')::int as new,count(*) filter(where u.status='in_stock' and u.custody_holder_type='inventory_location' and u.condition_code='serviceable_used')::int as reusable,count(*) filter(where u.status='in_stock' and u.custody_holder_type='inventory_location' and u.condition_code='refurbished')::int as refurbished from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id where u.company_id=$1 and u.location_id=$2 and l.catalog_part_id=$3`,[input.companyId,input.locationId,input.catalogPartId]);
        const items = rows.rows.slice(0,input.limit).map(publicReuseCase); return { items, conditionCounts:counts.rows[0], nextCursor: rows.rows.length > input.limit ? items.at(-1)?.id : null, capabilities: access.capabilities };
      }
      const rows = await client.query(`select l.catalog_part_id,l.part_number,l.description,
        count(*) filter (where u.status='in_stock' and u.custody_holder_type='inventory_location' and u.condition_code in ('new','serviceable_used','refurbished'))::int as ready,
        count(*) filter (where u.status='reserved')::int as reserved,count(*) filter (where u.status in ('installed','installed_pending_approval'))::int as installed,
        count(*) filter (where u.status not in ('in_stock','reserved','installed','installed_pending_approval') or u.condition_code in ('needs_repair','unserviceable','unknown'))::int as action_needed
        from inventory_serialized_units u join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id where ${where.join(" and ")}
        group by l.catalog_part_id,l.part_number,l.description order by l.catalog_part_id limit $${values.length}`, values);
      const items=rows.rows.slice(0,input.limit).map(publicReuseCase); return {items,nextCursor:rows.rows.length>input.limit ? items.at(-1)?.catalogPartId : null,capabilities:access.capabilities};
    }
    // Mechanics may see only placements/cases on assets tied to their active assigned work.
    if (access.role === "mechanic") {
      if (!input.assetId) denied();
      const permitted = await client.query(`select w.id from operational_workorders w join workorder_mechanic_assignments a on a.workorder_id=w.id
        where w.company_id=$1 and w.location_id=$2 and w.asset_id=$3 and a.mechanic_user_id=$4 and a.active
          and w.status in ('accepted','in_progress') limit 1`,[input.companyId,input.locationId,input.assetId,input.actorId]);
      if (!permitted.rows[0]) denied();
    }
    const queueStatus = input.status === "needs_inspection" ? ["received_pending_review","hold","repair_complete_pending_review"] : input.status === "repair_refurbish" ? ["repair"] : input.status === "core_returns" ? ["core_pending_return"] : input.status === "scrap_approval" ? ["scrap_pending_approval"] : input.status === "completed" ? ["released","core_returned","scrapped"] : input.status ? [input.status] : null;
    const cases = await client.query(`${CASE_SELECT} where c.company_id=$1 and c.location_id=$2 and ($3::uuid is null or c.asset_id=$3)
      and ($4::text[] is null or c.status=any($4)) and ($5::text is null or c.intended_route=$5 or c.final_route=$5)
      and ($6::text='' or u.serial_number ilike '%'||$6||'%' or l.part_number ilike '%'||$6||'%' or l.description ilike '%'||$6||'%')
      and ($7::uuid is null or c.id>$7) order by c.id limit $8`,[input.companyId,input.locationId,input.assetId || null,queueStatus,input.route || null,input.q || "",input.cursor || null,(input.limit || 50)+1]);
    if (!input.assetId) { const rows=cases.rows.slice(0,input.limit || 50).map(publicReuseCase); const aggregate=await client.query(`select status,count(*)::int n from inventory_reuse_cases where company_id=$1 and location_id=$2 group by status`,[input.companyId,input.locationId]);const by=Object.fromEntries(aggregate.rows.map(r=>[r.status,r.n]));const sum=(xs)=>xs.reduce((n,x)=>n+(by[x]||0),0);const counts={awaiting_handoff:sum(['awaiting_handoff']),needs_inspection:sum(['received_pending_review','hold','repair_complete_pending_review']),repair_refurbish:sum(['repair']),core_returns:sum(['core_pending_return']),scrap_approval:sum(['scrap_pending_approval']),quarantine:sum(['quarantine']),completed:sum(['released','core_returned','scrapped'])}; return {items:rows,cases:rows,counts,capabilities:access.capabilities,nextCursor:cases.rows.length>(input.limit || 50) ? rows.at(-1)?.id : null}; }
    const installed = await client.query(`select s.id as usage_id,s.unit_id,u.serial_number,u.custody_version,s.catalog_part_id,l.part_number,l.description,
      s.workorder_id,w.serial as workorder_serial,s.status,s.asset_id,s.location_id
      from workorder_serialized_part_usages s join inventory_serialized_units u on u.company_id=s.company_id and u.id=s.unit_id
      join inventory_receipt_lines l on l.company_id=u.company_id and l.id=u.receipt_line_id
      join operational_workorders w on w.company_id=s.company_id and w.id=s.workorder_id
      where s.company_id=$1 and s.location_id=$2 and s.asset_id=$3 and s.status in ('installed','installed_pending_approval')
      order by s.issued_at desc,s.id limit 100`,[input.companyId,input.locationId,input.assetId]);
    const workorders = await client.query(`select w.id,w.serial,w.status,w.asset_id,w.location_id from operational_workorders w
      where w.company_id=$1 and w.location_id=$2 and w.asset_id=$3
        and (w.status in ('accepted','in_progress') or ($4::text in ('office','admin') and w.status='open'))
        and ($4::text <> 'mechanic' or exists(select 1 from workorder_mechanic_assignments a where a.workorder_id=w.id and a.mechanic_user_id=$5 and a.active))
      order by w.created_at desc,w.id limit 100`,[input.companyId,input.locationId,input.assetId,access.role,input.actorId]);
    return {installedParts:installed.rows.map(publicReuseCase),removalWorkorders:workorders.rows.map(publicReuseCase),cases:cases.rows.map(publicReuseCase),capabilities:access.capabilities,locationId:input.locationId,
      possiblyTruncated:installed.rows.length===100 || workorders.rows.length===100 || cases.rows.length===100};
  });
}

export async function configureInventoryReuse(input) {
  return transaction(input,async (client) => {
    await scopeAccess(client,input,null,true);
    if (input.kind === "grant") {
      const target = await client.query(`select m.user_id from user_company_memberships m join user_profiles p on p.id=m.user_id
        where m.company_id=$1 and m.user_id=$2 and m.active and p.active and p.deleted_at is null
          and (m.role='admin' or exists(select 1 from user_location_memberships l where l.company_id=$1 and l.location_id=$3 and l.user_id=m.user_id and l.active)) for share of m,p`,[input.companyId,input.userId,input.locationId]);
      if (!target.rows[0]) denied();
      const before = await client.query(`select capability from inventory_reuse_capability_grants where company_id=$1 and location_id=$2 and user_id=$3`,[input.companyId,input.locationId,input.userId]);
      await client.query(`delete from inventory_reuse_capability_grants where company_id=$1 and location_id=$2 and user_id=$3`,[input.companyId,input.locationId,input.userId]);
      for (const capability of new Set(input.capabilities)) await client.query(`insert into inventory_reuse_capability_grants(company_id,location_id,user_id,capability,granted_by_user_id) values($1,$2,$3,$4,$5)`,[input.companyId,input.locationId,input.userId,capability,input.actorId]);
      await audit(client,input,"configure_grants",null,{userId:input.userId,before:before.rows.map((r)=>r.capability),after:input.capabilities,reason:input.reason});
    } else {
      const part = await client.query(`select id from parts_catalog where company_id=$1 and id=$2 for share`,[input.companyId,input.catalogPartId]);
      if (!part.rows[0]) fail("INVENTORY_REUSE_NOT_FOUND","Catalog part not found.",404);
      const before = await client.query(`select reuse_allowed,repair_allowed,core_return_allowed,scrap_allowed,evidence from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3`,[input.companyId,input.locationId,input.catalogPartId]);
      await client.query(`insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,repair_allowed,core_return_allowed,scrap_allowed,evidence,updated_by_user_id)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9) on conflict(company_id,location_id,catalog_part_id) do update
        set reuse_allowed=excluded.reuse_allowed,repair_allowed=excluded.repair_allowed,core_return_allowed=excluded.core_return_allowed,scrap_allowed=excluded.scrap_allowed,evidence=excluded.evidence,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`,[input.companyId,input.locationId,input.catalogPartId,input.reuseAllowed,Boolean(input.repairAllowed),Boolean(input.coreReturnAllowed),input.scrapAllowed ?? true,input.evidence,input.actorId]);
      await audit(client,input,"configure_policy",null,{catalogPartId:input.catalogPartId,before:before.rows[0] || null,reuseAllowed:input.reuseAllowed,repairAllowed:input.repairAllowed,coreReturnAllowed:input.coreReturnAllowed,scrapAllowed:input.scrapAllowed,evidence:input.evidence});
    }
    return {saved:true};
  });
}
