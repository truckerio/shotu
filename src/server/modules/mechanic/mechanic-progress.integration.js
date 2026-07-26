import assert from "node:assert/strict";
import { closePool, query } from "../../db/pool.js";
import {
  createOperationalWorkorder,
  getOperationalWorkorderById,
} from "../../db/repositories/operational-workorders.repo.js";
import {
  WorkorderProgressConflictError,
  saveMechanicWorkorderProgress,
} from "../../db/repositories/workorder-progress.repo.js";

const suffix = Date.now().toString(36);
let companyId;
let locationId;
let workorderId;
let mechanicId;
let otherMechanicId;
let officeId;

try {
  const company = await query(
    `insert into companies (slug, name) values ($1, $2) returning id`,
    [`progress-test-${suffix}`, `Progress Test ${suffix}`],
  );
  companyId = company.rows[0].id;
  const location = await query(
    `insert into locations (company_id, name, type) values ($1, $2, 'yard') returning id`,
    [companyId, `Progress Yard ${suffix}`],
  );
  locationId = location.rows[0].id;
  const users = await query(
    `
      insert into user_profiles (display_name, contact_email)
      values ($1, $2), ($3, $4), ($5, $6)
      returning id, contact_email
    `,
    [
      "Progress Mechanic",
      `progress-mechanic-${suffix}@example.test`,
      "Other Progress Mechanic",
      `other-progress-mechanic-${suffix}@example.test`,
      "Progress Office",
      `progress-office-${suffix}@example.test`,
    ],
  );
  mechanicId = users.rows.find((row) => row.contact_email.startsWith("progress-mechanic"))?.id;
  otherMechanicId = users.rows.find((row) => row.contact_email.startsWith("other-progress-mechanic"))?.id;
  officeId = users.rows.find((row) => row.contact_email.startsWith("progress-office"))?.id;
  await query(
    `
      insert into user_company_memberships (user_id, company_id, role)
      values ($1, $4, 'mechanic'), ($2, $4, 'mechanic'), ($3, $4, 'office')
    `,
    [mechanicId, otherMechanicId, officeId, companyId],
  );
  await query(
    `
      insert into user_location_memberships (user_id, location_id, company_id)
      values ($1, $4, $5), ($2, $4, $5), ($3, $4, $5)
    `,
    [mechanicId, otherMechanicId, officeId, locationId, companyId],
  );
  await query(
    `insert into workorder_serial_counters (company_id, prefix, next_number, digits)
     values ($1, $2, 1, 4)`,
    [companyId, `PR-${suffix}-`],
  );

  const workorder = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeId,
    mechanicUserIds: [mechanicId],
    concern: "Progress autosave integration test",
  });
  workorderId = workorder.id;

  const saved = await saveMechanicWorkorderProgress({
    workorderId,
    mechanicUserId: mechanicId,
    diagnosis: "Found a leak.",
    workPerformed: "Replaced the hose.",
    expectedVersion: 1,
    recordActivity: true,
  });
  assert.equal(saved.version, 2);
  assert.equal(saved.diagnosis, "Found a leak.");
  assert.equal(saved.workPerformed, "Replaced the hose.");
  assert.equal((await getOperationalWorkorderById(workorderId)).progressVersion, 2);

  const activity = await query(
    `select field_key, old_value, new_value from workorder_field_events
     where workorder_id = $1 and field_key = 'work_details_updated'`,
    [workorderId],
  );
  assert.equal(activity.rows.length, 1);
  assert.deepEqual(JSON.parse(activity.rows[0].old_value), {
    fieldsChanged: ["diagnosis", "workPerformed"],
  });

  const noOp = await saveMechanicWorkorderProgress({
    workorderId,
    mechanicUserId: mechanicId,
    diagnosis: "Found a leak.",
    workPerformed: "Replaced the hose.",
    expectedVersion: 2,
    recordActivity: true,
  });
  assert.equal(noOp.version, 2);
  const noOpActivity = await query(
    `select count(*)::int as count from workorder_field_events
     where workorder_id = $1 and field_key = 'work_details_updated'`,
    [workorderId],
  );
  assert.equal(noOpActivity.rows[0].count, 1);

  await assert.rejects(
    saveMechanicWorkorderProgress({
      workorderId,
      mechanicUserId: mechanicId,
      diagnosis: "Stale update",
      workPerformed: "",
      expectedVersion: 1,
    }),
    (error) => error instanceof WorkorderProgressConflictError,
  );
  assert.equal(
    await saveMechanicWorkorderProgress({
      workorderId,
      mechanicUserId: otherMechanicId,
      diagnosis: "Not allowed",
      workPerformed: "",
      expectedVersion: 2,
    }),
    null,
  );

  await query("update operational_workorders set status = 'closed' where id = $1", [workorderId]);
  await assert.rejects(
    saveMechanicWorkorderProgress({
      workorderId,
      mechanicUserId: mechanicId,
      diagnosis: "Locked",
      workPerformed: "",
      expectedVersion: 2,
    }),
    /completed workorder/,
  );

  console.log(JSON.stringify({
    passed: true,
    assignmentAuthorization: true,
    optimisticConflict: true,
    groupedActivity: true,
    terminalLock: true,
  }));
} finally {
  if (workorderId) await query("delete from operational_workorders where id = $1", [workorderId]);
  if (companyId) await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  const userIds = [mechanicId, otherMechanicId, officeId].filter(Boolean);
  if (userIds.length) await query("delete from user_profiles where id = any($1::uuid[])", [userIds]);
  if (locationId) await query("delete from locations where id = $1", [locationId]);
  if (companyId) await query("delete from companies where id = $1", [companyId]);
  await closePool();
}
