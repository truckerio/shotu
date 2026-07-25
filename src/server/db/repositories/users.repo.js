import { getPool, query } from "../pool.js";

export async function listUsersByRole(role) {
  const result = await query(
    `
      select id, name, email, phone, role, location_id, active, created_at, updated_at
      from app_users
      where active = true
        and deleted_at is null
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
            auth_user.username,
            membership.active as membership_active, membership.created_at
       from user_location_memberships membership
       join app_users app_user on app_user.id = membership.user_id
       left join auth_user on auth_user.id = app_user.auth_user_id
      where membership.location_id = $1
        and app_user.deleted_at is null
      order by membership.active desc, app_user.name`,
    [locationId],
  );
  return result.rows;
}

export async function getManagedUser(locationId, userId, companyIds) {
  const result = await query(
    `select app_user.id, app_user.name, app_user.email, app_user.role, app_user.active,
            app_user.auth_user_id, app_user.deleted_at, auth_user.username,
            membership.active as membership_active,
            location.company_uuid as company_id,
            coalesce((
              select array_agg(company_membership.company_uuid order by company_membership.company_uuid)
              from user_company_memberships company_membership
              where company_membership.user_id = app_user.id
            ), array[]::uuid[]) as company_ids
       from user_location_memberships membership
       join locations location on location.id = membership.location_id
       join app_users app_user on app_user.id = membership.user_id
       left join auth_user on auth_user.id = app_user.auth_user_id
      where membership.location_id = $1
        and app_user.id = $2
        and location.company_uuid = any($3::uuid[])
        and app_user.deleted_at is null
      limit 1`,
    [locationId, userId, companyIds],
  );
  return result.rows[0] || null;
}

export async function setManagedUserActive({
  userId,
  companyId,
  locationId,
  active,
  actorId,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const locked = await client.query(
      "select id from app_users where id = $1 and deleted_at is null for update",
      [userId],
    );
    if (!locked.rows[0]) throw new Error("User not found.");

    if (active) {
      await client.query(
        `update user_company_memberships
            set active = true, updated_at = now()
          where user_id = $1 and company_uuid = $2`,
        [userId, companyId],
      );
      await client.query(
        `update user_location_memberships
            set active = true, updated_at = now()
          where user_id = $1 and location_id = $2 and company_uuid = $3`,
        [userId, locationId, companyId],
      );
    } else {
      await client.query(
        "update user_company_memberships set active = false, updated_at = now() where user_id = $1",
        [userId],
      );
      await client.query(
        "update user_location_memberships set active = false, updated_at = now() where user_id = $1",
        [userId],
      );
    }
    const updated = await client.query(
      `update app_users app_user
          set active = exists (
                select 1
                from user_company_memberships company_membership
                where company_membership.user_id = app_user.id
                  and company_membership.active
              ),
              updated_at = now()
        where app_user.id = $1
        returning app_user.active`,
      [userId],
    );
    await client.query(
      `insert into admin_user_events (company_id, actor_user_id, target_user_id, action)
       values ($1, $2, $3, $4)`,
      [companyId, actorId, userId, active ? "activated" : "deactivated"],
    );
    await client.query("commit");
    return { active: updated.rows[0].active };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function recordAdminUserEvent({
  companyId,
  actorId,
  targetUserId,
  action,
  details = {},
}) {
  await query(
    `insert into admin_user_events (
       company_id, actor_user_id, target_user_id, action, details
     )
     values ($1, $2, $3, $4, $5::jsonb)`,
    [companyId, actorId, targetUserId, action, JSON.stringify(details)],
  );
}

export async function deleteManagedUser({
  userId,
  companyIds,
  actorId,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select id, auth_user_id
         from app_users
        where id = $1 and deleted_at is null
        for update`,
      [userId],
    );
    const target = result.rows[0];
    if (!target) throw new Error("User not found.");

    await client.query(
      "update user_company_memberships set active = false, updated_at = now() where user_id = $1",
      [userId],
    );
    await client.query(
      "update user_location_memberships set active = false, updated_at = now() where user_id = $1",
      [userId],
    );
    await client.query(
      `update app_users
          set name = 'Deleted user',
              email = null,
              phone = null,
              location_id = null,
              active = false,
              auth_user_id = null,
              deleted_at = now(),
              updated_at = now()
        where id = $1`,
      [userId],
    );
    for (const companyId of companyIds) {
      await client.query(
        `insert into admin_user_events (
           company_id, actor_user_id, target_user_id, action
         )
         values ($1, $2, $3, 'deleted')`,
        [companyId, actorId, userId],
      );
    }
    if (target.auth_user_id) {
      await client.query("delete from auth_user where id = $1", [target.auth_user_id]);
    }
    await client.query("commit");
    return { deleted: true };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
