import { getPool } from '../pool.js';
import { InventoryError, inventoryNotFound } from '../../modules/inventory/inventory.errors.js';

export async function readApprovalPolicy(client, companyId, lock = false) {
  // Serialize placement and settings changes, including the first configuration.
  if (lock) await client.query('select pg_advisory_xact_lock(hashtext($1))', [`po-approval:${companyId}`]);
  const result = await client.query('select * from inventory_purchase_approval_settings where company_id=$1', [companyId]);
  return result.rows[0] || null;
}

export async function canApprovePurchase(client, companyId, actorId, policy) {
  if (!policy) return false;
  const result = await client.query(`select m.role from user_company_memberships m
    join user_profiles p on p.id=m.user_id
    where m.company_id=$1 and m.user_id=$2 and m.active and p.active and p.deleted_at is null
      and m.role in ('office','admin')`, [companyId, actorId]);
  return result.rows.some(row => policy.approver_user_ids.includes(actorId) || policy.approver_roles.includes(row.role));
}

async function settingsCompany(client, input) {
  const result = await client.query(`select l.company_id from locations l
    join user_company_memberships m on m.company_id=l.company_id and m.user_id=$3 and m.active and m.role='admin'
    join user_profiles p on p.id=m.user_id and p.active and p.deleted_at is null
    where l.id=$1 and l.company_id=any($2::uuid[]) and l.active`, [input.locationId, input.companyIds, input.actorId]);
  if (!result.rows[0]) throw inventoryNotFound();
  return result.rows[0].company_id;
}

async function eligibleUsers(client, companyId) {
  return (await client.query(`select p.id,p.display_name as name,m.role from user_profiles p
    join user_company_memberships m on m.user_id=p.id and m.company_id=$1 and m.active
    where p.active and p.deleted_at is null and m.role in ('office','admin')
    order by p.display_name,p.id`, [companyId])).rows;
}

export async function purchaseApprovalSettings(input, changes = null) {
  const client = await getPool().connect();
  try {
    await client.query('begin');
    const companyId = await settingsCompany(client, input);
    let policy = await readApprovalPolicy(client, companyId, !!changes);
    const users = await eligibleUsers(client, companyId);
    if (changes) {
      if ((policy?.version || 0) !== changes.expectedVersion) throw new InventoryError('These settings changed. Reload and try again.', { code: 'PURCHASE_SETTINGS_CHANGED', statusCode: 409 });
      if (changes.approverUserIds.some(id => !users.some(user => user.id === id))) throw new InventoryError('Select active users from this company.', { code: 'PURCHASE_APPROVER_INVALID', statusCode: 400 });
      if (!users.some(user => changes.approverUserIds.includes(user.id) || changes.approverRoles.includes(user.role))) throw new InventoryError('Select at least one active approver.', { code: 'PURCHASE_APPROVER_REQUIRED', statusCode: 400 });
      policy = (await client.query(`insert into inventory_purchase_approval_settings
        (company_id,approval_limit,currency,approver_user_ids,approver_roles,updated_by)
        values($1,$2,$3,$4,$5,$6) on conflict(company_id) do update set
        approval_limit=excluded.approval_limit,currency=excluded.currency,approver_user_ids=excluded.approver_user_ids,
        approver_roles=excluded.approver_roles,updated_by=excluded.updated_by,
        version=inventory_purchase_approval_settings.version+1,updated_at=now() returning *`,
      [companyId,changes.approvalLimit,changes.currency,changes.approverUserIds,changes.approverRoles,input.actorId])).rows[0];
      await client.query('insert into inventory_purchase_approval_settings_events(company_id,actor_id,details) values($1,$2,$3)', [companyId,input.actorId,JSON.stringify(changes)]);
    }
    await client.query('commit');
    return { companyId, policy, users, roles: [{ id: 'office', name: 'Office' }, { id: 'admin', name: 'Admin' }] };
  } catch (error) { await client.query('rollback').catch(() => {}); throw error; }
  finally { client.release(); }
}
