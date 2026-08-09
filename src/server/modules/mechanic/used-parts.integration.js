import assert from "node:assert/strict";
import { closePool, query } from "../../db/pool.js";
import {
  acceptOperationalWorkorder,
  createOperationalWorkorder,
  getOperationalWorkorderById,
} from "../../db/repositories/operational-workorders.repo.js";
import { saveOfficeUsedParts } from "../office/office.service.js";
import { updateMechanicUsedPartsSchema } from "../workorders/workorder.schemas.js";
import { saveMechanicUsedParts } from "./mechanic.service.js";

const suffix = Date.now().toString(36);
const companyKey = `used-parts-test-${suffix}`;
let companyId;
let locationId;
let workorderId;
let mechanicId;
let otherMechanicId;
let officeId;

try {
  const company = await query(
    `insert into companies (slug, name) values ($1, $2) returning id`,
    [companyKey, `Used Parts Test ${suffix}`],
  );
  companyId = company.rows[0].id;
  const location = await query(
    `insert into locations (company_id, name, type)
     values ($1, $2, 'yard') returning id`,
    [companyId, `Used Parts Yard ${suffix}`],
  );
  locationId = location.rows[0].id;

  const users = await query(
    `insert into user_profiles (display_name, contact_email)
     values
       ($1, $2),
       ($3, $4),
       ($5, $6)
     returning id, contact_email`,
    [
      "Used Parts Mechanic",
      `used-parts-mechanic-${suffix}@example.test`,
      "Other Mechanic",
      `other-mechanic-${suffix}@example.test`,
      "Used Parts Office",
      `used-parts-office-${suffix}@example.test`,
    ]
  );
  mechanicId = users.rows.find((user) => user.contact_email.startsWith("used-parts-mechanic"))?.id;
  otherMechanicId = users.rows.find((user) => user.contact_email.startsWith("other-mechanic"))?.id;
  officeId = users.rows.find((user) => user.contact_email.startsWith("used-parts-office"))?.id;
  await query(
    `insert into user_company_memberships (user_id, company_id, role)
     values ($1, $4, 'mechanic'), ($2, $4, 'mechanic'), ($3, $4, 'office')`,
    [mechanicId, otherMechanicId, officeId, companyId],
  );
  await query(
    `insert into user_location_memberships (user_id, location_id, company_id)
     values ($1, $4, $5), ($2, $4, $5), ($3, $4, $5)`,
    [mechanicId, otherMechanicId, officeId, locationId, companyId],
  );

  await query(
    `insert into workorder_serial_counters (company_id, prefix, next_number, digits)
     values ($1, $2, 1, 4)`,
    [companyId, `UP-${suffix}-`]
  );
  await query(
    `insert into location_workorder_policies (company_id, location_id, mechanic_can_record_parts)
     values ($1, $2, true)`,
    [companyId, locationId],
  );
  const workorder = await createOperationalWorkorder({
    companyId,
    locationId,
    createdByUserId: officeId,
    concern: "Used parts autosave integration test",
    formData: {
      companyName: "Preserve this company",
      unitNo: "TEST-101",
      parts: [{ requestId: "11111111-1111-4111-8111-111111111111", partNo: "APPROVED-1", qty: "1", repairOrder: "Legacy approved request projection" }],
    },
  });
  workorderId = workorder.id;
  await acceptOperationalWorkorder(workorderId, mechanicId);

  const input = updateMechanicUsedPartsSchema.parse({
    mechanicUserId: mechanicId,
    parts: [
      { partNo: "  LF14000NN  ", qty: 2, repairOrder: " Replace oil filter. " },
      { partNo: "", qty: "", repairOrder: "" },
    ],
  });
  assert.equal(input.parts[0].partNo, "LF14000NN");
  assert.equal(input.parts[0].qty, "2");
  assert.equal(input.parts[1].qty, "");
  assert.throws(() => updateMechanicUsedPartsSchema.parse({ mechanicUserId: mechanicId, parts: [{ partNo: "X", qty: 0, repairOrder: "" }] }));
  assert.throws(() => updateMechanicUsedPartsSchema.parse({ mechanicUserId: mechanicId, parts: Array.from({ length: 19 }, () => ({ partNo: "", qty: "", repairOrder: "" })) }));

  const saved = await saveMechanicUsedParts(workorderId, mechanicId, input.parts);
  assert.equal(saved.formData.companyName, "Preserve this company");
  assert.equal(saved.formData.unitNo, "TEST-101");
  assert.equal(saved.formData.parts.length, 2);
  assert.equal(saved.formData.parts[0].partNo, "LF14000NN");
  assert.equal(saved.formData.parts.some((part) => part.requestId), false);

  const auditAfterChange = await query(
    `select count(*)::int as count from workorder_field_events
     where workorder_id = $1 and field_key = 'formData.parts'`,
    [workorderId]
  );
  assert.equal(auditAfterChange.rows[0].count, 1);
  await saveMechanicUsedParts(workorderId, mechanicId, input.parts);
  const auditAfterNoop = await query(
    `select count(*)::int as count from workorder_field_events
     where workorder_id = $1 and field_key = 'formData.parts'`,
    [workorderId]
  );
  assert.equal(auditAfterNoop.rows[0].count, 1);

  const officeParts = updateMechanicUsedPartsSchema.parse({
    parts: [{
      partNo: "OFFICE-11011",
      qty: "3",
      uomCode: "pc",
      repairOrder: "Replace clutch assembly",
    }],
  }).parts;
  const officeSaved = await saveOfficeUsedParts(workorderId, {
    officeUserId: officeId,
    parts: officeParts,
  });
  assert.deepEqual(officeSaved.formData.parts, officeParts);
  assert.equal(officeSaved.formData.companyName, "Preserve this company");
  const officeAudit = await query(
    `select changed_by_user_id, count(*) over ()::int as count
     from workorder_field_events
     where workorder_id = $1 and field_key = 'formData.parts'
     order by created_at desc
     limit 1`,
    [workorderId],
  );
  assert.equal(officeAudit.rows[0].changed_by_user_id, officeId);
  assert.equal(officeAudit.rows[0].count, 2);
  await saveOfficeUsedParts(workorderId, { officeUserId: officeId, parts: officeParts });
  const officeAuditAfterNoop = await query(
    `select count(*)::int as count from workorder_field_events
     where workorder_id = $1 and field_key = 'formData.parts'`,
    [workorderId],
  );
  assert.equal(officeAuditAfterNoop.rows[0].count, 2);

  await assert.rejects(
    saveMechanicUsedParts(workorderId, otherMechanicId, input.parts),
    /Only an assigned mechanic/
  );
  await query("update user_profiles set active = false where id = $1", [mechanicId]);
  await assert.rejects(saveMechanicUsedParts(workorderId, mechanicId, input.parts), /Active workorder user not found/);
  await query("update user_profiles set active = true where id = $1", [mechanicId]);
  await query("update operational_workorders set status = 'mechanic_done' where id = $1", [workorderId]);
  const reviewParts = [{ ...officeParts[0], repairOrder: "Office review correction" }];
  assert.deepEqual(
    (await saveOfficeUsedParts(workorderId, { officeUserId: officeId, parts: reviewParts })).formData.parts,
    reviewParts,
  );
  await assert.rejects(saveMechanicUsedParts(workorderId, mechanicId, reviewParts), /completed workorder/);
  await query("update operational_workorders set status = 'odoo_entered' where id = $1", [workorderId]);
  await assert.rejects(
    saveOfficeUsedParts(workorderId, { officeUserId: officeId, parts: reviewParts }),
    /can no longer be changed/,
  );
  await assert.rejects(saveMechanicUsedParts(workorderId, mechanicId, input.parts), /completed workorder/);

  assert.equal((await getOperationalWorkorderById(workorderId)).formData.companyName, "Preserve this company");
  console.log(JSON.stringify({
    passed: true,
    autosave: true,
    preservedFormData: true,
    removesLegacyRequestProjections: true,
    authorization: true,
    officeAutosave: true,
    officeReviewCorrection: true,
    audit: true,
  }));
} finally {
  if (workorderId) await query("delete from operational_workorders where id = $1", [workorderId]);
  if (companyId) await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  if (locationId) await query("delete from location_workorder_policies where location_id = $1", [locationId]);
  const userIds = [mechanicId, otherMechanicId, officeId].filter(Boolean);
  if (userIds.length) await query("delete from user_profiles where id = any($1::uuid[])", [userIds]);
  if (locationId) await query("delete from locations where id = $1", [locationId]);
  if (companyId) await query("delete from companies where id = $1", [companyId]);
  await closePool();
}
