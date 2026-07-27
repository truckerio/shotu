import assert from "node:assert/strict";
import test from "node:test";
import {
  acceptInvitationSchema,
  createInvitationSchema,
  createLocationSchema,
  resetManagedUserPasswordSchema,
  updateManagedUserStatusSchema,
  updateLocationTemplateSchema,
  updateLocationWorkorderPolicySchema,
} from "./admin.schemas.js";

test("location input keeps the admin model compact", () => {
  assert.deepEqual(createLocationSchema.parse({ name: "Texas Yard" }), {
    name: "Texas Yard",
    type: "yard",
    address: "",
  });
});

test("location invites allow operating roles but never admin", () => {
  assert.equal(createInvitationSchema.parse({ name: "Sam Tech", email: "sam@example.com", role: "mechanic" }).role, "mechanic");
  assert.throws(() => createInvitationSchema.parse({ name: "Admin", email: "admin2@example.com", role: "admin" }));
});

test("invite acceptance requires a strong password and normalized username shape", () => {
  assert.equal(acceptInvitationSchema.parse({ username: "sam.tech", password: "LongPassword1!" }).username, "sam.tech");
  assert.throws(() => acceptInvitationSchema.parse({ username: "bad user", password: "short" }));
});

test("template requires the full location-owned header and footer contract", () => {
  const value = updateLocationTemplateSchema.parse({
    headerTitle: "TEXAS YARD WORKORDER",
    brandTop: "PRO TEC",
    brandBottom: "REPAIR",
    warrantyText: "Warranty",
    responsibilityText: "Responsibility",
    authorizationText: "Authorization",
  });
  assert.equal(value.headerTitle, "TEXAS YARD WORKORDER");
});

test("admin user management validates account status and strong replacement passwords", () => {
  assert.deepEqual(updateManagedUserStatusSchema.parse({ active: false }), { active: false });
  assert.equal(
    resetManagedUserPasswordSchema.parse({ password: "LongPassword1!" }).password,
    "LongPassword1!",
  );
  assert.throws(() => updateManagedUserStatusSchema.parse({ active: "false" }));
  assert.throws(() => resetManagedUserPasswordSchema.parse({ password: "short" }));
});

test("location workorder policy accepts only an explicit mechanic parts decision", () => {
  assert.deepEqual(
    updateLocationWorkorderPolicySchema.parse({ mechanicCanRecordParts: true }),
    { mechanicCanRecordParts: true },
  );
  assert.throws(() => updateLocationWorkorderPolicySchema.parse({}));
  assert.throws(() => updateLocationWorkorderPolicySchema.parse({ mechanicCanRecordParts: "true" }));
});
