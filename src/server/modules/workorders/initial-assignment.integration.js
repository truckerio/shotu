import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, query } from "../../db/pool.js";
import { createOperationalWorkorder } from "../../db/repositories/operational-workorders.repo.js";

const companyId = randomUUID();
const locationId = randomUUID();
const officeUserId = randomUUID();
const mechanicUserIds = [randomUUID(), randomUUID()];
const slug = `assignment-test-${companyId.slice(0, 8)}`;

async function cleanup() {
  await query("delete from operational_workorders where company_id = $1", [companyId]);
  await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  await query("delete from user_location_memberships where company_id = $1", [companyId]);
  await query("delete from user_company_memberships where company_id = $1", [companyId]);
  await query("delete from user_profiles where id = any($1::uuid[])", [[officeUserId, ...mechanicUserIds]]);
  await query("delete from locations where id = $1", [locationId]);
  await query("delete from companies where id = $1", [companyId]);
}

try {
  await query(
    "insert into companies (id, slug, name) values ($1, $2, 'Initial assignment test')",
    [companyId, slug],
  );
  await query(
    "insert into locations (id, company_id, name, type) values ($1, $2, 'Test Yard', 'yard')",
    [locationId, companyId],
  );
  await query(
    `
      insert into user_profiles (id, display_name)
      values ($1, 'Test Office'), ($2, 'Test Mechanic One'), ($3, 'Test Mechanic Two')
    `,
    [officeUserId, ...mechanicUserIds],
  );
  await query(
    `
      insert into user_company_memberships (user_id, company_id, role)
      values ($1, $4, 'office'), ($2, $4, 'mechanic'), ($3, $4, 'mechanic')
    `,
    [officeUserId, ...mechanicUserIds, companyId],
  );
  await query(
    `
      insert into user_location_memberships (user_id, location_id, company_id)
      values ($1, $4, $5), ($2, $4, $5), ($3, $4, $5)
    `,
    [officeUserId, ...mechanicUserIds, locationId, companyId],
  );

  const workorder = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeUserId,
    concern: "Verify atomic initial assignment.",
    mechanicUserIds,
    formData: {},
  });

  assert.equal(workorder.status, "accepted");
  assert.deepEqual(workorder.mechanicIds, mechanicUserIds);
  assert.equal(workorder.mechanic.id, mechanicUserIds[0]);

  const assignments = await query(
    `
      select mechanic_user_id, assignment_role, assigned_by_user_id, reason
      from workorder_mechanic_assignments
      where workorder_id = $1 and active
      order by case assignment_role when 'primary' then 0 else 1 end, assigned_at
    `,
    [workorder.id],
  );
  assert.deepEqual(
    assignments.rows.map((row) => row.assignment_role),
    ["primary", "support"],
  );
  assert.ok(assignments.rows.every((row) => row.assigned_by_user_id === officeUserId));
  assert.ok(assignments.rows.every((row) => row.reason === "Assigned when workorder was created."));

  const assignmentEvents = await query(
    `
      select to_mechanic_id, action, changed_by_user_id, reason
      from workorder_assignment_events
      where workorder_id = $1
      order by created_at, id
    `,
    [workorder.id],
  );
  assert.equal(assignmentEvents.rows.length, 2);
  assert.ok(assignmentEvents.rows.every((row) => row.action === "reassigned"));
  assert.ok(assignmentEvents.rows.every((row) => row.changed_by_user_id === officeUserId));

  const statusEvents = await query(
    `
      select from_status, to_status
      from workorder_status_events
      where workorder_id = $1
    `,
    [workorder.id],
  );
  assert.equal(statusEvents.rows.length, 2);
  assert.ok(statusEvents.rows.some((row) => row.from_status === null && row.to_status === "open"));
  assert.ok(statusEvents.rows.some((row) => row.from_status === "open" && row.to_status === "accepted"));

  const beforeFailure = await query(
    `
      select
        (select count(*)::integer from operational_workorders where company_id = $1) as workorders,
        (select next_number from workorder_serial_counters where company_id = $1) as next_number
    `,
    [companyId],
  );
  await assert.rejects(
    createOperationalWorkorder({
      companyId,
      locationId,
      createdByUserId: officeUserId,
      concern: "This creation must roll back.",
      mechanicUserIds: [randomUUID()],
      formData: {},
    }),
    /Every selected mechanic must be active at this workorder location/,
  );
  const afterFailure = await query(
    `
      select
        (select count(*)::integer from operational_workorders where company_id = $1) as workorders,
        (select next_number from workorder_serial_counters where company_id = $1) as next_number
    `,
    [companyId],
  );
  assert.deepEqual(afterFailure.rows[0], beforeFailure.rows[0]);

  process.stdout.write(`${JSON.stringify({
    passed: true,
    assignedAtomically: true,
    primaryAndSupport: true,
    historyRecorded: true,
    rollbackPreservedSerial: true,
  })}\n`);
} finally {
  await cleanup();
  await closePool();
}
