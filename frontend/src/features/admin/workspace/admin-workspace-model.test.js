import assert from "node:assert/strict";
import test from "node:test";
import {
  BLANK_KIOSK_PIN,
  DEFAULT_TEMPORARY_KIOSK_PIN,
  locationUserGroups,
  templateForm,
  userLocationIds,
} from "./admin-workspace-model.js";

test("template defaults remain location-specific", () => {
  assert.deepEqual(templateForm(null, { name: "Chino Yard" }), {
    headerTitle: "CHINO YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER",
    responsibilityText: "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.",
    authorizationText: "I authorize the above repair to be completed along with necessary material(s).",
  });
});

test("location access and kiosk defaults preserve existing behavior", () => {
  assert.deepEqual(userLocationIds({ locationIds: ["a", "b"] }, "current"), ["a", "b"]);
  assert.deepEqual(userLocationIds({}, "current"), ["current"]);
  assert.equal(DEFAULT_TEMPORARY_KIOSK_PIN, "0000");
  assert.deepEqual(BLANK_KIOSK_PIN, { pin: "0000", confirmation: "0000" });
});

test("user groups explain company admins, assigned active users, and inactive users", () => {
  const users = [
    { id: "admin", role: "admin", active: true, membership_active: true },
    { id: "mechanic", role: "mechanic", active: true, membership_active: true },
    { id: "inactive", role: "office", active: false, membership_active: true },
  ];
  const groups = locationUserGroups(users);
  assert.deepEqual(groups.companyAdmins.map(({ id }) => id), ["admin"]);
  assert.deepEqual(groups.assignedActive.map(({ id }) => id), ["mechanic"]);
  assert.deepEqual(groups.inactive.map(({ id }) => id), ["inactive"]);
});
