import { auth } from "../../auth/auth.js";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { closePool, getPool } from "../pool.js";

const DEFAULT_PASSWORD = "WorkorderDemo2026!";
const COMPANY_ID = DEFAULT_COMPANY_ID;
const LOCATION_NAME = "Chino Yard";

const demoUsers = [
  { name: "Admin Demo", email: "admin@example.com", username: "admin", role: "admin" },
  { name: "Office Demo", email: "office@example.com", username: "office", role: "office" },
  { name: "Mechanic Demo 1", email: "mechanic@example.com", username: "mechanic1", role: "mechanic" },
  { name: "Mechanic Demo 2", email: "mechanic2@example.com", username: "mechanic2", role: "mechanic" },
  { name: "Mechanic Demo 3", email: "mechanic3@example.com", username: "mechanic3", role: "mechanic" },
  { name: "Mechanic Demo 4", email: "mechanic4@example.com", username: "mechanic4", role: "mechanic" },
  { name: "Mechanic Demo 5", email: "mechanic5@example.com", username: "mechanic5", role: "mechanic" },
  { name: "Surveillance Demo", email: "surveillance@example.com", username: "surveillance", role: "surveillance" },
];

function seedPassword() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_USER_SEED !== "true") {
    throw new Error("Demo users are disabled in production. Set ALLOW_DEMO_USER_SEED=true to seed intentionally.");
  }
  const password = process.env.DEMO_USER_PASSWORD || DEFAULT_PASSWORD;
  if (password.length < 12) throw new Error("DEMO_USER_PASSWORD must contain at least 12 characters.");
  return password;
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

async function ensureLocation(client) {
  const existing = await client.query(
    `select id
      from locations
      where company_id = $1 and lower(name) = lower($2) and active = true
      order by created_at, id
      limit 1`,
    [COMPANY_ID, LOCATION_NAME],
  );
  if (existing.rows[0]) return existing.rows[0].id;

  const created = await client.query(
    "insert into locations (company_id, name, type) values ($1, $2, 'yard') returning id",
    [COMPANY_ID, LOCATION_NAME],
  );
  return created.rows[0].id;
}

async function linkOperationalUser(user, authUserId, locationId) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const result = await client.query(
      `insert into user_profiles (display_name, contact_email, active, auth_user_id)
       values ($1, $2, true, $3)
       on conflict (auth_user_id) do update
         set display_name = excluded.display_name,
             contact_email = excluded.contact_email,
             active = true,
             auth_user_id = excluded.auth_user_id,
             updated_at = now()
       returning id`,
      [user.name, user.email, authUserId],
    );
    const appUserId = result.rows[0].id;

    await client.query(
      `insert into user_location_memberships (user_id, location_id, company_id, active)
       values ($1, $2, $3, true)
       on conflict (user_id, location_id) do update set active = true, updated_at = now()`,
      [appUserId, locationId, COMPANY_ID],
    );
    await client.query(
      `insert into user_company_memberships (user_id, company_id, role, active)
       values ($1, $2, $3, true)
       on conflict (user_id, company_id) do update
         set role = excluded.role,
             active = true,
             updated_at = now()`,
      [appUserId, COMPANY_ID, user.role],
    );
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
  const password = seedPassword();
  const client = await getPool().connect();
  let locationId;
  try {
    locationId = await ensureLocation(client);
  } finally {
    client.release();
  }

  const seeded = [];
  for (const user of demoUsers) {
    const authUserId = await ensureAuthUser(user, password);
    const appUserId = await linkOperationalUser(user, authUserId, locationId);
    seeded.push({ username: user.username, email: user.email, role: user.role, appUserId });
  }

  console.log(JSON.stringify({ companyId: COMPANY_ID, locationId, users: seeded }, null, 2));
}

seed()
  .then(() => closePool())
  .catch(async (error) => {
    await closePool().catch(() => {});
    console.error(error.message);
    process.exit(1);
  });
