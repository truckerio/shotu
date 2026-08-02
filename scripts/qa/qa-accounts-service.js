import { buildQaAccountManifest, publicAccountView } from "./account-manifest.js";

const MIN_PASSWORD_LENGTH = 12;

function requirePassword(password) {
  const value = String(password || "");
  if (value.length < MIN_PASSWORD_LENGTH || value.length > 128 || /[\r\n]/.test(value)) {
    throw new Error("QA_ACCOUNT_PASSWORD must contain 12-128 characters without line breaks.");
  }
  return value;
}

async function resolveScope(pool, { companySlug, locationName }) {
  const company = await pool.query(
    `select id, slug, name
       from companies
      where slug = $1 and active = true
      limit 1`,
    [companySlug],
  );
  if (!company.rows[0]) throw new Error(`Active company ${companySlug} was not found.`);

  const location = await pool.query(
    `select id, name
       from locations
      where company_id = $1
        and lower(btrim(name)) = lower(btrim($2))
        and active = true
      order by created_at, id
      limit 2`,
    [company.rows[0].id, locationName],
  );
  if (location.rows.length !== 1) {
    throw new Error(`Expected one active ${locationName} location in ${companySlug}.`);
  }
  return { company: company.rows[0], location: location.rows[0] };
}

async function findIdentity(pool, account) {
  const result = await pool.query(
    `select id, email, username
       from auth_user
      where lower(email) = lower($1) or lower(username) = lower($2)
      order by created_at, id`,
    [account.email, account.username],
  );
  if (result.rows.length > 1) throw new Error(`Conflicting auth identities exist for ${account.username}.`);
  const identity = result.rows[0] || null;
  if (identity && (
    identity.email.toLowerCase() !== account.email
    || String(identity.username || "").toLowerCase() !== account.username
  )) {
    throw new Error(`The deterministic identity ${account.username} is owned by another account.`);
  }
  return identity;
}

async function ensureIdentity({ pool, authApi, account, password }) {
  const existing = await findIdentity(pool, account);
  if (existing) return { authUserId: existing.id, created: false };

  const created = await authApi.signUpEmail({
    body: {
      name: account.name,
      email: account.email,
      password,
      username: account.username,
      displayUsername: account.username,
    },
  });
  const authUserId = created?.user?.id || (await findIdentity(pool, account))?.id;
  if (!authUserId) throw new Error(`Better Auth did not persist ${account.username}.`);
  return { authUserId, created: true };
}

async function cleanupUnlinkedIdentity(pool, authUserId) {
  await pool.query(
    `delete from auth_user auth
      where auth.id = $1
        and not exists (
          select 1 from user_profiles profile where profile.auth_user_id = auth.id
        )`,
    [authUserId],
  );
}

async function linkOperationalAccount({ pool, account, authUserId, companyId, locationId }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`qa-account:${account.email}`]);
    const profiles = await client.query(
      `select id, auth_user_id
         from user_profiles
        where auth_user_id = $1
           or (deleted_at is null and lower(contact_email) = lower($2))
        order by created_at, id
        for update`,
      [authUserId, account.email],
    );
    if (profiles.rows.length > 1) throw new Error(`Conflicting operational profiles exist for ${account.username}.`);

    let profileId = profiles.rows[0]?.id;
    if (profileId) {
      if (profiles.rows[0].auth_user_id && profiles.rows[0].auth_user_id !== authUserId) {
        throw new Error(`Operational profile ${account.username} is linked to another auth identity.`);
      }
      const otherMemberships = await client.query(
        `select 1 from user_company_memberships
          where user_id = $1 and company_id <> $2
          limit 1`,
        [profileId, companyId],
      );
      if (otherMemberships.rows[0]) {
        throw new Error(`Refusing to reuse multi-company identity ${account.username}.`);
      }
      await client.query(
        `update user_profiles
            set display_name = $1, contact_email = $2, active = true,
                auth_user_id = $3, deleted_at = null, updated_at = now()
          where id = $4`,
        [account.name, account.email, authUserId, profileId],
      );
    } else {
      const created = await client.query(
        `insert into user_profiles (display_name, contact_email, active, auth_user_id)
         values ($1, $2, true, $3)
         returning id`,
        [account.name, account.email, authUserId],
      );
      profileId = created.rows[0].id;
    }

    await client.query(
      `insert into user_company_memberships (user_id, company_id, role, active)
       values ($1, $2, $3, true)
       on conflict (user_id, company_id) do update
         set role = excluded.role, active = true, updated_at = now()`,
      [profileId, companyId, account.role],
    );
    await client.query(
      `update user_location_memberships
          set active = false, updated_at = now()
        where user_id = $1 and company_id = $2 and location_id <> $3`,
      [profileId, companyId, locationId],
    );
    await client.query(
      `insert into user_location_memberships (user_id, location_id, company_id, active)
       values ($1, $2, $3, true)
       on conflict (user_id, location_id) do update
         set company_id = excluded.company_id, active = true, updated_at = now()`,
      [profileId, locationId, companyId],
    );
    await client.query(
      `update auth_user
          set name = $1, auth_role = $2, banned = false, ban_reason = null,
              ban_expires = null, updated_at = now()
        where id = $3`,
      [account.name, account.role === "admin" ? "admin" : "user", authUserId],
    );
    await client.query("commit");
    return profileId;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function requireManagedIdentity(pool, account, companyId) {
  const identity = await findIdentity(pool, account);
  if (!identity) throw new Error(`QA account ${account.username} has not been provisioned.`);
  const profile = await pool.query(
    `select profile.id, membership.role
       from user_profiles profile
       join user_company_memberships membership on membership.user_id = profile.id
      where profile.auth_user_id = $1
        and membership.company_id = $2
        and profile.deleted_at is null
      limit 2`,
    [identity.id, companyId],
  );
  if (profile.rows.length !== 1 || profile.rows[0].role !== account.role) {
    throw new Error(`QA account ${account.username} does not have its expected company role.`);
  }
  return { authUserId: identity.id, profileId: profile.rows[0].id };
}

async function setPasswordWithBetterAuth(authInstance, authUserId, password) {
  const context = await authInstance.$context;
  const hashedPassword = await context.password.hash(password);
  const accounts = await context.internalAdapter.findAccounts(authUserId);
  if (accounts.some((account) => account.providerId === "credential")) {
    await context.internalAdapter.updatePassword(authUserId, hashedPassword);
  } else {
    await context.internalAdapter.createAccount({
      userId: authUserId,
      providerId: "credential",
      accountId: authUserId,
      password: hashedPassword,
    });
  }
  await context.internalAdapter.deleteUserSessions(authUserId);
}

async function prepareCleanupAccount(pool, account, companyId) {
  const identity = await findIdentity(pool, account);
  if (!identity) return null;
  const managed = await requireManagedIdentity(pool, account, companyId);
  const otherMemberships = await pool.query(
    `select 1 from user_company_memberships
      where user_id = $1 and company_id <> $2
      limit 1`,
    [managed.profileId, companyId],
  );
  if (otherMemberships.rows[0]) throw new Error(`Refusing to remove multi-company identity ${account.username}.`);
  return managed;
}

async function executeCleanupAccount({ pool, account, prepared }) {
  if (!prepared) return { ...publicAccountView(account), status: "absent" };
  const client = await pool.connect();
  try {
    await client.query("begin");
    await client.query("update user_company_memberships set active = false, updated_at = now() where user_id = $1", [prepared.profileId]);
    await client.query("update user_location_memberships set active = false, updated_at = now() where user_id = $1", [prepared.profileId]);
    await client.query(
      `update user_profiles
          set display_name = $1, contact_email = null, active = false,
              auth_user_id = null, deleted_at = now(), updated_at = now()
        where id = $2`,
      [`Removed ${account.name}`, prepared.profileId],
    );
    await client.query("delete from auth_user where id = $1", [prepared.authUserId]);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
  return { ...publicAccountView(account), status: "removed" };
}

export async function manageQaAccounts({
  action,
  pool,
  authInstance,
  password,
  namespace = "qa",
  companySlug = "default",
  locationName,
}) {
  if (!["plan", "apply", "reset", "cleanup"].includes(action)) {
    throw new Error("Action must be plan, apply, reset, or cleanup.");
  }
  if (!locationName) throw new Error("QA_LOCATION_NAME is required.");
  const manifest = buildQaAccountManifest(namespace);
  const scope = await resolveScope(pool, { companySlug, locationName });

  if (action === "plan") {
    return {
      action,
      company: scope.company,
      location: scope.location,
      accounts: manifest.map(publicAccountView),
    };
  }

  if (action === "cleanup") {
    const prepared = [];
    for (const account of manifest) {
      prepared.push(await prepareCleanupAccount(pool, account, scope.company.id));
    }
    const accounts = [];
    for (let index = 0; index < manifest.length; index += 1) {
      accounts.push(await executeCleanupAccount({ pool, account: manifest[index], prepared: prepared[index] }));
    }
    return { action, company: scope.company, location: scope.location, accounts };
  }

  const activePassword = requirePassword(password);
  if (!authInstance) throw new Error("Better Auth is required for apply and reset.");

  if (action === "reset") {
    const managedAccounts = [];
    for (const account of manifest) {
      managedAccounts.push(await requireManagedIdentity(pool, account, scope.company.id));
    }
    const accounts = [];
    for (let index = 0; index < manifest.length; index += 1) {
      const account = manifest[index];
      await setPasswordWithBetterAuth(authInstance, managedAccounts[index].authUserId, activePassword);
      accounts.push({ ...publicAccountView(account), status: "reset", sessionsRevoked: true });
    }
    return { action, company: scope.company, location: scope.location, accounts };
  }

  const accounts = [];
  for (const account of manifest) {
    const identity = await ensureIdentity({ pool, authApi: authInstance.api, account, password: activePassword });
    try {
      await linkOperationalAccount({
        pool,
        account,
        authUserId: identity.authUserId,
        companyId: scope.company.id,
        locationId: scope.location.id,
      });
    } catch (error) {
      if (identity.created) await cleanupUnlinkedIdentity(pool, identity.authUserId).catch(() => {});
      throw error;
    }
    accounts.push({ ...publicAccountView(account), status: identity.created ? "created" : "reconciled" });
  }
  return { action, company: scope.company, location: scope.location, accounts };
}
