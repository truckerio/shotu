import { getPool, query } from "../pool.js";
import { DEFAULT_COMPANY_ID } from "../company.js";

export async function listLocations(companyId = DEFAULT_COMPANY_ID) {
  const result = await query(
    `
      select id, company_id, name, type, address, lat, lng, active, created_at, updated_at
      from locations
      where active = true
        and company_id = $1
      order by name asc
    `,
    [companyId || DEFAULT_COMPANY_ID]
  );
  return result.rows;
}

export async function defaultLocation(companyId = DEFAULT_COMPANY_ID) {
  const result = await query(
    `
      select id, company_id, name, type, address, lat, lng, active, created_at, updated_at
      from locations
      where active = true
        and company_id = $1
      order by created_at asc
      limit 1
    `,
    [companyId || DEFAULT_COMPANY_ID]
  );
  return result.rows[0] || null;
}

export async function getLocationById(locationId, companyIds = null) {
  const result = await query(
    `select id, company_id, name, type, address, lat, lng, active, created_at, updated_at
       from locations
      where id = $1
        and ($2::uuid[] is null or company_id = any($2::uuid[]))
      limit 1`,
    [locationId, companyIds?.length ? companyIds : null],
  );
  return result.rows[0] || null;
}

export async function listLocationsWithAdminCounts(companyIds) {
  const result = await query(`
    with user_counts as (
      select location_id, count(*)::integer as user_count
      from user_location_memberships
      where active
      group by location_id
    ),
    workorder_counts as (
      select location_id, count(*)::integer as open_workorder_count
      from operational_workorders
      where status not in ('closed', 'odoo_entered', 'cancelled')
      group by location_id
    ),
    invitation_counts as (
      select location_id, count(*)::integer as pending_invite_count
      from user_invitations
      where status = 'pending'
        and expires_at > now()
      group by location_id
    ),
    template_locations as (
      select distinct location_id
      from location_workorder_templates
      where active
    )
    select
      location.id,
      location.company_id,
      location.name,
      location.type,
      location.address,
      location.active,
      location.created_at,
      coalesce(user_counts.user_count, 0) as user_count,
      coalesce(workorder_counts.open_workorder_count, 0) as open_workorder_count,
      coalesce(invitation_counts.pending_invite_count, 0) as pending_invite_count,
      (template_locations.location_id is not null) as has_template
    from locations location
    left join user_counts on user_counts.location_id = location.id
    left join workorder_counts on workorder_counts.location_id = location.id
    left join invitation_counts on invitation_counts.location_id = location.id
    left join template_locations on template_locations.location_id = location.id
    where location.company_id = any($1::uuid[])
    order by location.active desc, location.name
  `, [companyIds]);
  return result.rows;
}

export async function createLocationWithTemplate({ companyId, name, type, address, actorId }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const location = await client.query(
      `insert into locations (company_id, name, type, address)
       values ($1, $2, $3, nullif($4, ''))
       returning id, company_id, name, type, address, active, created_at, updated_at`,
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
      returning id, company_id, name, type, address, active, created_at, updated_at`,
    [locationId, input.name ?? null, input.type ?? null, input.address ?? null, input.active ?? null],
  );
  return result.rows[0] || null;
}
