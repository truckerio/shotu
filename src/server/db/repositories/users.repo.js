import { query } from "../pool.js";

export async function listUsersByRole(role) {
  const result = await query(
    `
      select id, name, email, phone, role, location_id, active, created_at, updated_at
      from app_users
      where active = true
        and ($1::text is null or role = $1)
      order by name asc
    `,
    [role || null]
  );
  return result.rows;
}

export async function getUserById(id) {
  const result = await query(
    `
      select id, name, email, phone, role, location_id, active, created_at, updated_at
      from app_users
      where id = $1
      limit 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

export async function listUsersByLocation(locationId) {
  const result = await query(
    `select app_user.id, app_user.name, app_user.email, app_user.role, app_user.active,
            membership.active as membership_active, membership.created_at
       from user_location_memberships membership
       join app_users app_user on app_user.id = membership.user_id
      where membership.location_id = $1
      order by membership.active desc, app_user.name`,
    [locationId],
  );
  return result.rows;
}
