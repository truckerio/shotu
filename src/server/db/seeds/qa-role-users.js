import { auth } from "../../auth/auth.js";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { closePool, getPool } from "../pool.js";
import { resolveDemoUserPassword } from "./demo-seed-policy.js";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const LOCATION_NAME = "Chino Yard";
const USERS = Object.freeze([
  { name: "QA Admin", email: "qa.admin@example.test", username: "qaadmin", role: "admin" },
  { name: "QA Office", email: "qa.office@example.test", username: "qaoffice", role: "office" },
  { name: "QA Mechanic", email: "qa.mechanic@example.test", username: "qamechanic", role: "mechanic" },
  { name: "QA Surveillance", email: "qa.surveillance@example.test", username: "qasurveillance", role: "surveillance" },
]);

async function authUser(user, password) {
  const pool = getPool();
  const existing = await pool.query(
    "select id from auth_user where lower(email) = lower($1) limit 1",
    [user.email],
  );
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
  const created = await pool.query(
    "select id from auth_user where lower(email) = lower($1) limit 1",
    [user.email],
  );
  if (!created.rows[0]) throw new Error(`Unable to create ${user.username}.`);
  return created.rows[0].id;
}

async function operationalUser(client, user, authUserId, locationId) {
  const existing = await client.query(
    `select id from user_profiles
     where auth_user_id = $1 or lower(contact_email) = lower($2)
     order by created_at, id limit 1`,
    [authUserId, user.email],
  );
  const profile = existing.rows[0] || (await client.query(
    `insert into user_profiles (display_name, contact_email, active, auth_user_id)
     values ($1, $2, true, $3) returning id`,
    [user.name, user.email, authUserId],
  )).rows[0];
  await client.query(
    `update user_profiles set display_name = $1, contact_email = $2, active = true,
       auth_user_id = $3, deleted_at = null, updated_at = now() where id = $4`,
    [user.name, user.email, authUserId, profile.id],
  );
  await client.query(
    `insert into user_company_memberships (user_id, company_id, role, active)
     values ($1, $2, $3, true)
     on conflict (user_id, company_id) do update
       set role = excluded.role, active = true, updated_at = now()`,
    [profile.id, COMPANY_ID, user.role],
  );
  await client.query(
    `insert into user_location_memberships (user_id, location_id, company_id, active)
     values ($1, $2, $3, true)
     on conflict (user_id, location_id) do update
       set company_id = excluded.company_id, active = true, updated_at = now()`,
    [profile.id, locationId, COMPANY_ID],
  );
  return profile.id;
}

async function seed() {
  const password = resolveDemoUserPassword();
  const pool = getPool();
  const location = await pool.query(
    `select id from locations
     where company_id = $1 and lower(btrim(name)) = lower($2) and active = true
     limit 1`,
    [COMPANY_ID, LOCATION_NAME],
  );
  if (!location.rows[0]) throw new Error(`Create the local ${LOCATION_NAME} location first.`);

  const created = [];
  for (const user of USERS) {
    const authUserId = await authUser(user, password);
    const client = await pool.connect();
    try {
      await client.query("begin");
      const userId = await operationalUser(client, user, authUserId, location.rows[0].id);
      await client.query("commit");
      created.push({ username: user.username, role: user.role, userId });
    } catch (error) {
      await client.query("rollback").catch(() => {});
      throw error;
    } finally {
      client.release();
    }
  }
  console.log(JSON.stringify({ companyId: COMPANY_ID, locationId: location.rows[0].id, users: created }));
}

seed()
  .then(() => closePool())
  .catch(async (error) => {
    await closePool().catch(() => {});
    console.error(error.message);
    process.exit(1);
  });
