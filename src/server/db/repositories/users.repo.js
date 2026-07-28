import { getPool, query } from "../pool.js";

export async function listUsersByRole(role) {
  const result = await query(
    `
      select *
      from (
        select distinct on (profile.id)
          profile.id,
          profile.display_name as name,
          profile.contact_email as email,
          profile.phone,
          membership.role,
          profile.active,
          profile.created_at,
          profile.updated_at
        from user_profiles profile
        join user_company_memberships membership
          on membership.user_id = profile.id and membership.active
        where profile.active = true
          and profile.deleted_at is null
          and ($1::text is null or membership.role = $1)
        order by profile.id, membership.created_at
      ) users
      order by name
    `,
    [role || null]
  );
  return result.rows;
}

export async function getUserById(id) {
  const result = await query(
    `
      select
        profile.id,
        profile.display_name as name,
        profile.contact_email as email,
        profile.phone,
        role.role,
        profile.active,
        profile.created_at,
        profile.updated_at
      from user_profiles profile
      left join v_user_primary_role role on role.user_id = profile.id
      where profile.id = $1
      limit 1
    `,
    [id]
  );
  return result.rows[0] || null;
}

export async function listUsersByLocation(locationId) {
  const result = await query(
    `select app_user.id,
            app_user.display_name as name,
            app_user.contact_email as email,
            company_membership.role,
            app_user.active,
            auth_user.username,
            coalesce(membership.active, company_membership.active) as membership_active,
            coalesce(membership.created_at, company_membership.created_at) as created_at,
            coalesce((
              select array_agg(other.location_id order by other.location_id)
              from user_location_memberships other
              where other.user_id = app_user.id
                and other.company_id = company_membership.company_id
                and other.active
            ), array[]::uuid[]) as location_ids
       from locations target_location
       join user_company_memberships company_membership
         on company_membership.company_id = target_location.company_id
       join user_profiles app_user on app_user.id = company_membership.user_id
       left join user_location_memberships membership
         on membership.user_id = company_membership.user_id
        and membership.company_id = company_membership.company_id
        and membership.location_id = target_location.id
       left join auth_user on auth_user.id = app_user.auth_user_id
      where target_location.id = $1
        and app_user.deleted_at is null
        and (
          company_membership.role = 'admin'
          or (membership.user_id is not null and (membership.active or not app_user.active))
        )
      order by (company_membership.role = 'admin') desc,
               coalesce(membership.active, company_membership.active) desc,
               app_user.display_name`,
    [locationId],
  );
  return result.rows;
}

export async function getManagedUserByCompanies(userId, companyIds) {
  const result = await query(
    `select profile.id, profile.display_name as name, profile.active,
            membership.company_id, membership.role, membership.active as company_membership_active
       from user_profiles profile
       join user_company_memberships membership on membership.user_id = profile.id
      where profile.id = $1
        and membership.company_id = any($2::uuid[])
        and profile.deleted_at is null
      order by membership.created_at`,
    [userId, companyIds],
  );
  return result.rows;
}

export async function replaceManagedUserLocations({ userId, companyId, locationIds, actorId }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const membership = await client.query(
      `select role from user_company_memberships
        where user_id = $1 and company_id = $2 for update`,
      [userId, companyId],
    );
    if (!membership.rows[0]) throw new Error("User not found.");
    if (membership.rows[0].role === "admin") throw new Error("Admin locations are implicit.");

    const valid = await client.query(
      `select id from locations
        where company_id = $1 and id = any($2::uuid[])`,
      [companyId, locationIds],
    );
    if (valid.rowCount !== locationIds.length) throw new Error("One or more locations are invalid.");

    await client.query(
      `delete from user_location_memberships
        where user_id = $1 and company_id = $2
          and not (location_id = any($3::uuid[]))`,
      [userId, companyId, locationIds],
    );
    if (locationIds.length) {
      await client.query(
        `insert into user_location_memberships (user_id, location_id, company_id, active)
         select $1, location_id, $2, true from unnest($3::uuid[]) as location_id
         on conflict (user_id, location_id)
         do update set company_id = excluded.company_id, active = true, updated_at = now()`,
        [userId, companyId, locationIds],
      );
    }
    await client.query(
      `insert into admin_user_events (
         company_id, actor_user_id, target_user_id, action, details
       ) values ($1, $2, $3, 'locations_updated', $4::jsonb)`,
      [companyId, actorId, userId, JSON.stringify({ locationIds })],
    );
    await client.query("commit");
    return { id: userId, locationIds };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listMechanicsByLocations(locationIds) {
  if (!locationIds?.length) return [];
  const result = await query(
    `select app_user.id,
            app_user.display_name as name,
            array_agg(distinct membership.location_id order by membership.location_id) as location_ids
       from user_location_memberships membership
       join user_company_memberships company_membership
         on company_membership.user_id = membership.user_id
        and company_membership.company_id = membership.company_id
        and company_membership.active
        and company_membership.role = 'mechanic'
       join user_profiles app_user
         on app_user.id = membership.user_id
        and app_user.active
        and app_user.deleted_at is null
      where membership.location_id = any($1::uuid[])
        and membership.active
      group by app_user.id, app_user.display_name
      order by app_user.display_name`,
    [locationIds],
  );
  return result.rows.map((row) => ({
    id: row.id,
    name: row.name,
    locationIds: row.location_ids,
  }));
}

export async function getManagedUser(locationId, userId, companyIds) {
  const result = await query(
    `select app_user.id,
            app_user.display_name as name,
            app_user.contact_email as email,
            company_membership.role,
            app_user.active,
            app_user.auth_user_id, app_user.deleted_at, auth_user.username,
            membership.active as membership_active,
            location.company_id,
            coalesce((
              select array_agg(company_membership.company_id order by company_membership.company_id)
              from user_company_memberships company_membership
              where company_membership.user_id = app_user.id
            ), array[]::uuid[]) as company_ids
       from user_location_memberships membership
       join locations location on location.id = membership.location_id
       join user_company_memberships company_membership
         on company_membership.user_id = membership.user_id
        and company_membership.company_id = membership.company_id
       join user_profiles app_user on app_user.id = membership.user_id
       left join auth_user on auth_user.id = app_user.auth_user_id
      where membership.location_id = $1
        and app_user.id = $2
        and location.company_id = any($3::uuid[])
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
      "select id from user_profiles where id = $1 and deleted_at is null for update",
      [userId],
    );
    if (!locked.rows[0]) throw new Error("User not found.");

    if (active) {
      await client.query(
        `update user_company_memberships
            set active = true, updated_at = now()
          where user_id = $1 and company_id = $2`,
        [userId, companyId],
      );
      await client.query(
        `update user_location_memberships
            set active = true, updated_at = now()
          where user_id = $1 and location_id = $2 and company_id = $3`,
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
      `update user_profiles app_user
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
         from user_profiles
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
      `update user_profiles
          set display_name = 'Deleted user',
              contact_email = null,
              phone = null,
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
