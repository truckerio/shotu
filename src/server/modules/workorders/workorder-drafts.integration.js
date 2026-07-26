import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { closePool, query } from "../../db/pool.js";
import {
  createUserWorkorderDraft,
  submitUserWorkorderDraft,
  updateUserWorkorderDraft,
} from "./workorder-drafts.service.js";

const companyId = randomUUID();
const locationId = randomUUID();
const officeUserId = randomUUID();
const slug = `draft-test-${companyId.slice(0, 8)}`;
const context = {
  actor: { id: officeUserId, role: "office" },
  companyIds: new Set([companyId]),
  locationIds: new Set([locationId]),
};

async function serialState() {
  const result = await query(
    `select
       (select count(*)::integer from operational_workorders where company_id = $1) as workorders,
       (select next_number from workorder_serial_counters where company_id = $1) as next_number`,
    [companyId],
  );
  return result.rows[0];
}

async function cleanup() {
  await query("delete from workorder_drafts where company_id = $1", [companyId]);
  await query("delete from operational_workorders where company_id = $1", [companyId]);
  await query("delete from workorder_serial_counters where company_id = $1", [companyId]);
  await query("delete from user_location_memberships where company_id = $1", [companyId]);
  await query("delete from user_company_memberships where company_id = $1", [companyId]);
  await query("delete from user_profiles where id = $1", [officeUserId]);
  await query("delete from locations where id = $1", [locationId]);
  await query("delete from companies where id = $1", [companyId]);
}

try {
  await query(
    "insert into companies (id, slug, name) values ($1, $2, 'Draft integration test')",
    [companyId, slug],
  );
  await query(
    "insert into locations (id, company_id, name, type) values ($1, $2, 'Draft Yard', 'yard')",
    [locationId, companyId],
  );
  await query(
    "insert into user_profiles (id, display_name) values ($1, 'Draft Test Office')",
    [officeUserId],
  );
  await query(
    "insert into user_company_memberships (user_id, company_id, role) values ($1, $2, 'office')",
    [officeUserId, companyId],
  );
  await query(
    "insert into user_location_memberships (user_id, location_id, company_id) values ($1, $2, $3)",
    [officeUserId, locationId, companyId],
  );

  const invalidDraft = await createUserWorkorderDraft(context, {
    type: "workorder",
    locationId,
    payload: { formData: { unitNo: "DRAFT-INVALID" } },
  });
  const beforeInvalid = await serialState();
  await assert.rejects(
    submitUserWorkorderDraft(context, invalidDraft.id, { version: invalidDraft.version }),
    /Concern is required/,
  );
  assert.deepEqual(await serialState(), beforeInvalid);

  const draft = await createUserWorkorderDraft(context, {
    type: "workorder",
    locationId: null,
    payload: { formData: { unitNo: "DRAFT-VALID" } },
  });
  const saved = await updateUserWorkorderDraft(context, draft.id, {
    version: draft.version,
    locationId,
    payload: { concern: "Verify draft submission." },
  });
  const submitted = await submitUserWorkorderDraft(context, draft.id, { version: saved.version });
  assert.equal(submitted.draft.status, "submitted");
  assert.equal(submitted.draft.submittedWorkorderId, submitted.workorder.id);
  assert.equal(submitted.workorder.serial, "WO-000001");

  const afterFirstSubmit = await serialState();
  const repeated = await submitUserWorkorderDraft(context, draft.id, { version: draft.version });
  assert.equal(repeated.workorder.id, submitted.workorder.id);
  assert.equal(repeated.workorder.serial, submitted.workorder.serial);
  assert.deepEqual(await serialState(), afterFirstSubmit);

  process.stdout.write(`${JSON.stringify({
    passed: true,
    validationRollbackPreservedSerial: true,
    submittedAtomically: true,
    repeatedSubmitIdempotent: true,
  })}\n`);
} finally {
  await cleanup();
  await closePool();
}
