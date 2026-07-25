import { query } from "../pool.js";

export async function getAuthActorByAuthUserId(authUserId) {
  const result = await query(
    `
      select
        u.id,
        u.auth_user_id,
        u.display_name,
        u.contact_email,
        u.phone,
        u.active,
        (select role from v_user_primary_role where user_id = u.id) as role,
        (
          select ulm.location_id
          from user_location_memberships ulm
          where ulm.user_id = u.id and ulm.active = true
          order by ulm.created_at, ulm.location_id
          limit 1
        ) as location_id,
        coalesce((
          select array_agg(ulm.location_id order by ulm.location_id)
          from user_location_memberships ulm
          where ulm.user_id = u.id and ulm.active = true
        ), array[]::uuid[]) as location_ids,
        coalesce((
          select jsonb_agg(
            jsonb_build_object('companyId', ucm.company_id, 'role', ucm.role)
            order by ucm.company_id
          )
          from user_company_memberships ucm
          where ucm.user_id = u.id and ucm.active = true
        ), '[]'::jsonb) as company_memberships
      from user_profiles u
      where u.auth_user_id = $1
        and u.deleted_at is null
      limit 1
    `,
    [authUserId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const companyMemberships = row.company_memberships || [];
  return {
    id: row.id,
    authUserId: row.auth_user_id,
    name: row.display_name,
    email: row.contact_email,
    phone: row.phone,
    role: row.role,
    locationId: row.location_id,
    locationIds: row.location_ids || [],
    companyIds: companyMemberships.map((membership) => membership.companyId),
    companyMemberships,
    active: row.active,
  };
}

export async function findAuthUserByEmail(email) {
  const result = await query("select id from auth_user where lower(email) = lower($1) limit 1", [email]);
  return result.rows[0] || null;
}
