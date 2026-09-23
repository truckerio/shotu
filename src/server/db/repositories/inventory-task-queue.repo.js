import { createHash } from 'node:crypto';
import { getPool } from '../pool.js';
import { InventoryError, inventoryNotFound } from '../../modules/inventory/inventory.errors.js';
import { canApprovePurchase, readApprovalPolicy } from './purchase-approval-settings.repo.js';
import { canAccessInventoryReuseModule } from './inventory-reuse.repo.js';

const PAGE_SIZE = 25;
const stableHash = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const changed = () => new InventoryError('This task changed. Refresh My work and try again.', { code: 'INVENTORY_TASK_SOURCE_STALE', statusCode: 409, retryable: true });
const assignmentChanged = () => new InventoryError('Task ownership changed. Refresh My work and try again.', { code: 'INVENTORY_TASK_ASSIGNMENT_STALE', statusCode: 409, retryable: true });
const forbidden = () => new InventoryError('You do not have access to this inventory task.', { code: 'INVENTORY_TASK_FORBIDDEN', statusCode: 403 });
const conflict = () => new InventoryError('This task is already assigned.', { code: 'INVENTORY_TASK_ALREADY_ASSIGNED', statusCode: 409 });
const replayChanged = () => new InventoryError('This command key was already used for a different assignment request.', { code: 'INVENTORY_TASK_IDEMPOTENCY_CONFLICT', statusCode: 409 });

const projection = `with task_source as (
  select t.company_id,t.location_id,'damage_inspection'::text source_type,t.id source_id,
    coalesce(p.part_number,'Part') source_label,t.created_at,t.version::text source_version,
    case t.status when 'inspection' then 'Inspect damaged stock' when 'repair' then 'Repair in progress'
      when 'awaiting_approval' then 'Approval required' else 'Resolve damaged stock' end status_label,
    case t.status when 'inspection' then 'Inspect condition' when 'repair' then 'Complete repair'
      when 'awaiting_approval' then 'Approve disposition' else 'Review damage' end next_action,
    null::text blocker,'resolve_damage'::text capability,array['resolve_damage']::text[] capability_options,'office'::text required_role,
    '/?view=inventory&adminView=inventory&inventorySection=tasks&taskOwner=damage&taskId='||t.id::text||'&taskLocation='||t.location_id::text deep_link
  from inventory_stock_tasks t join parts_catalog p on p.company_id=t.company_id and p.id=t.catalog_part_id
  where t.kind='damage' and t.status not in ('released','scrapped','cancelled')
  union all
  select d.company_id,d.location_id,'receipt_exception',d.id,
    coalesce(o.number,coalesce(nullif(d.reference,''),'Delivery')),
    d.created_at,md5(concat_ws('|',d.status,d.reference,string_agg(concat_ws(':',l.id,l.outcome,l.expected_quantity,l.actual_quantity,l.usable_quantity,l.held_quantity,l.rejected_quantity,l.reason),'|' order by l.id))),
    'Receipt exception','Review received condition',
    string_agg(distinct case l.outcome when 'shortage' then 'Quantity is short' when 'wrong_item' then 'Wrong item received'
      when 'rejected' then 'Rejected stock needs disposition' else 'Held stock needs review' end,'; ' order by case l.outcome when 'shortage' then 'Quantity is short' when 'wrong_item' then 'Wrong item received' when 'rejected' then 'Rejected stock needs disposition' else 'Held stock needs review' end),
    'resolve_receipt_exception',array['resolve_receipt_exception']::text[],'office',
    '/?view=inventory&adminView=inventory&inventorySection=inbound&deliveryId='||d.id::text
  from inventory_purchase_deliveries d
  left join inventory_purchase_orders o on o.company_id=d.company_id and o.id=d.order_id
  join inventory_purchase_delivery_lines l on l.company_id=d.company_id and l.delivery_id=d.id
  where d.status='posted' and l.outcome<>'accepted'
  group by d.company_id,d.location_id,d.id,o.number,d.reference,d.created_at
  union all
  select r.company_id,r.location_id,'missing_invoice',r.id,
    'Direct receipt '||left(r.id::text,8),r.posted_at,r.xmin::text,
    'Invoice missing','Attach supplier invoice','No supplier invoice is linked',
    'attach_invoice',array['attach_invoice']::text[],'office','/?view=inventory&adminView=inventory&inventorySection=inbound&receiptId='||r.id::text
  from local_inventory_receipts r
  where r.status='posted' and r.source_type='direct' and r.invoice_run_id is null
  union all
  select run.company_id,run.location_id,'invoice_po_decision',run.id,
    coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft)#>>'{invoiceNumber,value}',''),run.file_name),
    coalesce(run.reviewed_at,run.created_at),run.version::text,
    'Invoice needs a purchase decision','Match PO or continue without PO','No purchase order is linked',
    'resolve_invoice_po',array['resolve_invoice_po']::text[],'office','/?view=inventory&adminView=inventory&inventorySection=inbound&invoiceRun='||run.id::text
  from invoice_extraction_runs run
  where run.status='reviewed'
    and not exists(select 1 from inventory_purchase_invoice_allocations a where a.company_id=run.company_id and a.invoice_run_id=run.id and a.status<>'released')
    and not exists(select 1 from local_inventory_receipts r where r.company_id=run.company_id and r.invoice_run_id=run.id and r.status='posted')
  union all
  select a.company_id,a.location_id,'no_po_approval',a.id,
    coalesce(nullif(a.original_command#>>'{partNumber}',''),'No-PO arrival'),a.created_at,a.version::text,
    'No-PO arrival awaiting approval','Approve or reject arrival','Stock is unchanged until approval',
    'approve_no_po',array['approve_no_po']::text[],'office','/?view=inventory&adminView=inventory&inventorySection=inbound&approvalId='||a.id::text
  from inventory_direct_receipt_approval_requests a where a.status='pending'
  union all
  select t.company_id,owner.location_id,'transfer_receipt',t.id,
    coalesce(p.part_number,'Transfer'),t.created_at,t.version::text,
    case when t.transfer_state='returning' then 'Transfer returning to source'
      when t.status='in_transit' then 'Transfer ready to receive' else 'Transfer discrepancy needs review' end,
    case when t.transfer_state='returning' then 'Confirm source return'
      when t.status='in_transit' then 'Receive at destination' else 'Resolve transfer discrepancy' end,
    case when exceptions.open_count>0 then 'Unresolved transfer discrepancy'
      when t.transfer_state='returning' then 'Confirm actual parts and source storage location' else 'Destination receipt is required' end,
    case when t.transfer_state='returning' then 'receive_transfer_return' when t.status='in_transit' then 'receive_transfer' else 'resolve_transfer_discrepancy' end,
    array[case when t.transfer_state='returning' then 'receive_transfer_return' when t.status='in_transit' then 'receive_transfer' else 'resolve_transfer_discrepancy' end]::text[],
    case when t.status='in_transit' then 'office' else 'admin' end,
    '/?view=inventory&adminView=inventory&inventorySection=tasks&taskOwner=transfer&taskId='||t.id::text||'&taskLocation='||owner.location_id::text
  from inventory_stock_tasks t join parts_catalog p on p.company_id=t.company_id and p.id=t.catalog_part_id
  cross join lateral (select count(*) open_count from inventory_transfer_discrepancies d where d.company_id=t.company_id and d.task_id=t.id and d.status='open') exceptions
  cross join lateral (select case when t.transfer_state='returning' then t.location_id else t.destination_id end location_id) owner
  where t.kind='transfer' and (t.status='in_transit' or exceptions.open_count>0)
  union all
  select s.company_id,s.location_id,'position_recount',s.id,
    coalesce(pos.code,pos.name,'Position'),s.updated_at,s.version::text,
    'Physical count needs recount','Restart physical count','Stock changed after the count began',
    'count_inventory',array['count_inventory']::text[],'office','/?view=inventory&adminView=inventory&inventorySection=stock&stockMode=location&taskOwner=recount&positionId='||s.position_id::text||'&taskLocation='||s.location_id::text
  from inventory_position_count_sessions s join inventory_positions pos on pos.company_id=s.company_id and pos.id=s.position_id
  where s.status='needs_recount'
  union all
  select s.company_id,s.location_id,'position_count_review',s.id,
    coalesce(pos.code,pos.name,'Position'),coalesce(s.submitted_at,s.updated_at),s.version::text,
    'Physical count needs review','Review count differences','Inventory is unchanged until an Admin reconciles this count',
    'approve_count',array['approve_count']::text[],'admin','/?view=inventory&adminView=inventory&inventorySection=stock&stockMode=location&taskOwner=count_review&positionId='||s.position_id::text||'&taskLocation='||s.location_id::text
  from inventory_position_count_sessions s join inventory_positions pos on pos.company_id=s.company_id and pos.id=s.position_id
  where s.status='ready' and (
    exists(select 1 from inventory_position_count_lines line where line.company_id=s.company_id and line.session_id=s.id and line.observed_quantity<>line.expected_quantity)
    or exists(select 1 from inventory_position_count_unit_snapshots unit where unit.company_id=s.company_id and unit.session_id=s.id and unit.observed_at is null)
  )
  union all
  select c.company_id,c.location_id,'removed_part_custody',c.id,
    coalesce(u.serial_number,'Removed part'),c.created_at,c.case_version::text,
    case c.status when 'awaiting_handoff' then 'Removed part awaiting handoff' when 'received_pending_review' then 'Removed part needs inspection'
      when 'repair_complete_pending_review' then 'Repair needs review' when 'scrap_pending_approval' then 'Scrap needs approval' else 'Removed part custody action' end,
    case c.status when 'awaiting_handoff' then 'Receive removed part' when 'received_pending_review' then 'Inspect and route'
      when 'hold' then 'Route held part' when 'repair' then 'Manage repair' when 'repair_complete_pending_review' then 'Review repaired part'
      when 'core_pending_return' then 'Complete core return' when 'scrap_pending_approval' then 'Approve disposition'
      when 'quarantine' then 'Resolve quarantine' else 'Continue custody workflow' end,
    case when c.ownership='unknown' then 'Ownership evidence is required' else null end,
    case c.status when 'awaiting_handoff' then 'receive' when 'received_pending_review' then 'route' when 'hold' then 'route'
      when 'repair' then 'repair' when 'repair_complete_pending_review' then 'release'
      when 'core_pending_return' then 'disposition' when 'scrap_pending_approval' then 'disposition'
      when 'quarantine' then 'quarantine' else 'route' end,
    case c.status when 'awaiting_handoff' then array['receive']::text[]
      when 'received_pending_review' then array['route','release','quarantine']::text[]
      when 'hold' then array['route','release','quarantine']::text[]
      when 'repair' then array['repair']::text[]
      when 'repair_complete_pending_review' then array['route','release','quarantine']::text[]
      when 'core_pending_return' then array['disposition']::text[]
      when 'scrap_pending_approval' then array['disposition']::text[]
      when 'quarantine' then array['route','quarantine']::text[] else array['route']::text[] end,
    'office','/?view=inventory&adminView=inventory&inventorySection=tasks&taskOwner=custody&reuseCaseId='||c.id::text||'&taskLocation='||c.location_id::text
  from inventory_reuse_cases c join inventory_serialized_units u on u.company_id=c.company_id and u.id=c.unit_id
  where c.status not in ('released','core_returned','scrapped')
)
select source.*,location.name location_name,assignment.assigned_user_id,profile.display_name assigned_user_name,
  coalesce(assignment.version,0) assignment_version,assignment.updated_at assignment_updated_at
from task_source source
join locations location on location.company_id=source.company_id and location.id=source.location_id and location.active=true
left join inventory_task_assignments assignment on assignment.company_id=source.company_id and assignment.source_type=source.source_type and assignment.source_id=source.source_id
left join user_profiles profile on profile.id=assignment.assigned_user_id`;

function mapTask(row, actor = {}) {
  const assigned = row.assigned_user_id ? { kind: 'user', userId: row.assigned_user_id, displayName: row.assigned_user_name } : null;
  const deepLink = row.deep_link;
  const capabilityOptions = row.capability_options || [row.capability];
  const custodyActionLabels = { receive: 'Receive removed part', route: 'Route part', release: 'Release or hold', repair: 'Manage repair', disposition: 'Complete disposition', quarantine: 'Resolve quarantine' };
  const actorCapabilityOptions = row.source_type === 'removed_part_custody'
    ? (actor.capabilityOptions || []).filter((capability) => capabilityOptions.includes(capability))
    : [];
  const selectedCapability = actorCapabilityOptions[0] || row.capability;
  const selectedNextAction = row.source_type === 'removed_part_custody' && actorCapabilityOptions.length
    ? custodyActionLabels[selectedCapability]
    : row.next_action;
  return {
    id: `${row.source_type}:${row.source_id}`,
    sourceType: row.source_type,
    sourceId: row.source_id,
    sourceLabel: row.source_label,
    createdAt: new Date(row.created_at).toISOString(),
    ageSeconds: Math.max(0, Math.floor((Date.now() - new Date(row.created_at).getTime()) / 1000)),
    location: { id: row.location_id, name: row.location_name },
    shop: { id: row.location_id, name: row.location_name },
    owner: assigned || { kind: 'capability', capability: selectedCapability, capabilityOptions, role: row.required_role },
    assignedUser: assigned,
    state: 'open',
    statusLabel: row.status_label,
    nextAction: selectedNextAction,
    blocker: row.blocker || null,
    sourceVersion: String(row.source_version),
    assignmentVersion: Number(row.assignment_version),
    capability: selectedCapability,
    capabilityOptions,
    nextActionOptions: row.source_type === 'removed_part_custody'
      ? capabilityOptions.map((capability) => ({ capability, label: custodyActionLabels[capability] }))
      : [{ capability: row.capability, label: row.next_action }],
    role: row.required_role,
    deepLink,
    actionTarget: { sourceType: row.source_type, sourceId: row.source_id, locationId: row.location_id, deepLink },
    evidence: { sourceVersion: String(row.source_version), assignmentUpdatedAt: row.assignment_updated_at ? new Date(row.assignment_updated_at).toISOString() : null },
    actions: {
      canClaim: Boolean(actor.canAct) && !row.assigned_user_id,
      canAssign: Boolean(actor.canAct) && ['office','admin'].includes(actor.role),
      canUnassign: Boolean(actor.canAct) && Boolean(row.assigned_user_id) && (row.assigned_user_id === actor.id || ['office','admin'].includes(actor.role)),
    },
  };
}

async function eligible(client, input, task, userId) {
  if (task.source_type === 'no_po_approval') {
    const policy = await readApprovalPolicy(client, task.company_id);
    if (!policy || !(await canApprovePurchase(client, task.company_id, userId, policy))) return { eligible: false, capabilityOptions: [] };
    const locationAccess = await client.query(`select membership.role
      from user_profiles profile
      join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$2 and membership.active
      left join user_location_memberships location_membership on location_membership.user_id=profile.id and location_membership.company_id=$2
        and location_membership.location_id=$3 and location_membership.active
      where profile.id=$1 and profile.active and profile.deleted_at is null
        and (membership.role='admin' or location_membership.user_id is not null)`,
    [userId, task.company_id, task.location_id]);
    return { eligible: Boolean(locationAccess.rows[0]), capabilityOptions: [] };
  }
  const result = await client.query(`select membership.role,
      case when $6::boolean then array(select option.capability from unnest($5::text[]) with ordinality option(capability,ordinality)
        where exists(select 1 from inventory_reuse_capability_grants grant_row where grant_row.company_id=$2 and grant_row.location_id=$3
          and grant_row.user_id=$1 and grant_row.capability=option.capability) order by option.ordinality) else array[]::text[] end capability_options
    from user_profiles profile
    join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$2 and membership.active
    left join user_location_memberships location_membership on location_membership.user_id=profile.id and location_membership.company_id=$2 and location_membership.location_id=$3 and location_membership.active
    where profile.id=$1 and profile.active and profile.deleted_at is null
      and (membership.role='admin' or (location_membership.user_id is not null and $4<>'admin' and (membership.role='office' or membership.role=$4)))
      and ($6::boolean=false or exists(
        select 1 from inventory_reuse_capability_grants grant_row where grant_row.company_id=$2 and grant_row.location_id=$3 and grant_row.user_id=$1
          and grant_row.capability=any($5::text[])))`,
  [userId, task.company_id, task.location_id, task.required_role, task.capability_options || [task.capability], task.source_type === 'removed_part_custody']);
  const row=result.rows[0];
  if (!row) return { eligible:false,capabilityOptions:[] };
  const moduleAllowed = task.source_type !== 'removed_part_custody' || await canAccessInventoryReuseModule(client,{companyId:task.company_id,locationId:task.location_id,actorId:userId},row.role,true);
  return { eligible: moduleAllowed, capabilityOptions: moduleAllowed ? row.capability_options || [] : [] };
}

async function lockSourceOwner(client, input) {
  const params = [input.companyId, input.locationId, input.sourceId];
  const queries = {
    damage_inspection: `select id from inventory_stock_tasks
      where company_id=$1 and location_id=$2 and id=$3 and kind='damage' for update`,
    receipt_exception: `select id from inventory_purchase_deliveries
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    missing_invoice: `select id from local_inventory_receipts
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    invoice_po_decision: `select id from invoice_extraction_runs
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    no_po_approval: `select id from inventory_direct_receipt_approval_requests
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    transfer_receipt: `select id from inventory_stock_tasks
      where company_id=$1 and (location_id=$2 or destination_id=$2) and id=$3 and kind='transfer' for update`,
    position_recount: `select id from inventory_position_count_sessions
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    position_count_review: `select id from inventory_position_count_sessions
      where company_id=$1 and location_id=$2 and id=$3 for update`,
    removed_part_custody: `select id from inventory_reuse_cases
      where company_id=$1 and location_id=$2 and id=$3 for update`,
  };
  const sql = queries[input.sourceType];
  if (!sql) return false;
  const owner = await client.query(sql, params);
  if (!owner.rows[0]) return false;
  if (input.sourceType === 'receipt_exception') {
    // The projection version includes every exception line. Lock the header
    // first, matching the delivery-line FK/trigger order, then the line set.
    await client.query(`select id from inventory_purchase_delivery_lines
      where company_id=$1 and delivery_id=$2 order by id for update`, [input.companyId, input.sourceId]);
  }
  return true;
}

async function readSource(client, input) {
  const result = await client.query(`${projection} where source.company_id=$1 and source.location_id=$2 and source.source_type=$3 and source.source_id=$4`,
    [input.companyId, input.locationId, input.sourceType, input.sourceId]);
  return result.rows[0] || null;
}

export async function listInventoryTaskQueue(input) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const offset = (input.page - 1) * PAGE_SIZE;
    const approvalCompanyIds=[];
    for(const companyId of input.companyIds){
      const policy=await readApprovalPolicy(client,companyId);
      if(policy && await canApprovePurchase(client,companyId,input.actorId,policy)) approvalCompanyIds.push(companyId);
    }
    const actorScopes=(await client.query(`select location.id location_id,location.company_id,membership.role from locations location
      join user_company_memberships membership on membership.company_id=location.company_id and membership.user_id=$1 and membership.active
      join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null
      where location.active and location.company_id=any($2::uuid[]) and location.id=any($3::uuid[])`,[input.actorId,input.companyIds,input.locationIds])).rows;
    const reuseModuleLocationIds=[];
    for(const scope of actorScopes)if(await canAccessInventoryReuseModule(client,{companyId:scope.company_id,locationId:scope.location_id,actorId:input.actorId},scope.role,true))reuseModuleLocationIds.push(scope.location_id);
    const assignedScopes=(await client.query(`select distinct assignment.assigned_user_id user_id,reuse.company_id,reuse.location_id,membership.role
      from inventory_task_assignments assignment join inventory_reuse_cases reuse on reuse.company_id=assignment.company_id and reuse.id=assignment.source_id
      join user_company_memberships membership on membership.company_id=reuse.company_id and membership.user_id=assignment.assigned_user_id and membership.active
      join user_profiles profile on profile.id=membership.user_id and profile.active and profile.deleted_at is null
      where assignment.source_type='removed_part_custody' and assignment.assigned_user_id is not null
        and reuse.company_id=any($1::uuid[]) and reuse.location_id=any($2::uuid[])`,[input.companyIds,input.locationIds])).rows;
    const assignedModuleKeys=[];
    for(const scope of assignedScopes)if(await canAccessInventoryReuseModule(client,{companyId:scope.company_id,locationId:scope.location_id,actorId:scope.user_id},scope.role,true))assignedModuleKeys.push(`${scope.user_id}:${scope.location_id}`);
    const result = await client.query(`select queue.*,actor_membership.role actor_role,permission.reuse_capabilities actor_reuse_capabilities,
        case when queue.source_type='no_po_approval' then queue.company_id=any($9::uuid[])
          when queue.source_type in ('removed_part_custody') then permission.can_reuse
          else permission.can_work end actor_can_act
      from (${projection}) queue
      join user_profiles actor_profile on actor_profile.id=$6 and actor_profile.active and actor_profile.deleted_at is null
      join user_company_memberships actor_membership on actor_membership.user_id=$6 and actor_membership.company_id=queue.company_id
        and actor_membership.active and actor_membership.role in ('office','admin')
      left join user_location_memberships actor_location on actor_location.user_id=$6 and actor_location.company_id=queue.company_id
        and actor_location.location_id=queue.location_id and actor_location.active
      left join inventory_purchase_approval_settings approval_policy on approval_policy.company_id=queue.company_id
      cross join lateral (select
        (actor_membership.role='admin' or actor_membership.role='office' and queue.required_role<>'admin') can_work,
        matched.reuse_capabilities,
        cardinality(matched.reuse_capabilities)>0 and queue.location_id=any($10::uuid[]) can_reuse
        from (select array(select option.capability from unnest(queue.capability_options) with ordinality option(capability,ordinality)
          where exists(select 1 from inventory_reuse_capability_grants grant_row
            where grant_row.company_id=queue.company_id and grant_row.location_id=queue.location_id and grant_row.user_id=$6
              and grant_row.capability=option.capability) order by option.ordinality) reuse_capabilities) matched
      ) permission
      where queue.company_id=any($1::uuid[]) and queue.location_id=any($2::uuid[])
        and (actor_membership.role='admin' or actor_location.user_id is not null)
        and ($3::text is null or queue.source_type=$3)
        and ($4::text is null or queue.source_label ilike '%'||$4||'%' or queue.location_name ilike '%'||$4||'%')
        and (queue.source_type<>'no_po_approval' or queue.company_id=any($9::uuid[]))
        and (queue.source_type<>'removed_part_custody' or permission.can_reuse)
        and ($5::boolean=false or
          (queue.source_type='no_po_approval' and queue.company_id=any($9::uuid[]) and (
            queue.assigned_user_id=$6 or queue.assigned_user_id is null or not exists(
              select 1 from user_profiles assigned_profile
              join user_company_memberships assigned_membership on assigned_membership.user_id=assigned_profile.id
                and assigned_membership.company_id=queue.company_id and assigned_membership.active and assigned_membership.role in ('office','admin')
              where assigned_profile.id=queue.assigned_user_id and assigned_profile.active and assigned_profile.deleted_at is null
                and approval_policy.company_id is not null and
                  (assigned_profile.id=any(approval_policy.approver_user_ids) or assigned_membership.role=any(approval_policy.approver_roles))
                and (assigned_membership.role='admin' or exists(
                  select 1 from user_location_memberships assigned_location
                  where assigned_location.user_id=assigned_profile.id and assigned_location.company_id=queue.company_id
                    and assigned_location.location_id=queue.location_id and assigned_location.active
                ))
            ))) or
          (queue.source_type='removed_part_custody' and permission.can_reuse and (
            queue.assigned_user_id=$6 or queue.assigned_user_id is null or not exists(
              select 1 from user_profiles assigned_profile
              join user_company_memberships assigned_membership on assigned_membership.user_id=assigned_profile.id
                and assigned_membership.company_id=queue.company_id and assigned_membership.active and assigned_membership.role in ('office','admin')
              left join user_location_memberships assigned_location on assigned_location.user_id=assigned_profile.id
                and assigned_location.company_id=queue.company_id and assigned_location.location_id=queue.location_id and assigned_location.active
              where assigned_profile.id=queue.assigned_user_id and assigned_profile.active and assigned_profile.deleted_at is null
                and (assigned_membership.role='admin' or assigned_location.user_id is not null)
                and (assigned_profile.id::text||':'||queue.location_id::text)=any($11::text[])
                and exists(select 1 from inventory_reuse_capability_grants assigned_grant
                  where assigned_grant.company_id=queue.company_id and assigned_grant.location_id=queue.location_id
                    and assigned_grant.user_id=assigned_profile.id and assigned_grant.capability=any(queue.capability_options))
            )
          )) or
          (queue.source_type not in ('no_po_approval','removed_part_custody') and
            permission.can_work and (queue.assigned_user_id=$6 or queue.assigned_user_id is null or
              (queue.source_type='transfer_receipt' and not exists(
                select 1 from user_profiles assigned_profile join user_company_memberships assigned_membership
                 on assigned_membership.user_id=assigned_profile.id and assigned_membership.company_id=queue.company_id and assigned_membership.active
                where assigned_profile.id=queue.assigned_user_id and assigned_profile.active and assigned_profile.deleted_at is null
                 and (assigned_membership.role='admin' or (assigned_membership.role='office' and queue.required_role<>'admin' and exists(
                  select 1 from user_location_memberships membership where membership.user_id=assigned_profile.id and membership.company_id=queue.company_id and membership.location_id=queue.location_id and membership.active
                 )))
              )))))
      order by queue.created_at,queue.source_type,queue.source_id limit $7 offset $8`,
    [input.companyIds, input.locationIds, input.sourceType || null, input.search || null, input.view === 'my_work', input.actorId, PAGE_SIZE + 1, offset, approvalCompanyIds,reuseModuleLocationIds,assignedModuleKeys]);
    const response = {
      items: result.rows.slice(0, PAGE_SIZE).map((row) => mapTask(row, { id: input.actorId, role: row.actor_role, canAct: row.actor_can_act, capabilityOptions: row.actor_reuse_capabilities })),
      page: input.page,pageSize: PAGE_SIZE,hasMore: result.rows.length > PAGE_SIZE,
      capabilities: { canClaim: true, canAssign: true, canUnassign: true },
    };
    await client.query('commit');return response;
  } catch(error){await client.query('rollback').catch(()=>{});throw error;} finally { client.release(); }
}

export async function readInventoryTask(input) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const row = await readSource(client, input);
    if (!row){await client.query('commit');return null;}
    const access = await eligible(client,input,row,input.actorId);
    if (['no_po_approval','removed_part_custody'].includes(row.source_type) && !access.eligible){await client.query('commit');return null;}
    const task=mapTask(row, { id: input.actorId, role: input.actorRole, canAct: access.eligible, capabilityOptions: access.capabilityOptions });
    await client.query('commit');return task;
  }
  catch(error){await client.query('rollback').catch(()=>{});throw error;} finally { client.release(); }
}

export async function mutateInventoryTaskAssignment(input) {
  const client = await getPool().connect();
  const requestHash = stableHash({ action: input.action, sourceType: input.sourceType, sourceId: input.sourceId,
    sourceVersion: input.sourceVersion, expectedAssignmentVersion: input.expectedAssignmentVersion,
    assignedUserId: input.assignedUserId || null, reason: input.reason });
  try {
    await client.query('begin');
    await client.query('select pg_advisory_xact_lock(hashtextextended($1,0))', [`${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);
    const replay = await client.query('select request_hash,result from inventory_task_assignment_commands where company_id=$1 and actor_id=$2 and idempotency_key=$3 for update', [input.companyId, input.actorId, input.idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_hash !== requestHash) throw replayChanged();
      await client.query('commit'); return replay.rows[0].result;
    }
    const preliminarySource = await readSource(client, input);
    if (!preliminarySource) throw inventoryNotFound();
    if (String(preliminarySource.source_version) !== String(input.sourceVersion)) throw changed();
    const preliminaryActorAccess = await eligible(client, input, preliminarySource, input.actorId);
    if (!preliminaryActorAccess.eligible) throw forbidden();
    if (input.action === 'assign') {
      if (input.actorRole !== 'admin' && input.actorRole !== 'office') throw forbidden();
      const preliminaryTargetAccess = await eligible(client, input, preliminarySource, input.assignedUserId);
      if (!preliminaryTargetAccess.eligible) throw forbidden();
    }
    if (!(await lockSourceOwner(client, input))) throw inventoryNotFound();
    const source = await readSource(client, input);
    if (!source || String(source.source_version) !== String(input.sourceVersion)) throw changed();
    const actorAccess = await eligible(client, input, source, input.actorId);
    if (!actorAccess.eligible) throw forbidden();
    let targetUserId = null;
    if (input.action === 'claim') targetUserId = input.actorId;
    if (input.action === 'assign') {
      targetUserId = input.assignedUserId;
      const targetAccess = await eligible(client, input, source, targetUserId);
      if (!targetAccess.eligible) throw forbidden();
    }
    const current = await client.query('select * from inventory_task_assignments where company_id=$1 and source_type=$2 and source_id=$3 for update', [input.companyId, input.sourceType, input.sourceId]);
    const prior = current.rows[0] || null;
    if (Number(prior?.version || 0) !== input.expectedAssignmentVersion) throw assignmentChanged();
    if (input.action === 'claim' && prior?.assigned_user_id && prior.assigned_user_id !== input.actorId) throw conflict();
    const version = Number(prior?.version || 0) + 1;
    await client.query(`insert into inventory_task_assignments(company_id,location_id,source_type,source_id,capability,required_role,assigned_user_id,version,assigned_by)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9)
      on conflict(company_id,source_type,source_id) do update set location_id=excluded.location_id,capability=excluded.capability,
        required_role=excluded.required_role,assigned_user_id=excluded.assigned_user_id,version=excluded.version,assigned_by=excluded.assigned_by,updated_at=now()`,
    [input.companyId, input.locationId, input.sourceType, input.sourceId, source.capability, source.required_role, targetUserId, version, input.actorId]);
    await client.query(`insert into inventory_task_assignment_events(company_id,location_id,source_type,source_id,actor_id,action,from_user_id,to_user_id,assignment_version,reason)
      values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`, [input.companyId, input.locationId, input.sourceType, input.sourceId, input.actorId, input.action, prior?.assigned_user_id || null, targetUserId, version, input.reason]);
    const refreshed = await readSource(client, input);
    const result = { task: mapTask(refreshed, { id: input.actorId, role: input.actorRole, canAct: true, capabilityOptions: actorAccess.capabilityOptions }) };
    await client.query(`insert into inventory_task_assignment_commands(company_id,actor_id,idempotency_key,request_hash,action,source_type,source_id,result)
      values($1,$2,$3,$4,$5,$6,$7,$8::jsonb)`, [input.companyId, input.actorId, input.idempotencyKey, requestHash, input.action, input.sourceType, input.sourceId, JSON.stringify(result)]);
    await client.query('commit'); return result;
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
