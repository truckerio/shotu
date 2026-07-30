import test from "node:test";
import assert from "node:assert/strict";
import {
  SURVEILLANCE_PHONE_PRIMARY_TABS,
  SURVEILLANCE_PHONE_SECONDARY_TABS,
  isSurveillancePhonePrimaryTab,
  surveillanceMissingInfoHandoff,
} from "./surveillanceQueue.js";

test("phone surveillance prioritizes Odoo entry and missing-information queues", () => {
  assert.deepEqual(SURVEILLANCE_PHONE_PRIMARY_TABS.map(({ key, label }) => ({ key, label })), [
    { key: "pendingOdoo", label: "Needs Odoo" },
    { key: "entered", label: "Entered" },
    { key: "missingInfo", label: "Missing info" },
  ]);
});

test("operational queues remain available as secondary views", () => {
  assert.deepEqual(SURVEILLANCE_PHONE_SECONDARY_TABS.map(({ key }) => key), [
    "active",
    "awaitingOffice",
  ]);
  assert.equal(isSurveillancePhonePrimaryTab("pendingOdoo"), true);
  assert.equal(isSurveillancePhonePrimaryTab("active"), false);
});

test("missing-information handoff exposes the request and later Manager update", () => {
  const handoff = surveillanceMissingInfoHandoff(
    { odooStatus: "missing_info", attentionReasons: ["missing_info"] },
    [
      { type: "attention", field_key: "missing_info", action: "opened", note: "Add authorization.", changed_by_name: "Sam", actor_role: "surveillance", created_at: "2026-07-29T10:00:00Z" },
      { type: "access", actor_role: "office", created_at: "2026-07-29T10:05:00Z" },
      { type: "field", field_key: "office_addendum", field_label: "Office addendum", note: "Authorization added.", changed_by_name: "Mina", actor_role: "office", created_at: "2026-07-29T10:10:00Z" },
    ],
  );

  assert.equal(handoff.note, "Add authorization.");
  assert.deepEqual(handoff.managerUpdate, {
    by: "Mina",
    at: "2026-07-29T10:10:00Z",
    note: "Authorization added.",
  });
});

test("inactive missing-information requests do not create a handoff banner", () => {
  assert.equal(surveillanceMissingInfoHandoff({ odooStatus: "not_entered" }, []), null);
});
