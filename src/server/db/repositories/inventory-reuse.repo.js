import { getPool } from "../pool.js";
import { InventoryError } from "../../modules/inventory/inventory.errors.js";
import { isApplicationOwnedInventoryProvider } from "../../../../shared/inventory-provider.js";
import { listProductModuleAccessRules } from "./product-module-access.repo.js";
import { getNormalizedModulePolicy } from "./module-access-rules.repo.js";
import { modeAllows, resolveProductModuleMode } from "../../../../shared/product-modules.js";
import { resolveEffectiveWorkorderModuleAccess } from "../../../../shared/workorder-modules.js";

const fail = (code, message, statusCode = 409) => { throw new InventoryError(message, { code, statusCode }); };
const changed = () => fail("INVENTORY_REUSE_CHANGED", "This part changed — review its current status.");
const denied = () => fail("INVENTORY_REUSE_FORBIDDEN", "Current location access and an explicit inventory capability are required.", 403);
export function publicReuseCase(row) {
  if (!row) return null;
  return Object.fromEntries(Object.entries(row).map(([key, value]) => [key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase()), value]));
}

const CASE_SELECT = `select c.*, u.serial_number, l.part_number, l.description, w.serial as original_workorder_serial
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
  const capabilities = Object.fromEntries(["remove","receive","release"].map((key) => [key,grants.rows.some((r) => r.capability===key)]));
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
    if (error.code === "23505") changed();
    throw error;
  } finally { client.release(); }
}
async function audit(client,input,action,caseId,details) {
  await client.query(`insert into inventory_reuse_audit_events(company_id,location_id,actor_id,action,case_id,details)
    values($1,$2,$3,$4,$5,$6::jsonb)`,[input.companyId,input.locationId,input.actorId,action,caseId,JSON.stringify(details)]);
}

export async function mutateInventoryReuse(input) {
  return transaction(input, async (client) => {
    const { role } = await scopeAccess(client,input,input.action);
    const prior = await client.query(`select request_hash,result from inventory_reuse_operations
      where company_id=$1 and actor_id=$2 and idempotency_key=$3`, [input.companyId,input.actorId,input.idempotencyKey]);
    if (prior.rows[0]) {
      if (prior.rows[0].request_hash !== input.requestHash) fail("INVENTORY_REUSE_REPLAY_CONFLICT", "This request key was already used with different details.");
      return { case: prior.rows[0].result, replayed: true };
    }
    let caseId = input.caseId;
    if (input.action === "remove") {
      const workorders = await client.query(`select id,asset_id,status from operational_workorders
        where company_id=$1 and location_id=$2 and id=$3 for update`, [input.companyId,input.locationId,input.removalWorkorderId]);
      const workorder = workorders.rows[0];
      const removalStatuses = ["office","admin"].includes(role) ? ["open","accepted","in_progress"] : ["accepted","in_progress"];
      if (!workorder || !removalStatuses.includes(workorder.status)) changed();
      if (role === "mechanic") {
        const assigned = await client.query(`select mechanic_user_id from workorder_mechanic_assignments
          where workorder_id=$1 and mechanic_user_id=$2 and active for share`,[workorder.id,input.actorId]);
        if (!assigned.rows[0]) denied();
      }
      const result = await client.query(`select s.*,u.status as unit_status,r.provider
        from workorder_serialized_part_usages s
        join inventory_serialized_units u on u.company_id=s.company_id and u.id=s.unit_id and u.location_id=s.location_id
        join inventory_receipts r on r.company_id=u.company_id and r.id=u.receipt_id
        where s.company_id=$1 and s.location_id=$2 and s.id=$3 for update of s,u`,[input.companyId,input.locationId,input.usageId]);
      const usage = result.rows[0];
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
          original_workorder_id,removal_workorder_id,status,removed_by_user_id,reason,ownership,ownership_evidence,installation_status)
        values($1,$2,$3,$4,$5,$6,$7,'awaiting_handoff',$8,$9,$10,$11,$12) returning id`,
      [input.companyId,input.locationId,usage.unit_id,usage.id,usage.asset_id,usage.workorder_id,workorder.id,input.actorId,input.reason,input.ownership,input.ownershipEvidence,usage.status]);
      caseId = created.rows[0].id;
      await client.query(`update workorder_serialized_part_usages set status='removed',updated_at=now() where company_id=$1 and id=$2`,[input.companyId,usage.id]);
      await client.query(`update inventory_serialized_units set status='removed',updated_at=now() where company_id=$1 and id=$2`,[input.companyId,usage.unit_id]);
      await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,usage_id,workorder_id,asset_id,details)
        values($1,$2,'removed',$3,$4,$5,$6,$7::jsonb)`,[input.companyId,usage.unit_id,input.actorId,usage.id,workorder.id,usage.asset_id,JSON.stringify({caseId,originalWorkorderId:usage.workorder_id,custody:"awaiting_handoff",reason:input.reason})]);
    } else {
      const result = await client.query(`select c.*,u.status as unit_status,s.status as usage_status,s.catalog_part_id,s.uom_code
        from inventory_reuse_cases c
        join workorder_serialized_part_usages s on s.company_id=c.company_id and s.id=c.usage_id
        join inventory_serialized_units u on u.company_id=c.company_id and u.id=c.unit_id and u.location_id=c.location_id
        where c.company_id=$1 and c.location_id=$2 and c.id=$3 for update of c,s,u`,[input.companyId,input.locationId,caseId]);
      const current = result.rows[0];
      if (!current) fail("INVENTORY_REUSE_NOT_FOUND", "Removed-part case not found.",404);
      if (current.removed_by_user_id === input.actorId) fail("INVENTORY_REUSE_SEPARATION_REQUIRED", "A different authorized person must receive or review this part.",403);
      if (current.unit_status !== "removed" || current.usage_status !== "removed") changed();
      if (input.action === "receive") {
        if (current.status !== "awaiting_handoff") changed();
        await client.query(`update inventory_reuse_cases set status='received_pending_review',received_by_user_id=$4,
          receipt_evidence=$5,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,[input.companyId,input.locationId,caseId,input.actorId,input.evidence]);
      } else {
        if (!["received_pending_review","hold"].includes(current.status) || !current.received_by_user_id) changed();
        if (input.decision === "release") {
          const policy = await client.query(`select reuse_allowed,evidence from inventory_reuse_catalog_policies
            where company_id=$1 and location_id=$2 and catalog_part_id=$3 for share`,[input.companyId,input.locationId,current.catalog_part_id]);
          if (!policy.rows[0]?.reuse_allowed) fail("INVENTORY_REUSE_POLICY_REQUIRED", "Catalog reuse approval is missing or reuse is prohibited. Keep this part on hold.");
          if (current.ownership !== "company" || !current.ownership_evidence.trim()) fail("INVENTORY_REUSE_OWNERSHIP_REQUIRED", "Documented company ownership is required. Keep customer or unknown property on hold.");
          const item = await client.query(`select id from inventory_items where company_id=$1 and location_id=$2
            and catalog_part_id=$3 and uom_code=$4 and source_provider='local' order by updated_at desc,id limit 1 for update`,[input.companyId,input.locationId,current.catalog_part_id,current.uom_code]);
          if (!item.rows[0]) fail("INVENTORY_SERIAL_BALANCE_MISMATCH","Matching local stock balance is missing. Inventory review is required.");
          await client.query(`update inventory_items set quantity_on_hand=quantity_on_hand+1,updated_at=now() where id=$1`,[item.rows[0].id]);
          await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,
            actor_id,reason,idempotency_key,unit_id,usage_id,workorder_id,asset_id)
            values($1,$2,$3,'return',1,$4,$5,$6,$7,$8,$9,$10,$11)`,[input.companyId,input.locationId,current.catalog_part_id,current.uom_code,input.actorId,input.reason,`reuse-release:${caseId}`,current.unit_id,current.usage_id,current.removal_workorder_id,current.asset_id]);
          await client.query(`update inventory_serialized_units set status='in_stock',updated_at=now() where company_id=$1 and id=$2`,[input.companyId,current.unit_id]);
        }
        await client.query(`update inventory_reuse_cases set status=$4,inspection_evidence=$5,review_reason=$6,
          released_by_user_id=$7,updated_at=now() where company_id=$1 and location_id=$2 and id=$3`,
        [input.companyId,input.locationId,caseId,input.decision === "release" ? "released" : "hold",input.inspectionEvidence,input.reason,input.decision === "release" ? input.actorId : null]);
      }
    }
    const result = await loadCase(client,input,caseId);
    if (input.action !== "remove") await client.query(`insert into inventory_unit_events(company_id,unit_id,event_type,actor_id,usage_id,workorder_id,asset_id,details)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[input.companyId,result.unitId,input.action === "receive" ? "reuse_received" : input.decision === "hold" ? "reuse_hold" : "reuse_released",
      input.actorId,result.usageId,result.removalWorkorderId,result.assetId,JSON.stringify({caseId,status:result.status,evidence:input.evidence || input.inspectionEvidence,reason:input.reason || null})]);
    await audit(client,input,input.action === "release" ? input.decision : input.action,caseId,result);
    await client.query(`insert into inventory_reuse_operations(company_id,location_id,actor_id,idempotency_key,action,request_hash,case_id,result)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`,[input.companyId,input.locationId,input.actorId,input.idempotencyKey,input.action,input.requestHash,caseId,JSON.stringify(result)]);
    return { case: result,replayed:false };
  });
}

export async function readInventoryReuse(input) {
  return transaction(input,async (client) => {
    const access = await scopeAccess(client,input,null,input.view === "config");
    if (input.view === "operation") {
      const result = await client.query(`select action,result from inventory_reuse_operations
        where company_id=$1 and location_id=$2 and actor_id=$3 and idempotency_key=$4`,[input.companyId,input.locationId,input.actorId,input.idempotencyKey]);
      if (!result.rows[0]) fail("INVENTORY_REUSE_OPERATION_NOT_FOUND","No confirmation was found for this request.",404);
      if (!access.capabilities[result.rows[0].action]) denied();
      await moduleAccess(client,{...input,action:result.rows[0].action},access.role,true);
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
      const parts = await client.query(`select id,part_number,description from parts_catalog where company_id=$1 order by part_number,id limit 500`,[input.companyId]);
      const policies = await client.query(`select p.catalog_part_id,c.part_number,c.description,p.reuse_allowed,p.evidence
        from inventory_reuse_catalog_policies p join parts_catalog c on c.company_id=p.company_id and c.id=p.catalog_part_id
        where p.company_id=$1 and p.location_id=$2 order by c.part_number,c.id limit 500`,[input.companyId,input.locationId]);
      return {staff:staff.rows,parts:parts.rows.map(publicReuseCase),policies:policies.rows.map(publicReuseCase),limits:{staff:200,parts:500,policies:500},possiblyTruncated:staff.rows.length===200 || parts.rows.length===500 || policies.rows.length===500};
    }
    // Mechanics may see only placements/cases on assets tied to their active assigned work.
    if (access.role === "mechanic") {
      if (!input.assetId) denied();
      const permitted = await client.query(`select w.id from operational_workorders w join workorder_mechanic_assignments a on a.workorder_id=w.id
        where w.company_id=$1 and w.location_id=$2 and w.asset_id=$3 and a.mechanic_user_id=$4 and a.active
          and w.status in ('accepted','in_progress') limit 1`,[input.companyId,input.locationId,input.assetId,input.actorId]);
      if (!permitted.rows[0]) denied();
    }
    const cases = await client.query(`${CASE_SELECT} where c.company_id=$1 and c.location_id=$2 and ($3::uuid is null or c.asset_id=$3)
      order by c.created_at desc,c.id limit 100`,[input.companyId,input.locationId,input.assetId || null]);
    if (!input.assetId) return {cases:cases.rows.map(publicReuseCase),capabilities:access.capabilities,possiblyTruncated:cases.rows.length===100};
    const installed = await client.query(`select s.id as usage_id,s.unit_id,u.serial_number,s.catalog_part_id,l.part_number,l.description,
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
      const before = await client.query(`select reuse_allowed,evidence from inventory_reuse_catalog_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3`,[input.companyId,input.locationId,input.catalogPartId]);
      await client.query(`insert into inventory_reuse_catalog_policies(company_id,location_id,catalog_part_id,reuse_allowed,evidence,updated_by_user_id)
        values($1,$2,$3,$4,$5,$6) on conflict(company_id,location_id,catalog_part_id) do update
        set reuse_allowed=excluded.reuse_allowed,evidence=excluded.evidence,updated_by_user_id=excluded.updated_by_user_id,updated_at=now()`,[input.companyId,input.locationId,input.catalogPartId,input.reuseAllowed,input.evidence,input.actorId]);
      await audit(client,input,"configure_policy",null,{catalogPartId:input.catalogPartId,before:before.rows[0] || null,reuseAllowed:input.reuseAllowed,evidence:input.evidence});
    }
    return {saved:true};
  });
}
