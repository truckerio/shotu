import { getPool, query } from "../pool.js";

export async function listInvitationsByLocation(locationId) {
  const result = await query(
    `select id, email, name, role, status, expires_at, accepted_at, created_at
       from user_invitations
      where location_id = $1
      order by created_at desc
      limit 50`,
    [locationId],
  );
  return result.rows;
}

export async function getPendingInvitationByLocationEmail(locationId, email) {
  const result = await query(
    `select id, email, name, role, status, expires_at, accepted_at, created_at
       from user_invitations
      where location_id = $1
        and lower(email) = lower($2)
        and status = 'pending'
      order by created_at desc
      limit 1`,
    [locationId, email],
  );
  return result.rows[0] || null;
}

export async function createUserInvitations(inputs) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const created = [];
    for (const input of inputs) {
      await client.query(
        `update user_invitations
            set status = 'revoked', updated_at = now()
          where location_id = $1 and lower(email) = lower($2)
            and status = 'pending' and expires_at <= now()`,
        [input.locationId, input.email],
      );
      const result = await client.query(
        `insert into user_invitations (
           company_id, location_id, email, name, role, token_hash, invited_by_user_id, expires_at, batch_id
         ) values ($1, $2, lower($3), $4, $5, $6, $7, $8, $9)
         returning id, company_id, location_id, email, name, role, status, expires_at, created_at, batch_id`,
        [input.companyId, input.locationId, input.email, input.name, input.role, input.tokenHash, input.actorId, input.expiresAt, input.batchId],
      );
      created.push(result.rows[0]);
    }
    await client.query("commit");
    return created;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function rotateUserInvitation({
  invitationId,
  locationId,
  actorId,
  tokenHash,
  expiresAt,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select id, batch_id from user_invitations
        where id = $1 and location_id = $2 and status = 'pending' for update`,
      [invitationId, locationId],
    );
    if (!selected.rows[0]) { await client.query("rollback"); return null; }
    const result = await client.query(
      `update user_invitations
          set token_hash = case
                when id = $1 then $2
                else md5(gen_random_uuid()::text || clock_timestamp()::text || id::text)
              end,
              invited_by_user_id = $3, expires_at = $4, updated_at = now()
        where status = 'pending'
          and (id = $1 or (batch_id is not null and batch_id = $5))
        returning id, company_id, location_id, email, name, role,
                  status, expires_at, accepted_at, created_at, batch_id`,
      [invitationId, tokenHash, actorId, expiresAt, selected.rows[0].batch_id],
    );
    await client.query("commit");
    return result.rows.find(({ id }) => id === invitationId) || null;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}

export async function getInvitationByTokenHash(tokenHash) {
  const result = await query(
    `select invitation.*, location.name as location_name
       from user_invitations invitation
       join locations location on location.id = invitation.location_id
      where invitation.token_hash = $1
      limit 1`,
    [tokenHash],
  );
  return result.rows[0] || null;
}

export async function acceptUserInvitation({ invitationId, authUserId, username }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const inviteResult = await client.query("select * from user_invitations where id = $1 for update", [invitationId]);
    const invitation = inviteResult.rows[0];
    if (!invitation || invitation.status !== "pending" || new Date(invitation.expires_at) <= new Date()) {
      throw new Error("Invitation is no longer available.");
    }
    let userResult = await client.query(
      `update user_profiles
          set display_name = $1,
              contact_email = $2,
              active = true,
              updated_at = now()
        where auth_user_id = $3
          and deleted_at is null
        returning id`,
      [invitation.name, invitation.email, authUserId],
    );
    if (!userResult.rowCount) {
      userResult = await client.query(
        `insert into user_profiles (display_name, contact_email, active, auth_user_id)
         values ($1, $2, true, $3)
         returning id`,
        [invitation.name, invitation.email, authUserId],
      );
    }
    const userId = userResult.rows[0].id;
    const companyMembership = await client.query(
      `update user_company_memberships
          set role = $3,
              active = true,
              updated_at = now()
        where user_id = $1
          and company_id = $2`,
      [userId, invitation.company_id, invitation.role],
    );
    if (!companyMembership.rowCount) {
      await client.query(
        `insert into user_company_memberships (user_id, company_id, role, active)
         values ($1, $2, $3, true)`,
        [userId, invitation.company_id, invitation.role],
      );
    }
    const groupedInvitations = await client.query(
      `select id, location_id from user_invitations
        where company_id = $1 and lower(email) = lower($2)
          and (id = $3 or (batch_id is not null and batch_id = $4))
          and status = 'pending' and expires_at > now()
        for update`,
      [
        invitation.company_id,
        invitation.email,
        invitation.id,
        invitation.batch_id,
      ],
    );
    for (const grouped of invitation.role === "admin" ? [] : groupedInvitations.rows) {
      const updatedLocation = await client.query(
        `update user_location_memberships
            set company_id = $3, active = true, updated_at = now()
          where user_id = $1 and location_id = $2`,
        [userId, grouped.location_id, invitation.company_id],
      );
      if (!updatedLocation.rowCount) {
        await client.query(
          `insert into user_location_memberships (user_id, location_id, company_id, active)
           values ($1, $2, $3, true)`,
          [userId, grouped.location_id, invitation.company_id],
        );
      }
    }
    await client.query(
      `update user_invitations
          set status = 'accepted', accepted_at = now(), updated_at = now()
        where id = any($1::uuid[])`,
      [groupedInvitations.rows.map(({ id }) => id)],
    );
    await client.query("commit");
    return {
      userId,
      username,
      role: invitation.role,
      locationIds: invitation.role === "admin"
        ? []
        : groupedInvitations.rows.map(({ location_id }) => location_id),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
