import { getPool, query } from "../pool.js";
import { DEFAULT_COMPANY_ID } from "../company.js";

export async function listLocations(companyId = DEFAULT_COMPANY_ID) {
  const result = await query(
    `
      select id, company_uuid as company_id, name, type, address, lat, lng, active, created_at, updated_at
      from locations
      where active = true
        and company_uuid = $1
      order by name asc
    `,
    [companyId || DEFAULT_COMPANY_ID]
  );
  return result.rows;
}

export async function defaultLocation(companyId = DEFAULT_COMPANY_ID) {
  const result = await query(
    `
      select id, company_uuid as company_id, name, type, address, lat, lng, active, created_at, updated_at
      from locations
      where active = true
        and company_uuid = $1
      order by created_at asc
      limit 1
    `,
    [companyId || DEFAULT_COMPANY_ID]
  );
  return result.rows[0] || null;
}

export async function getLocationById(locationId, companyIds = null) {
  const result = await query(
    `select id, company_uuid as company_id, name, type, address, lat, lng, active, created_at, updated_at
       from locations
      where id = $1
        and ($2::uuid[] is null or company_uuid = any($2::uuid[]))
      limit 1`,
    [locationId, companyIds?.length ? companyIds : null],
  );
  return result.rows[0] || null;
}

export async function listLocationsWithAdminCounts(companyIds) {
  const result = await query(`
    select
      location.id,
      location.company_uuid as company_id,
      location.name,
      location.type,
      location.address,
      location.active,
      location.created_at,
      count(distinct membership.user_id) filter (where membership.active) :: integer as user_count,
      count(distinct workorder.id) filter (where workorder.status not in ('closed', 'odoo_entered', 'cancelled')) :: integer as open_workorder_count,
      count(distinct invitation.id) filter (where invitation.status = 'pending' and invitation.expires_at > now()) :: integer as pending_invite_count,
      (template.id is not null) as has_template
    from locations location
    left join user_location_memberships membership on membership.location_id = location.id
    left join operational_workorders workorder on workorder.location_id = location.id
    left join user_invitations invitation on invitation.location_id = location.id
    left join location_workorder_templates template on template.location_id = location.id and template.active
    where location.company_uuid = any($1::uuid[])
    group by location.id, template.id
    order by location.active desc, location.name
  `, [companyIds]);
  return result.rows;
}

export async function createLocationWithTemplate({ companyId, name, type, address, actorId }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const location = await client.query(
      `insert into locations (company_uuid, name, type, address)
       values ($1, $2, $3, nullif($4, ''))
       returning id, company_uuid as company_id, name, type, address, active, created_at, updated_at`,
      [companyId, name, type, address],
    );
    await client.query(
      `insert into location_workorder_templates (location_id, header_title, updated_by_user_id)
       values ($1, $2, $3)`,
      [location.rows[0].id, `${name.toUpperCase()} WORKORDER`, actorId],
    );
    await client.query("commit");
    return location.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function updateLocation(locationId, input) {
  const result = await query(
    `update locations
        set name = coalesce($2, name),
            type = coalesce($3, type),
            address = case when $4::text is null then address else nullif($4, '') end,
            active = coalesce($5, active),
            updated_at = now()
      where id = $1
      returning id, company_uuid as company_id, name, type, address, active, created_at, updated_at`,
    [locationId, input.name ?? null, input.type ?? null, input.address ?? null, input.active ?? null],
  );
  return result.rows[0] || null;
}
