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

export async function createUserInvitation(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query(
      `update user_invitations
          set status = 'revoked', updated_at = now()
        where location_id = $1 and lower(email) = lower($2) and status = 'pending'`,
      [input.locationId, input.email],
    );
    const result = await client.query(
      `insert into user_invitations (
         company_id, location_id, email, name, role, token_hash, invited_by_user_id, expires_at
       ) values ($1, $2, lower($3), $4, $5, $6, $7, $8)
       returning id, company_id, location_id, email, name, role, status, expires_at, created_at`,
      [input.companyId, input.locationId, input.email, input.name, input.role, input.tokenHash, input.actorId, input.expiresAt],
    );
    await client.query("commit");
    return result.rows[0];
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
    const userResult = await client.query(
      `insert into app_users (name, email, role, location_id, active, auth_user_id)
       values ($1, $2, $3, $4, true, $5)
       on conflict (email) do update
         set name = excluded.name,
             role = excluded.role,
             location_id = excluded.location_id,
             active = true,
             auth_user_id = excluded.auth_user_id,
             updated_at = now()
       returning id`,
      [invitation.name, invitation.email, invitation.role, invitation.location_id, authUserId],
    );
    const userId = userResult.rows[0].id;
    await client.query(
      `insert into user_location_memberships (user_id, location_id, active)
       values ($1, $2, true)
       on conflict (user_id, location_id) do update set active = true, updated_at = now()`,
      [userId, invitation.location_id],
    );
    await client.query(
      `insert into user_company_memberships (user_id, company_id, role, active)
       values ($1, $2, $3, true)
       on conflict (user_id, company_id) do update set role = excluded.role, active = true, updated_at = now()`,
      [userId, invitation.company_id, invitation.role],
    );
    await client.query(
      `update user_invitations
          set status = 'accepted', accepted_at = now(), updated_at = now()
        where id = $1`,
      [invitation.id],
    );
    await client.query("commit");
    return { userId, username, role: invitation.role };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
