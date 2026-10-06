import assert from "node:assert/strict";
import test from "node:test";
import {
  assertCurrentExternalEstimateAccepted,
  CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED,
  isRepairProgressMutation,
} from "./workorder-customer-authorization.repo.js";

function clientWith(row) {
  return {
    async query(sql, values) {
      assert.match(sql, /order by revision\.revision_number desc,revision\.id desc limit 1/);
      assert.match(sql, /event_type in \('declined','changes_requested','voided','superseded'\)/);
      assert.match(sql, /workorder_authorization_events event/);
      assert.match(sql, /\) auth_event/);
      assert.doesNotMatch(sql, /\bauthorization\./);
      assert.deepEqual(values, ["company-1", "workorder-1"]);
      return { rows: row ? [row] : [] };
    },
  };
}

test("external customer repair progress requires acceptance of the exact latest Estimate revision", async () => {
  for (const row of [
    { classification: "required_external_customer", latest_revision_id: null, latest_accepted: false, latest_terminal: false },
    { classification: "required_external_customer", latest_revision_id: "revision-2", latest_accepted: false, latest_terminal: false },
    { classification: "required_external_customer", latest_revision_id: "revision-2", latest_accepted: true, latest_terminal: true },
  ]) {
    await assert.rejects(
      assertCurrentExternalEstimateAccepted(clientWith(row), {
        companyId: "company-1",
        workorderId: "workorder-1",
      }),
      (error) => error.statusCode === 409
        && error.code === CUSTOMER_REVISED_ESTIMATE_ACCEPTANCE_REQUIRED,
    );
  }
});

test("accepted latest Estimate and non-customer classifications remain mutable", async () => {
  for (const row of [
    { classification: "required_external_customer", latest_revision_id: "revision-2", latest_accepted: true, latest_terminal: false },
    { classification: "internal_fleet", latest_revision_id: null, latest_accepted: false, latest_terminal: false },
    { classification: "exempt", latest_revision_id: null, latest_accepted: false, latest_terminal: false },
    null,
  ]) {
    await assert.doesNotReject(assertCurrentExternalEstimateAccepted(clientWith(row), {
      companyId: "company-1",
      workorderId: "workorder-1",
    }));
  }
});

test("repair progress detection covers top-level and nested labor-hour patches", () => {
  const before = {
    diagnosis: "Inspect",
    work_performed: "",
    form_data: { laborHours: "2" },
  };
  assert.equal(isRepairProgressMutation(before, { formData: { laborHours: "3" } }), true);
  assert.equal(isRepairProgressMutation(before, { laborHours: "3" }), true);
  assert.equal(isRepairProgressMutation(before, { formData: { laborHours: "2" } }), false);
  assert.equal(isRepairProgressMutation(before, { formData: { customerCompanyName: "Acme" } }), false);
});
