import { resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../pool.js";

const DEFAULT_COMPANY_SLUG = "default";
const DEFAULT_COMPANY_NAME = "Default Company";
const DEFAULT_LOCATION_NAME = "Main Location";
const MIN_PASSWORD_LENGTH = 12;

function required(value, name) {
  const normalized = String(value || "").trim();
  if (!normalized) throw new Error(`${name} is required.`);
  return normalized;
}

function slugify(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

export function parseFirstAdminConfig(environment = process.env) {
  const requiredNames = ["ADMIN_EMAIL", "ADMIN_USERNAME", "ADMIN_NAME", "ADMIN_PASSWORD"];
  const missing = requiredNames.filter((name) => !String(environment[name] || "").trim());
  if (missing.length) {
    const scope = environment.NODE_ENV === "production" ? " in production" : "";
    throw new Error(`${missing.join(", ")} ${missing.length === 1 ? "is" : "are"} required${scope}.`);
  }

  const email = required(environment.ADMIN_EMAIL, "ADMIN_EMAIL").toLowerCase();
  const username = required(environment.ADMIN_USERNAME, "ADMIN_USERNAME").toLowerCase();
  const name = required(environment.ADMIN_NAME, "ADMIN_NAME");
  const password = required(environment.ADMIN_PASSWORD, "ADMIN_PASSWORD");
  const companyName = String(environment.COMPANY_NAME || DEFAULT_COMPANY_NAME).trim() || DEFAULT_COMPANY_NAME;
  const explicitCompanySlug = String(environment.COMPANY_SLUG || "").trim().toLowerCase();
  const companySlug = explicitCompanySlug || (
    environment.COMPANY_NAME ? slugify(companyName) : DEFAULT_COMPANY_SLUG
  );
  const locationName = String(environment.LOCATION_NAME || "").trim() || null;

  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) {
    throw new Error("ADMIN_EMAIL must be a valid email address.");
  }
  if (username.length < 3 || username.length > 50 || !/^[a-z0-9._-]+$/.test(username)) {
    throw new Error("ADMIN_USERNAME must be 3-50 characters using letters, numbers, dot, underscore, or hyphen.");
  }
  if (password.length < MIN_PASSWORD_LENGTH) {
    throw new Error(`ADMIN_PASSWORD must contain at least ${MIN_PASSWORD_LENGTH} characters.`);
  }
  if (/[\r\n]/.test(password)) {
    throw new Error("ADMIN_PASSWORD must not contain line breaks.");
  }
  if (!companySlug || companySlug.length > 63 || !/^[a-z0-9]+(?:-[a-z0-9]+)*$/.test(companySlug)) {
    throw new Error("COMPANY_SLUG must be a lowercase kebab-case identifier with at most 63 characters.");
  }

  return {
    email,
    username,
    name,
    password,
    companySlug,
    companyName,
    locationName,
  };
}

async function findAuthUsersByEmail(pool, email) {
  const result = await pool.query(
    `select id, email, username
       from auth_user
      where lower(email) = lower($1)
      order by created_at, id
      limit 2`,
    [email],
  );
  return result.rows;
}

async function findAuthUsersByUsername(pool, username) {
  const result = await pool.query(
    `select id, email, username
       from auth_user
      where lower(username) = lower($1)
      order by created_at, id
      limit 2`,
    [username],
  );
  return result.rows;
}

export async function ensureAuthIdentity({ pool, authApi, input }) {
  const emailMatches = await findAuthUsersByEmail(pool, input.email);
  if (emailMatches.length > 1) {
    throw new Error("Multiple auth users use ADMIN_EMAIL; resolve the duplicate records before bootstrapping.");
  }

  const existing = emailMatches[0];
  if (existing) {
    if (!existing.username || existing.username.toLowerCase() !== input.username) {
      throw new Error("ADMIN_EMAIL already exists without the requested username.");
    }
    const credential = await pool.query(
      `select 1
         from auth_account
        where user_id = $1 and provider_id = 'credential'
        limit 1`,
      [existing.id],
    );
    if (!credential.rows[0]) {
      throw new Error("ADMIN_EMAIL exists without a password credential; use the supported account recovery flow.");
    }
    return { authUserId: existing.id, created: false };
  }

  const usernameMatches = await findAuthUsersByUsername(pool, input.username);
  if (usernameMatches.length) {
    throw new Error("ADMIN_USERNAME already belongs to a different email address.");
  }

  const created = await authApi.signUpEmail({
    body: {
      name: input.name,
      email: input.email,
      password: input.password,
      username: input.username,
      displayUsername: input.username,
    },
  });
  const authUserId = created?.user?.id;
  if (!authUserId) {
    const matches = await findAuthUsersByEmail(pool, input.email);
    if (matches.length !== 1) throw new Error("Better Auth did not return or persist the new admin identity.");
    return { authUserId: matches[0].id, created: true };
  }
  return { authUserId, created: true };
}

async function resolveCompany(client, input) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`first-admin:company:${input.companySlug}`]);
  let existing = await client.query(
    `select id, slug, name
       from companies
      where slug = $1
      limit 1
      for update`,
    [input.companySlug],
  );

  if (!existing.rows[0]) {
    const activeCompanies = await client.query(
      `select id, slug, name
         from companies
        where active = true
        order by created_at, id
        limit 2
        for update`,
    );
    if (activeCompanies.rows.length === 1 && activeCompanies.rows[0].slug === DEFAULT_COMPANY_SLUG) {
      existing = activeCompanies;
    } else if (activeCompanies.rows.length) {
      throw new Error("COMPANY_SLUG does not match an existing company. Create additional companies through the supported admin workflow.");
    }
  }

  if (existing.rows[0]) {
    const updated = await client.query(
      `update companies
          set slug = $1, name = $2, active = true, updated_at = now()
        where id = $3
        returning id, slug, name`,
      [input.companySlug, input.companyName, existing.rows[0].id],
    );
    await client.query(
      `update company_legacy_keys
          set is_primary = false
        where company_id = $1 and legacy_key <> $2`,
      [updated.rows[0].id, input.companySlug],
    );
    await client.query(
      `insert into company_legacy_keys (legacy_key, company_id, is_primary)
       values ($1, $2, true)
       on conflict (legacy_key) do update
         set company_id = excluded.company_id,
             is_primary = true`,
      [input.companySlug, updated.rows[0].id],
    );
    return updated.rows[0];
  }

  const created = await client.query(
    `insert into companies (slug, name, active)
     values ($1, $2, true)
     returning id, slug, name`,
    [input.companySlug, input.companyName],
  );
  await client.query(
    `insert into company_legacy_keys (legacy_key, company_id, is_primary)
     values ($1, $2, true)`,
    [input.companySlug, created.rows[0].id],
  );
  return created.rows[0];
}

async function resolveLocation(client, input, companyId) {
  await client.query("select pg_advisory_xact_lock(hashtext($1))", [`first-admin:location:${companyId}`]);

  if (!input.locationName) {
    const locations = await client.query(
      `select id, name
         from locations
        where company_uuid = $1 and active = true
        order by created_at, id
        limit 2`,
      [companyId],
    );
    if (locations.rows.length === 1) return locations.rows[0];
    if (locations.rows.length > 1) {
      throw new Error("LOCATION_NAME is required because the company has multiple active locations.");
    }
  }

  const locationName = input.locationName || DEFAULT_LOCATION_NAME;
  const existing = await client.query(
    `select id, name
       from locations
      where company_uuid = $1 and lower(btrim(name)) = lower(btrim($2))
      order by created_at, id
      limit 2
      for update`,
    [companyId, locationName],
  );
  if (existing.rows.length > 1) {
    throw new Error("Multiple matching locations exist; resolve duplicates before bootstrapping.");
  }
  if (existing.rows[0]) {
    const updated = await client.query(
      `update locations
          set active = true, updated_at = now()
        where id = $1
        returning id, name`,
      [existing.rows[0].id],
    );
    return updated.rows[0];
  }

  const created = await client.query(
    `insert into locations (company_uuid, name, type, active)
     values ($1, $2, 'yard', true)
     returning id, name`,
    [companyId, locationName],
  );
  return created.rows[0];
}

export async function linkDomainAdmin({ pool, input, authUserId }) {
  const client = await pool.connect();
  try {
    await client.query("begin");
    const company = await resolveCompany(client, input);
    const location = await resolveLocation(client, input, company.id);
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`first-admin:${input.email}`]);

    const matches = await client.query(
      `select id, auth_user_id
         from app_users
        where auth_user_id = $1 or lower(email) = lower($2)
        order by created_at, id
        for update`,
      [authUserId, input.email],
    );
    if (matches.rows.length > 1) {
      throw new Error("Conflicting operational users match the admin identity; resolve them before bootstrapping.");
    }

    let appUserId;
    const existing = matches.rows[0];
    if (existing) {
      if (existing.auth_user_id && existing.auth_user_id !== authUserId) {
        throw new Error("ADMIN_EMAIL is already linked to a different auth identity.");
      }
      const updated = await client.query(
        `update app_users
            set name = $1,
                email = $2,
                role = 'admin',
                location_id = $3,
                active = true,
                auth_user_id = $4,
                updated_at = now()
          where id = $5
          returning id`,
        [input.name, input.email, location.id, authUserId, existing.id],
      );
      appUserId = updated.rows[0].id;
    } else {
      const created = await client.query(
        `insert into app_users (name, email, role, location_id, active, auth_user_id)
         values ($1, $2, 'admin', $3, true, $4)
         returning id`,
        [input.name, input.email, location.id, authUserId],
      );
      appUserId = created.rows[0].id;
    }

    await client.query(
      `insert into user_company_memberships (user_id, company_uuid, role, active)
       values ($1, $2, 'admin', true)
       on conflict (user_id, company_id) do update
         set company_uuid = excluded.company_uuid,
             role = 'admin',
             active = true,
             updated_at = now()`,
      [appUserId, company.id],
    );
    await client.query(
      `insert into user_location_memberships (user_id, location_id, company_uuid, active)
       values ($1, $2, $3, true)
       on conflict (user_id, location_id) do update
         set company_uuid = excluded.company_uuid,
             active = true,
             updated_at = now()`,
      [appUserId, location.id, company.id],
    );
    await client.query(
      `update auth_user
          set auth_role = 'admin',
              banned = false,
              ban_reason = null,
              ban_expires = null,
              updated_at = now()
        where id = $1`,
      [authUserId],
    );

    await client.query("commit");
    return {
      appUserId,
      companyId: company.id,
      companySlug: company.slug,
      companyName: company.name,
      locationId: location.id,
      locationName: location.name,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function cleanupNewAuthIdentity({ pool, authUserId }) {
  const result = await pool.query(
    `delete from auth_user auth
      where auth.id = $1
        and not exists (
          select 1 from app_users operational where operational.auth_user_id = auth.id
        )
      returning auth.id`,
    [authUserId],
  );
  return Boolean(result.rows[0]);
}

export async function bootstrapFirstAdmin({
  environment = process.env,
  pool,
  authApi,
  logger = console,
  operations = {},
} = {}) {
  const input = parseFirstAdminConfig(environment);
  const activePool = pool || getPool();
  let activeAuthApi = authApi;
  if (!activeAuthApi) {
    const { auth } = await import("../../auth/auth.js");
    activeAuthApi = auth.api;
  }

  const ensureIdentity = operations.ensureAuthIdentity || ensureAuthIdentity;
  const linkAdmin = operations.linkDomainAdmin || linkDomainAdmin;
  const cleanupIdentity = operations.cleanupNewAuthIdentity || cleanupNewAuthIdentity;
  const identity = await ensureIdentity({ pool: activePool, authApi: activeAuthApi, input });

  let linked;
  try {
    linked = await linkAdmin({
      pool: activePool,
      input,
      authUserId: identity.authUserId,
    });
  } catch (error) {
    if (identity.created) {
      await cleanupIdentity({ pool: activePool, authUserId: identity.authUserId }).catch(() => {});
    }
    throw error;
  }

  const result = {
    authUserId: identity.authUserId,
    appUserId: linked.appUserId,
    email: input.email,
    username: input.username,
    role: "admin",
    companyId: linked.companyId,
    companySlug: linked.companySlug,
    companyName: linked.companyName,
    locationId: linked.locationId,
    locationName: linked.locationName,
    authIdentityCreated: identity.created,
  };
  logger.log(JSON.stringify(result, null, 2));
  return result;
}

export function safeErrorMessage(error, password = "") {
  const message = error instanceof Error ? error.message : String(error);
  return password ? message.replaceAll(password, "[REDACTED]") : message;
}

async function main() {
  try {
    await bootstrapFirstAdmin();
  } catch (error) {
    console.error(safeErrorMessage(error, process.env.ADMIN_PASSWORD));
    process.exitCode = 1;
  } finally {
    await closePool().catch(() => {});
  }
}

const invokedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (invokedPath && fileURLToPath(import.meta.url) === invokedPath) {
  await main();
}
