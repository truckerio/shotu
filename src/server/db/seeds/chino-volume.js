import { DEFAULT_COMPANY_ID } from "../company.js";
import { closePool, getPool } from "../pool.js";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const LOCATION_NAME = "Chino Yard";
const DEFAULT_COUNT = 500;
const FIXTURE_KEY = "chino-volume-v1";

function requestedCount() {
  const count = Number(process.env.CHINO_WORKORDER_COUNT || DEFAULT_COUNT);
  if (!Number.isInteger(count) || count < 1 || count > 5000) {
    throw new Error("CHINO_WORKORDER_COUNT must be an integer between 1 and 5000.");
  }
  return count;
}

function statusFor(index, count) {
  const ratio = index / count;
  if (ratio <= 0.06) return "open";
  if (ratio <= 0.12) return "accepted";
  if (ratio <= 0.22) return "in_progress";
  if (ratio <= 0.34) return "mechanic_done";
  if (ratio <= 0.86) return "closed";
  return "odoo_entered";
}

async function resolveSeedContext(client) {
  const location = await client.query(
    `select id
       from locations
      where company_id = $1
        and lower(btrim(name)) = lower($2)
        and active = true
      limit 1`,
    [COMPANY_ID, LOCATION_NAME],
  );
  if (!location.rows[0]) throw new Error("Run npm run db:seed-demo-users before seeding Chino volume.");

  const creator = await client.query(
    `select profile.id
       from user_profiles profile
       join user_company_memberships membership
         on membership.user_id = profile.id
        and membership.company_id = $1
        and membership.role in ('admin', 'office')
        and membership.active = true
      join user_location_memberships location_membership
        on location_membership.user_id = profile.id
       and location_membership.location_id = $2
       and location_membership.active = true
      where profile.active = true
        and profile.deleted_at is null
      order by case membership.role when 'admin' then 0 else 1 end, profile.created_at
      limit 1`,
    [COMPANY_ID, location.rows[0].id],
  );
  if (!creator.rows[0]) throw new Error("Chino volume seed requires an active Chino admin or office user.");

  const mechanics = await client.query(
    `select profile.id, profile.display_name
       from user_profiles profile
       join user_company_memberships membership
         on membership.user_id = profile.id
        and membership.company_id = $1
        and membership.role = 'mechanic'
        and membership.active = true
      join user_location_memberships location_membership
        on location_membership.user_id = profile.id
       and location_membership.location_id = $2
       and location_membership.active = true
      where profile.active = true
        and profile.deleted_at is null
      order by profile.display_name`,
    [COMPANY_ID, location.rows[0].id],
  );
  if (mechanics.rows.length < 1) throw new Error("Chino volume seed requires active Chino mechanics.");

  return {
    locationId: location.rows[0].id,
    creatorId: creator.rows[0].id,
    mechanics: mechanics.rows,
  };
}

async function clearExistingFixture(client) {
  const deleted = await client.query(
    `delete from operational_workorders
      where company_id = $1
        and form_data->'loadFixture'->>'key' = $2`,
    [COMPANY_ID, FIXTURE_KEY],
  );
  return deleted.rowCount || 0;
}

async function seedWorkorders(client, { count, locationId, creatorId, mechanics }) {
  const created = [];
  for (let index = 1; index <= count; index += 1) {
    const status = statusFor(index, count);
    const mechanic = mechanics[(index - 1) % mechanics.length];
    const createdDaysAgo = Math.floor(((index - 1) / count) * 30);
    const createdAt = new Date(Date.now() - createdDaysAgo * 24 * 60 * 60 * 1000 - (index % 24) * 60 * 60 * 1000);
    const updatedAt = new Date(createdAt.getTime() + Math.min(createdDaysAgo + 1, 7) * 60 * 60 * 1000);
    const serial = `CHLOAD-${String(index).padStart(5, "0")}`;
    const unitNo = `CH-${String(1000 + index).padStart(4, "0")}`;
    const concern = `Chino monthly volume fixture ${index}: ${index % 4 === 0 ? "inspection" : index % 4 === 1 ? "brake check" : index % 4 === 2 ? "air leak" : "service repair"}`;
    const formData = {
      unitNo,
      unitType: index % 7 === 0 ? "Trailer" : "Truck",
      dateRange: createdAt.toISOString().slice(0, 10),
      startDate: createdAt.toISOString().slice(0, 10),
      endDate: createdAt.toISOString().slice(0, 10),
      licenseNo: `CH${String(index).padStart(5, "0")}`,
      mileage: String(200000 + index * 31),
      model: index % 7 === 0 ? "2023 VANGUARD TRAILER" : "2020 FREIGHTLINER CASCADIA",
      vinNo: `CHINOVIN${String(index).padStart(9, "0")}`,
      companyName: "Chino Yard",
      customerCompanyName: index % 3 === 0 ? "SPG Transportation" : "Long Haul",
      mechanicName: status === "open" ? "" : mechanic.display_name,
      mechanicConcern: concern,
      loadFixture: {
        key: FIXTURE_KEY,
        monthVolume: count,
        location: "chino",
        generatedAt: new Date().toISOString(),
      },
    };

    const workorder = await client.query(
      `insert into operational_workorders (
         company_id, serial, location_id, created_by_user_id, status, concern,
         diagnosis, work_performed, office_notes, form_data,
         accepted_at, started_at, mechanic_done_at, closed_at, created_at, updated_at
       )
       values (
         $1, $2, $3, $4, $5, $6,
         $7, $8, $9, $10::jsonb,
         $11, $12, $13, $14, $15, $16
       )
       returning id`,
      [
        COMPANY_ID,
        serial,
        locationId,
        creatorId,
        status,
        concern,
        status === "open" || status === "accepted" ? "" : `Diagnosis recorded for ${unitNo}.`,
        ["mechanic_done", "closed", "odoo_entered"].includes(status) ? `Completed work for ${unitNo}.` : "",
        index % 11 === 0 ? "Office follow-up needed on parts ETA." : "",
        JSON.stringify(formData),
        status === "open" ? null : createdAt,
        ["in_progress", "mechanic_done", "closed", "odoo_entered"].includes(status) ? updatedAt : null,
        ["mechanic_done", "closed", "odoo_entered"].includes(status) ? updatedAt : null,
        ["closed", "odoo_entered"].includes(status) ? updatedAt : null,
        createdAt,
        updatedAt,
      ],
    );
    const workorderId = workorder.rows[0].id;

    await client.query(
      `insert into workorder_status_events (
         workorder_id, from_status, to_status, changed_by_user_id, note, created_at
       )
       values ($1, null, $2, $3, $4, $5)`,
      [workorderId, status, creatorId, "Seeded Chino monthly volume fixture.", createdAt],
    );

    if (status !== "open") {
      await client.query(
        `insert into workorder_mechanic_assignments (
           workorder_id, mechanic_user_id, assignment_role, active, assigned_by_user_id, assigned_at, reason
         )
         values ($1, $2, 'primary', true, $3, $4, $5)`,
        [workorderId, mechanic.id, creatorId, createdAt, "Seeded for Chino monthly volume check."],
      );
    }

    if (index % 13 === 0 && status !== "open") {
      const supportMechanic = mechanics[index % mechanics.length];
      if (supportMechanic.id !== mechanic.id) {
        await client.query(
          `insert into workorder_mechanic_assignments (
             workorder_id, mechanic_user_id, assignment_role, active, assigned_by_user_id, assigned_at, reason
           )
           values ($1, $2, 'support', true, $3, $4, $5)`,
          [workorderId, supportMechanic.id, creatorId, updatedAt, "Seeded support mechanic volume check."],
        );
      }
    }

    created.push({ status, mechanicId: status === "open" ? null : mechanic.id });
  }
  return created;
}

async function seed() {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_DEMO_USER_SEED !== "true") {
    throw new Error("Chino volume seed is disabled in production. Set ALLOW_DEMO_USER_SEED=true to run intentionally.");
  }

  const count = requestedCount();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const context = await resolveSeedContext(client);
    const removed = await clearExistingFixture(client);
    const created = await seedWorkorders(client, { count, ...context });
    await client.query("commit");

    const byStatus = created.reduce((accumulator, workorder) => {
      accumulator[workorder.status] = (accumulator[workorder.status] || 0) + 1;
      return accumulator;
    }, {});
    const assigned = created.filter((workorder) => workorder.mechanicId).length;
    console.log(JSON.stringify({
      fixture: FIXTURE_KEY,
      location: LOCATION_NAME,
      removed,
      created: created.length,
      assigned,
      mechanics: context.mechanics.length,
      byStatus,
    }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

seed()
  .then(() => closePool())
  .catch(async (error) => {
    await closePool().catch(() => {});
    console.error(error.message);
    process.exit(1);
  });
