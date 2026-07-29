import { auth } from "../../auth/auth.js";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { closePool, getPool } from "../pool.js";
import { resolveDemoUserPassword } from "./demo-seed-policy.js";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const COMPANY_SLUG = "default";
const COMPANY_NAME = "Default Company";

const locations = [
  {
    key: "chino",
    name: "Chino Yard",
    managers: 2,
    mechanics: 10,
  },
  {
    key: "texas",
    name: "Texas Yard",
    managers: 1,
    mechanics: 1,
  },
  {
    key: "arizona",
    name: "Arizona Yard",
    managers: 1,
    mechanics: 1,
  },
  {
    key: "newjersey",
    name: "New Jersey Yard",
    managers: 1,
    mechanics: 1,
  },
];

const demoUsers = [
  {
    name: "Admin Demo",
    email: "admin@example.com",
    username: "admin",
    role: "admin",
    locationKeys: locations.map((location) => location.key),
  },
  {
    name: "Surveillance Demo",
    email: "surveillance@example.com",
    username: "surveillance",
    role: "surveillance",
    locationKeys: locations.map((location) => location.key),
  },
  ...locations.flatMap((location) => {
    const managers = Array.from({ length: location.managers }, (_, index) => ({
      name: `${location.name.replace(" Yard", "")} Manager ${index + 1}`,
      email: `${location.key}.manager${index + 1}@example.com`,
      username: `${location.key}manager${index + 1}`,
      role: "office",
      locationKeys: [location.key],
    }));
    const mechanics = Array.from({ length: location.mechanics }, (_, index) => ({
      name: `${location.name.replace(" Yard", "")} Mechanic ${index + 1}`,
      email: location.key === "chino" && index === 0
        ? "mechanic@example.com"
        : `${location.key}.mechanic${index + 1}@example.com`,
      username: location.key === "chino" && index === 0
        ? "mechanic1"
        : `${location.key}mechanic${index + 1}`,
      role: "mechanic",
      locationKeys: [location.key],
    }));
    return [...managers, ...mechanics];
  }),
];

async function ensureCompany(client) {
  await client.query(
    `insert into companies (id, slug, name, active)
     values ($1, $2, $3, true)
     on conflict (id) do update
       set slug = excluded.slug,
           name = excluded.name,
           active = true,
           updated_at = now()`,
    [COMPANY_ID, COMPANY_SLUG, COMPANY_NAME],
  );
}

async function ensureLocations(client) {
  const result = new Map();
  for (const location of locations) {
    const existing = await client.query(
      `select id
         from locations
        where company_id = $1
          and lower(btrim(name)) = lower(btrim($2))
        order by created_at, id
        limit 1`,
      [COMPANY_ID, location.name],
    );
    if (existing.rows[0]) {
      await client.query(
        `update locations
            set type = 'yard',
                active = true,
                updated_at = now()
          where id = $1`,
        [existing.rows[0].id],
      );
      result.set(location.key, existing.rows[0].id);
      continue;
    }

    const created = await client.query(
      `insert into locations (company_id, name, type, active)
       values ($1, $2, 'yard', true)
       returning id`,
      [COMPANY_ID, location.name],
    );
    result.set(location.key, created.rows[0].id);
  }
  return result;
}

async function ensureAuthUser(user, password) {
  const pool = getPool();
  const existing = await pool.query("select id from auth_user where lower(email) = lower($1) limit 1", [user.email]);
  if (existing.rows[0]) return existing.rows[0].id;

  await auth.api.signUpEmail({
    body: {
      name: user.name,
      email: user.email,
      password,
      username: user.username,
      displayUsername: user.username,
    },
  });

  const created = await pool.query("select id from auth_user where lower(email) = lower($1) limit 1", [user.email]);
  if (!created.rows[0]) throw new Error(`Better Auth did not create ${user.email}.`);
  return created.rows[0].id;
}

async function linkOperationalUser(user, authUserId, locationIds) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const existing = await client.query(
      `select id
         from user_profiles
        where auth_user_id = $1
           or lower(contact_email) = lower($2)
        order by created_at, id
        limit 1
        for update`,
      [authUserId, user.email],
    );
    let appUserId = existing.rows[0]?.id;
    if (appUserId) {
      await client.query(
        `update user_profiles
            set display_name = $1,
                contact_email = $2,
                active = true,
                auth_user_id = $3,
                deleted_at = null,
                updated_at = now()
          where id = $4`,
        [user.name, user.email, authUserId, appUserId],
      );
    } else {
      const result = await client.query(
        `insert into user_profiles (display_name, contact_email, active, auth_user_id)
         values ($1, $2, true, $3)
         returning id`,
        [user.name, user.email, authUserId],
      );
      appUserId = result.rows[0].id;
    }

    await client.query(
      `insert into user_company_memberships (user_id, company_id, role, active)
       values ($1, $2, $3, true)
       on conflict (user_id, company_id) do update
         set role = excluded.role,
             active = true,
             updated_at = now()`,
      [appUserId, COMPANY_ID, user.role],
    );

    await client.query(
      `update user_location_memberships
          set active = false,
              updated_at = now()
        where user_id = $1
          and company_id = $2
          and location_id <> all($3::uuid[])`,
      [appUserId, COMPANY_ID, locationIds],
    );

    for (const locationId of locationIds) {
      await client.query(
        `insert into user_location_memberships (user_id, location_id, company_id, active)
         values ($1, $2, $3, true)
         on conflict (user_id, location_id) do update
           set company_id = excluded.company_id,
               active = true,
               updated_at = now()`,
        [appUserId, locationId, COMPANY_ID],
      );
    }

    await client.query("commit");
    return appUserId;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

async function seed() {
  const password = resolveDemoUserPassword();
  const client = await getPool().connect();
  let locationIds;
  try {
    await client.query("begin");
    await ensureCompany(client);
    locationIds = await ensureLocations(client);
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }

  const seeded = [];
  for (const user of demoUsers) {
    const authUserId = await ensureAuthUser(user, password);
    const userLocationIds = user.locationKeys.map((key) => {
      const locationId = locationIds.get(key);
      if (!locationId) throw new Error(`Missing seeded location ${key}.`);
      return locationId;
    });
    const appUserId = await linkOperationalUser(user, authUserId, userLocationIds);
    seeded.push({
      username: user.username,
      email: user.email,
      role: user.role,
      locations: user.locationKeys,
      appUserId,
    });
  }

  console.log(JSON.stringify({
    companyId: COMPANY_ID,
    locations: Object.fromEntries(locationIds),
    users: seeded,
  }, null, 2));
}

seed()
  .then(() => closePool())
  .catch(async (error) => {
    await closePool().catch(() => {});
    console.error(error.message);
    process.exit(1);
  });
