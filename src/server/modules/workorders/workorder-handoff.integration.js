import assert from "node:assert/strict";
import { closePool, query } from "../../db/pool.js";
import {
  WorkorderLifecycleConflictError,
  acceptOperationalWorkorder,
  cancelOperationalWorkorder,
  closeOperationalWorkorder,
  createOperationalWorkorder,
  getOperationalWorkorderById,
  getWorkorderTimeline,
  markOperationalWorkorderDone,
  recordWorkorderOpened,
  returnOperationalWorkorder,
  updateOperationalWorkorder,
} from "../../db/repositories/operational-workorders.repo.js";

const suffix = `${Date.now().toString(36)}-${process.pid}`;
let companyId;
let locationId;
let mechanicId;
let officeId;
let primaryWorkorderId;
let cancellationWorkorderId;
let acceptedWorkorderId;
let mechanicCreatedWorkorderId;
let inventoryId;

try {
  companyId = (await query(
    "insert into companies (slug, name) values ($1, $2) returning id",
    [`handoff-${suffix}`, `Handoff ${suffix}`],
  )).rows[0].id;
  locationId = (await query(
    "insert into locations (company_id, name, type) values ($1, $2, 'yard') returning id",
    [companyId, `Handoff Yard ${suffix}`],
  )).rows[0].id;
  const users = await query(
    `insert into user_profiles (display_name, contact_email)
     values ($1, $2), ($3, $4) returning id, contact_email`,
    [
      "Handoff Mechanic",
      `handoff-mechanic-${suffix}@example.test`,
      "Handoff Manager",
      `handoff-manager-${suffix}@example.test`,
    ],
  );
  mechanicId = users.rows.find((row) => row.contact_email.includes("mechanic"))?.id;
  officeId = users.rows.find((row) => row.contact_email.includes("manager"))?.id;
  await query(
    `insert into user_company_memberships (user_id, company_id, role)
     values ($1, $3, 'mechanic'), ($2, $3, 'office')`,
    [mechanicId, officeId, companyId],
  );
  await query(
    `insert into user_location_memberships (user_id, location_id, company_id)
     values ($1, $3, $4), ($2, $3, $4)`,
    [mechanicId, officeId, locationId, companyId],
  );
  await query(
    "insert into workorder_serial_counters (company_id, prefix, next_number, digits) values ($1, $2, 1, 4)",
    [companyId, `HF-${Date.now()}-`],
  );

  const available = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeId,
    concern: "Verify atomic accept and start",
  });
  acceptedWorkorderId = available.id;
  const concurrentAccepts = await Promise.allSettled([
    acceptOperationalWorkorder(available.id, mechanicId),
    acceptOperationalWorkorder(available.id, mechanicId),
  ]);
  assert.equal(concurrentAccepts.filter((result) => result.status === "fulfilled").length, 1);
  assert.equal(concurrentAccepts.filter((result) => result.status === "rejected").length, 1);
  const accepted = await getOperationalWorkorderById(available.id);
  assert.equal(accepted.status, "in_progress");
  assert.ok(accepted.startedAt);

  const mechanicCreated = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: mechanicId,
    mechanicUserIds: [mechanicId],
    startImmediately: true,
    concern: "Verify mechanic creation starts immediately",
  });
  mechanicCreatedWorkorderId = mechanicCreated.id;
  assert.equal(mechanicCreated.status, "in_progress");
  assert.ok(mechanicCreated.startedAt);

  const created = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeId,
    mechanicUserIds: [mechanicId],
    concern: "Verify mechanic Manager handoff",
    formData: { mechanicName: "Original mechanic evidence", customerCompanyName: "Before correction" },
  });
  primaryWorkorderId = created.id;
  assert.equal(created.status, "accepted");
  assert.equal(created.startedAt, null);

  const managerOpen = await recordWorkorderOpened({ workorderId: created.id, userId: officeId, actorRole: "office" });
  assert.equal(managerOpen.started, false);
  assert.equal((await getOperationalWorkorderById(created.id)).startedAt, null);

  const mechanicOpen = await recordWorkorderOpened({ workorderId: created.id, userId: mechanicId, actorRole: "mechanic" });
  assert.equal(mechanicOpen.started, true);
  const started = await getOperationalWorkorderById(created.id);
  assert.equal(started.status, "in_progress");
  assert.ok(started.startedAt);
  const originalStart = new Date(started.startedAt).toISOString();
  const reopened = await recordWorkorderOpened({ workorderId: created.id, userId: mechanicId, actorRole: "mechanic" });
  assert.equal(reopened.started, false);
  assert.equal(new Date((await getOperationalWorkorderById(created.id)).startedAt).toISOString(), originalStart);

  const firstDone = await markOperationalWorkorderDone(created.id, mechanicId, {
    diagnosis: "Initial diagnosis",
    workPerformed: "Initial repair",
  });
  assert.equal(firstDone.status, "mechanic_done");
  assert.ok(firstDone.mechanicDoneAt);
  const firstDoneAt = new Date(firstDone.mechanicDoneAt).toISOString();

  const returned = await returnOperationalWorkorder(created.id, officeId, {
    reason: "Add the final verification result.",
    categories: ["work_performed"],
  });
  assert.equal(returned.status, "in_progress");
  assert.equal(returned.mechanicDoneAt, null);
  const revision = await query(
    `select active, details from workorder_attention_state
     where workorder_id = $1 and reason = 'revision_requested'`,
    [created.id],
  );
  assert.equal(revision.rows[0].active, true);
  assert.equal(revision.rows[0].details.previousMechanicDoneAt, firstDoneAt);

  const secondDone = await markOperationalWorkorderDone(created.id, mechanicId, {
    diagnosis: "Initial diagnosis",
    workPerformed: "Initial repair and final verification",
  });
  assert.equal(secondDone.status, "mechanic_done");
  assert.ok(secondDone.mechanicDoneAt);
  assert.equal((await query(
    `select active from workorder_attention_state
     where workorder_id = $1 and reason = 'revision_requested'`,
    [created.id],
  )).rows[0].active, false);
  const completionEvents = (await getWorkorderTimeline(created.id))
    .filter((event) => event.type === "status" && event.to_status === "mechanic_done");
  assert.equal(completionEvents.length, 2);

  const approved = await closeOperationalWorkorder(created.id, officeId, "Manager approved verified work.");
  assert.equal(approved.status, "closed");
  assert.equal(approved.approvedByUserId, officeId);
  assert.equal(new Date(approved.mechanicDoneAt).toISOString(), new Date(secondDone.mechanicDoneAt).toISOString());

  await query(
    `insert into workorder_attention_state (workorder_id, reason, details, opened_by_user_id)
     values ($1, 'missing_info', $2::jsonb, $3)`,
    [created.id, JSON.stringify({ note: "Confirm customer company." }), officeId],
  );
  const corrected = await updateOperationalWorkorder(created.id, {
    officeNotes: "Customer company confirmed for Surveillance.",
    formData: {
      mechanicName: "Tampered evidence",
      customerCompanyName: "Corrected customer",
      mechanicConcern: "Corrected concern",
      workStartDate: "2026-07-30",
      workEndDate: "2026-07-31",
    },
    changedByUserId: officeId,
  });
  assert.equal(corrected.formData.mechanicName, "Original mechanic evidence");
  assert.equal(corrected.formData.customerCompanyName, "Corrected customer");
  assert.equal(corrected.formData.mechanicConcern, "Corrected concern");
  assert.equal(corrected.formData.workStartDate, "2026-07-30");
  assert.equal(corrected.formData.workEndDate, "2026-07-31");
  await assert.rejects(
    cancelOperationalWorkorder(created.id, officeId, "Too late"),
    (error) => error instanceof WorkorderLifecycleConflictError && error.statusCode === 409,
  );

  const cancellationTarget = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeId,
    mechanicUserIds: [mechanicId],
    concern: "Verify cancellation cleanup",
  });
  cancellationWorkorderId = cancellationTarget.id;
  inventoryId = (await query(
    `insert into inventory_items (
       company_id, location_id, normalized_part_number, part_number,
       quantity_on_hand, quantity_reserved, uom_code
     ) values ($1, $2, $3, $4, 10, 2, 'pc') returning id`,
    [companyId, locationId, `cancel-${suffix}`, `CANCEL-${suffix}`],
  )).rows[0].id;
  const partRequestId = (await query(
    `insert into workorder_part_requests (
       workorder_id, requested_by_user_id, raw_query, part_number,
       normalized_part_number, quantity, uom_code, approval_status
     ) values ($1, $2, $3, $3, $4, 2, 'pc', 'approved') returning id`,
    [cancellationTarget.id, mechanicId, `CANCEL-${suffix}`, `cancel-${suffix}`],
  )).rows[0].id;
  await query(
    `insert into part_allocations (
       part_request_id, source_type, status, quantity, uom_code,
       location_id, inventory_item_id, created_by_user_id
     ) values ($1, 'inventory', 'reserved', 2, 'pc', $2, $3, $4)`,
    [partRequestId, locationId, inventoryId, officeId],
  );

  const cancelled = await cancelOperationalWorkorder(cancellationTarget.id, officeId, "Duplicate workorder");
  assert.equal(cancelled.status, "cancelled");
  assert.equal(cancelled.cancelledByUserId, officeId);
  assert.equal(cancelled.cancelReason, "Duplicate workorder");
  assert.equal((await query("select quantity_reserved from inventory_items where id = $1", [inventoryId])).rows[0].quantity_reserved, "0.000");
  assert.equal((await query("select status from part_allocations where part_request_id = $1", [partRequestId])).rows[0].status, "cancelled");
  assert.equal((await query("select approval_status from workorder_part_requests where id = $1", [partRequestId])).rows[0].approval_status, "cancelled");
  assert.equal((await query(
    "select count(*)::int as count from workorder_mechanic_assignments where workorder_id = $1 and active = true",
    [cancellationTarget.id],
  )).rows[0].count, 0);

  console.log(JSON.stringify({
    passed: true,
    canonicalStart: true,
    atomicAccept: true,
    mechanicCreationStart: true,
    idempotentOpen: true,
    workDoneAndReturn: true,
    approvalActor: true,
    protectedMechanicEvidence: true,
    transactionalCancellationCleanup: true,
  }));
} finally {
  if (primaryWorkorderId || cancellationWorkorderId || acceptedWorkorderId || mechanicCreatedWorkorderId) {
    await query("delete from operational_workorders where id = any($1::uuid[])", [[
      primaryWorkorderId,
      cancellationWorkorderId,
      acceptedWorkorderId,
      mechanicCreatedWorkorderId,
    ].filter(Boolean)]).catch(() => {});
  }
  if (inventoryId) await query("delete from inventory_items where id = $1", [inventoryId]).catch(() => {});
  if (companyId) await query("delete from workorder_serial_counters where company_id = $1", [companyId]).catch(() => {});
  const userIds = [mechanicId, officeId].filter(Boolean);
  if (userIds.length) await query("delete from user_profiles where id = any($1::uuid[])", [userIds]).catch(() => {});
  if (locationId) await query("delete from locations where id = $1", [locationId]).catch(() => {});
  if (companyId) await query("delete from companies where id = $1", [companyId]).catch(() => {});
  await closePool();
}
