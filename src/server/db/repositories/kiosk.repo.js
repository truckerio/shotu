import { getPool, query } from "../pool.js";

const FAILURE_WINDOW_MINUTES = 15;
const LOCK_MINUTES = 15;
const MAX_FAILURES = 5;

function initials(name = "") {
  return String(name)
    .split(/\s+/)
    .filter(Boolean)
    .slice(0, 2)
    .map((part) => part[0])
    .join("")
    .toUpperCase() || "M";
}

function deviceView(row) {
  return row ? {
    id: row.id,
    name: row.name,
    active: row.active,
    locationId: row.location_id,
    locationName: row.location_name,
    createdAt: row.created_at,
    lastSeenAt: row.last_seen_at,
  } : null;
}

async function addAuditEvent(client, {
  companyId,
  locationId = null,
  deviceId = null,
  actorUserId = null,
  targetUserId = null,
  eventType,
  metadata = {},
}) {
  await client.query(
    `insert into kiosk_audit_events (
       company_id, location_id, device_id, actor_user_id, target_user_id, event_type, metadata
     ) values ($1, $2, $3, $4, $5, $6, $7::jsonb)`,
    [
      companyId,
      locationId,
      deviceId,
      actorUserId,
      targetUserId,
      eventType,
      JSON.stringify(metadata),
    ],
  );
}

export async function createKioskDevice({
  companyId,
  locationId,
  name,
  tokenHash,
  actorUserId,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `insert into kiosk_devices (
         company_id, location_id, name, token_hash, registered_by_user_id
       ) values ($1, $2, $3, $4, $5)
       returning id, name, active, location_id, created_at, last_seen_at`,
      [companyId, locationId, name, tokenHash, actorUserId],
    );
    const device = result.rows[0];
    await addAuditEvent(client, {
      companyId,
      locationId,
      deviceId: device.id,
      actorUserId,
      eventType: "device_registered",
    });
    await client.query("commit");
    return deviceView(device);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listKioskDevices(companyIds, locationId) {
  const result = await query(
    `select device.id, device.name, device.active, device.location_id,
            location.name as location_name, device.created_at, device.last_seen_at
       from kiosk_devices device
       join locations location
         on location.id = device.location_id
        and location.company_id = device.company_id
      where device.location_id = $1
        and device.company_id = any($2::uuid[])
      order by device.created_at desc, device.id`,
    [locationId, companyIds],
  );
  return result.rows.map(deviceView);
}

export async function revokeKioskDevice({
  companyIds,
  locationId,
  deviceId,
  actorUserId,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select id, company_id, location_id, name, active, created_at, last_seen_at
         from kiosk_devices
        where id = $1
          and location_id = $2
          and company_id = any($3::uuid[])
        for update`,
      [deviceId, locationId, companyIds],
    );
    const current = selected.rows[0];
    if (!current) {
      await client.query("rollback");
      return null;
    }
    const updated = await client.query(
      `update kiosk_devices
          set active = false,
              revoked_at = coalesce(revoked_at, now()),
              revoked_by_user_id = coalesce(revoked_by_user_id, $2),
              updated_at = now()
        where id = $1
        returning id, company_id, location_id, name, active, created_at, last_seen_at`,
      [deviceId, actorUserId],
    );
    await client.query(
      `delete from auth_session session
        using kiosk_session_context context
        where context.device_id = $1
          and session.id = context.session_id`,
      [deviceId],
    );
    if (current.active) {
      await addAuditEvent(client, {
        companyId: current.company_id,
        locationId: current.location_id,
        deviceId,
        actorUserId,
        eventType: "device_revoked",
      });
    }
    await client.query("commit");
    return deviceView(updated.rows[0]);
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getRegisteredKioskContext(tokenHash) {
  if (!tokenHash) return null;
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const selected = await client.query(
      `select device.id, device.company_id, device.location_id, device.name,
              device.active, device.created_at, device.last_seen_at,
              location.name as location_name
         from kiosk_devices device
         join companies company
           on company.id = device.company_id
          and company.active
         join locations location
           on location.id = device.location_id
          and location.company_id = device.company_id
          and location.active
        where device.token_hash = $1
          and device.active
        for update of device`,
      [tokenHash],
    );
    const device = selected.rows[0];
    if (!device) {
      await client.query("rollback");
      return null;
    }
    await client.query(
      "update kiosk_devices set last_seen_at = now(), updated_at = now() where id = $1",
      [device.id],
    );
    const mechanics = await client.query(
      `select profile.id, profile.display_name as name,
              coalesce(credential.requires_change, true) as requires_change
         from user_location_memberships location_membership
         join user_company_memberships company_membership
           on company_membership.user_id = location_membership.user_id
          and company_membership.company_id = location_membership.company_id
          and company_membership.active
          and company_membership.role = 'mechanic'
         join user_profiles profile
           on profile.id = location_membership.user_id
          and profile.active
          and profile.deleted_at is null
          and profile.auth_user_id is not null
         left join mechanic_kiosk_credentials credential
           on credential.user_id = profile.id
          and credential.company_id = company_membership.company_id
        where location_membership.company_id = $1
          and location_membership.location_id = $2
          and location_membership.active
        order by profile.display_name, profile.id`,
      [device.company_id, device.location_id],
    );
    await client.query("commit");
    return {
      device: deviceView({ ...device, last_seen_at: new Date() }),
      mechanics: mechanics.rows.map((mechanic) => ({
        id: mechanic.id,
        name: mechanic.name,
        initials: initials(mechanic.name),
        requiresPinChange: mechanic.requires_change,
      })),
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function getKioskSessionContext(sessionId) {
  if (!sessionId) return null;
  const result = await query(
    `select context.session_id, context.device_id, context.location_id,
            device.company_id, device.name as device_name,
            location.name as location_name,
            (
              device.active
              and company.active
              and location.active
              and profile.id is not null
              and exists (
                select 1
                from user_company_memberships company_membership
                where company_membership.user_id = profile.id
                  and company_membership.company_id = device.company_id
                  and company_membership.role = 'mechanic'
                  and company_membership.active
              )
              and exists (
                select 1
                from user_location_memberships location_membership
                where location_membership.user_id = profile.id
                  and location_membership.company_id = device.company_id
                  and location_membership.location_id = device.location_id
                  and location_membership.active
              )
            ) as valid
       from kiosk_session_context context
       join kiosk_devices device
         on device.id = context.device_id
        and device.location_id = context.location_id
       join locations location
         on location.id = context.location_id
        and location.company_id = device.company_id
       join companies company on company.id = device.company_id
       join auth_session session on session.id = context.session_id
       left join user_profiles profile
         on profile.auth_user_id = session.user_id
        and profile.active
        and profile.deleted_at is null
      where context.session_id = $1
      limit 1`,
    [sessionId],
  );
  const row = result.rows[0];
  if (row && !row.valid) {
    await query("delete from auth_session where id = $1", [sessionId]);
  }
  return row ? {
    sessionId: row.session_id,
    deviceId: row.device_id,
    deviceName: row.device_name,
    companyId: row.company_id,
    locationId: row.location_id,
    locationName: row.location_name,
    invalid: !row.valid,
  } : null;
}

export async function getEligibleMechanicForKioskPin({
  companyIds,
  locationId,
  userId,
}) {
  const result = await query(
    `select profile.id, profile.display_name as name, location.company_id
       from locations location
       join user_location_memberships location_membership
         on location_membership.location_id = location.id
        and location_membership.company_id = location.company_id
        and location_membership.active
       join user_company_memberships company_membership
         on company_membership.user_id = location_membership.user_id
        and company_membership.company_id = location.company_id
        and company_membership.active
        and company_membership.role = 'mechanic'
       join user_profiles profile
         on profile.id = location_membership.user_id
        and profile.active
        and profile.deleted_at is null
        and profile.auth_user_id is not null
      where location.id = $1
        and location.company_id = any($2::uuid[])
        and profile.id = $3
      limit 1`,
    [locationId, companyIds, userId],
  );
  return result.rows[0] || null;
}

export async function saveMechanicKioskPin({
  userId,
  companyId,
  pinHash,
  actorUserId,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      `select version
         from mechanic_kiosk_credentials
        where user_id = $1 and company_id = $2
        for update`,
      [userId, companyId],
    );
    const result = await client.query(
      `insert into mechanic_kiosk_credentials (
         user_id, company_id, pin_hash, requires_change, version, updated_by_user_id
       ) values ($1, $2, $3, true, 1, $4)
       on conflict (user_id, company_id) do update
         set pin_hash = excluded.pin_hash,
             requires_change = true,
             version = mechanic_kiosk_credentials.version + 1,
             updated_by_user_id = excluded.updated_by_user_id,
             updated_at = now()
       returning requires_change, updated_at`,
      [userId, companyId, pinHash, actorUserId],
    );
    await client.query(
      `delete from kiosk_unlock_failures failure
        using kiosk_devices device
        where failure.device_id = device.id
          and failure.user_id = $1
          and device.company_id = $2`,
      [userId, companyId],
    );
    await addAuditEvent(client, {
      companyId,
      actorUserId,
      targetUserId: userId,
      eventType: existing.rowCount ? "pin_reset" : "pin_issued",
    });
    await client.query("commit");
    return {
      enabled: true,
      requiresChange: result.rows[0].requires_change,
      updatedAt: result.rows[0].updated_at,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listActiveMechanicsForKioskPinReset() {
  const result = await query(
    `select distinct profile.id as user_id, company_membership.company_id
       from user_profiles profile
       join user_company_memberships company_membership
         on company_membership.user_id = profile.id
        and company_membership.role = 'mechanic'
        and company_membership.active
       join companies company
         on company.id = company_membership.company_id
        and company.active
      where profile.active
        and profile.deleted_at is null
        and profile.auth_user_id is not null
        and exists (
          select 1
            from user_location_memberships location_membership
            join locations location
              on location.id = location_membership.location_id
             and location.company_id = location_membership.company_id
             and location.active
           where location_membership.user_id = profile.id
             and location_membership.company_id = company_membership.company_id
             and location_membership.active
        )
      order by company_membership.company_id, profile.id`,
  );
  return result.rows.map((row) => ({
    userId: row.user_id,
    companyId: row.company_id,
  }));
}

export async function saveTemporaryKioskPins(credentials) {
  if (!credentials.length) return { updatedCount: 0 };
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const payload = JSON.stringify(credentials.map((credential) => ({
      user_id: credential.userId,
      company_id: credential.companyId,
      pin_hash: credential.pinHash,
    })));
    const updated = await client.query(
      `with incoming as (
         select *
           from jsonb_to_recordset($1::jsonb)
             as value(user_id uuid, company_id uuid, pin_hash text)
       ),
       existing as (
         select credential.user_id, credential.company_id
           from mechanic_kiosk_credentials credential
           join incoming
             on incoming.user_id = credential.user_id
            and incoming.company_id = credential.company_id
       ),
       saved as (
         insert into mechanic_kiosk_credentials (
           user_id, company_id, pin_hash, requires_change, version, updated_by_user_id
         )
         select user_id, company_id, pin_hash, true, 1, null
           from incoming
         on conflict (user_id, company_id) do update
           set pin_hash = excluded.pin_hash,
               requires_change = true,
               version = mechanic_kiosk_credentials.version + 1,
               updated_by_user_id = null,
               updated_at = now()
         returning user_id, company_id
       )
       insert into kiosk_audit_events (
         company_id, target_user_id, event_type, metadata
       )
       select saved.company_id,
              saved.user_id,
              case when existing.user_id is null then 'pin_issued' else 'pin_reset' end,
              '{"source":"bulk_temporary_pin"}'::jsonb
         from saved
         left join existing
           on existing.user_id = saved.user_id
          and existing.company_id = saved.company_id
       returning target_user_id`,
      [payload],
    );
    await client.query(
      `delete from kiosk_unlock_failures failure
        using kiosk_devices device,
              jsonb_to_recordset($1::jsonb)
                as value(user_id uuid, company_id uuid, pin_hash text)
        where failure.device_id = device.id
          and failure.user_id = value.user_id
          and device.company_id = value.company_id`,
      [payload],
    );
    await client.query("commit");
    return { updatedCount: updated.rowCount };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function prepareKioskUnlock({
  tokenHash,
  mechanicId,
  pin,
  verifyPin,
  hasNewPin,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const deviceResult = await client.query(
      `select device.id, device.company_id, device.location_id, device.active
         from kiosk_devices device
         join companies company on company.id = device.company_id and company.active
         join locations location
           on location.id = device.location_id
          and location.company_id = device.company_id
          and location.active
        where device.token_hash = $1
          and device.active
        for update of device`,
      [tokenHash],
    );
    const device = deviceResult.rows[0];
    if (!device) {
      await client.query("rollback");
      return { status: "invalid" };
    }

    const candidateResult = await client.query(
      `select profile.id as user_id, profile.auth_user_id,
              credential.pin_hash, credential.requires_change, credential.version
         from user_profiles profile
         join user_company_memberships company_membership
           on company_membership.user_id = profile.id
          and company_membership.company_id = $2
          and company_membership.active
          and company_membership.role = 'mechanic'
         join user_location_memberships location_membership
           on location_membership.user_id = profile.id
          and location_membership.company_id = $2
          and location_membership.location_id = $3
          and location_membership.active
         join mechanic_kiosk_credentials credential
           on credential.user_id = profile.id
          and credential.company_id = $2
        where profile.id = $1
          and profile.active
          and profile.deleted_at is null
          and profile.auth_user_id is not null
        for update of credential`,
      [mechanicId, device.company_id, device.location_id],
    );
    const candidate = candidateResult.rows[0];
    if (!candidate) {
      await addAuditEvent(client, {
        companyId: device.company_id,
        locationId: device.location_id,
        deviceId: device.id,
        eventType: "unlock_failed",
        metadata: { reason: "invalid_credentials" },
      });
      await client.query("commit");
      return { status: "invalid" };
    }

    await client.query(
      `insert into kiosk_unlock_failures (device_id, user_id, failure_count, window_started_at)
       values ($1, $2, 0, now())
       on conflict (device_id, user_id) do nothing`,
      [device.id, candidate.user_id],
    );
    const failureResult = await client.query(
      `select failure_count, window_started_at, locked_until
         from kiosk_unlock_failures
        where device_id = $1 and user_id = $2
        for update`,
      [device.id, candidate.user_id],
    );
    const failure = failureResult.rows[0];
    if (failure.locked_until && new Date(failure.locked_until).getTime() > Date.now()) {
      await addAuditEvent(client, {
        companyId: device.company_id,
        locationId: device.location_id,
        deviceId: device.id,
        targetUserId: candidate.user_id,
        eventType: "unlock_failed",
        metadata: { reason: "locked" },
      });
      await client.query("commit");
      return { status: "locked" };
    }

    const valid = await verifyPin({ hash: candidate.pin_hash, password: pin });
    if (!valid) {
      const windowExpired = new Date(failure.window_started_at).getTime()
        <= Date.now() - FAILURE_WINDOW_MINUTES * 60_000;
      const failureCount = windowExpired ? 1 : failure.failure_count + 1;
      const locked = failureCount >= MAX_FAILURES;
      await client.query(
        `update kiosk_unlock_failures
            set failure_count = $3,
                window_started_at = case when $4 then now() else window_started_at end,
                locked_until = case when $5 then now() + interval '${LOCK_MINUTES} minutes' else null end,
                updated_at = now()
          where device_id = $1 and user_id = $2`,
        [device.id, candidate.user_id, failureCount, windowExpired, locked],
      );
      await addAuditEvent(client, {
        companyId: device.company_id,
        locationId: device.location_id,
        deviceId: device.id,
        targetUserId: candidate.user_id,
        eventType: "unlock_failed",
        metadata: { reason: "invalid_credentials", failureCount, locked },
      });
      await client.query("commit");
      return { status: locked ? "locked" : "invalid" };
    }

    if (candidate.requires_change && !hasNewPin) {
      await client.query("commit");
      return { status: "pin_change_required" };
    }
    await client.query("commit");
    return {
      status: "ready",
      authUserId: candidate.auth_user_id,
      userId: candidate.user_id,
      credentialVersion: candidate.version,
      requiresChange: candidate.requires_change,
      deviceId: device.id,
      companyId: device.company_id,
      locationId: device.location_id,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function completeKioskUnlock({
  prepared,
  sessionId,
  newPinHash,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const current = await client.query(
      `select credential.requires_change, credential.version,
              failure.locked_until
         from kiosk_devices device
         join locations location
           on location.id = device.location_id
          and location.company_id = device.company_id
          and location.active
         join user_company_memberships company_membership
           on company_membership.user_id = $2
          and company_membership.company_id = device.company_id
          and company_membership.role = 'mechanic'
          and company_membership.active
         join user_location_memberships location_membership
           on location_membership.user_id = $2
          and location_membership.company_id = device.company_id
          and location_membership.location_id = device.location_id
          and location_membership.active
         join user_profiles profile
           on profile.id = $2
          and profile.active
          and profile.deleted_at is null
         join mechanic_kiosk_credentials credential
           on credential.user_id = $2
          and credential.company_id = device.company_id
         join kiosk_unlock_failures failure
           on failure.device_id = device.id
          and failure.user_id = $2
        where device.id = $1
          and device.company_id = $3
          and device.location_id = $4
          and device.active
          and credential.version = $5
        for update of device, credential, failure`,
      [
        prepared.deviceId,
        prepared.userId,
        prepared.companyId,
        prepared.locationId,
        prepared.credentialVersion,
      ],
    );
    const state = current.rows[0];
    if (!state || (state.locked_until && new Date(state.locked_until).getTime() > Date.now())) {
      await client.query("rollback");
      return false;
    }
    if (state.requires_change && !newPinHash) {
      await client.query("rollback");
      return false;
    }
    if (newPinHash) {
      await client.query(
        `update mechanic_kiosk_credentials
            set pin_hash = $3,
                requires_change = false,
                version = version + 1,
                updated_by_user_id = $1,
                updated_at = now()
          where user_id = $1 and company_id = $2`,
        [prepared.userId, prepared.companyId, newPinHash],
      );
    }
    await client.query(
      `update kiosk_unlock_failures
          set failure_count = 0,
              window_started_at = now(),
              locked_until = null,
              updated_at = now()
        where device_id = $1 and user_id = $2`,
      [prepared.deviceId, prepared.userId],
    );
    await client.query(
      `insert into kiosk_session_context (session_id, device_id, location_id)
       values ($1, $2, $3)`,
      [sessionId, prepared.deviceId, prepared.locationId],
    );
    if (newPinHash) {
      await addAuditEvent(client, {
        companyId: prepared.companyId,
        locationId: prepared.locationId,
        deviceId: prepared.deviceId,
        actorUserId: prepared.userId,
        targetUserId: prepared.userId,
        eventType: "pin_changed",
      });
    }
    await addAuditEvent(client, {
      companyId: prepared.companyId,
      locationId: prepared.locationId,
      deviceId: prepared.deviceId,
      actorUserId: prepared.userId,
      targetUserId: prepared.userId,
      eventType: "unlock_succeeded",
    });
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function recordKioskSessionEvent({
  sessionId,
  actorUserId,
  type,
}) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `select context.device_id, context.location_id, device.company_id
         from kiosk_session_context context
         join kiosk_devices device on device.id = context.device_id
        where context.session_id = $1
        for update of context`,
      [sessionId],
    );
    const context = result.rows[0];
    if (!context) {
      await client.query("rollback");
      return false;
    }
    await addAuditEvent(client, {
      companyId: context.company_id,
      locationId: context.location_id,
      deviceId: context.device_id,
      actorUserId,
      targetUserId: actorUserId,
      eventType: type === "switch" ? "mechanic_switched" : "session_locked",
    });
    await client.query("commit");
    return true;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
