import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateWorkorderSections,
  createSectionForErrors,
  isCreateErrorSectionReady,
} from "./create-workorder-sections.js";

test("create workorder phone sections follow the shared detail navigation shape", () => {
  assert.deepEqual(
    buildCreateWorkorderSections().map(({ id }) => id),
    ["location", "schedule", "concern", "unit", "assignment", "parts", "preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ canAssign: false }).map(({ id }) => id),
    ["location", "schedule", "concern", "unit", "parts", "preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ canAssign: false }).map(({ label }) => label),
    ["Location", "Schedule", "Concern", "Unit", "Parts", "Preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ includePreview: false }).map(({ id }) => id),
    ["location", "schedule", "concern", "unit", "assignment", "parts"],
  );
});

test("create workorder navigation promotes every editable workflow section when width allows", () => {
  const sections = buildCreateWorkorderSections({ includePreview: false });

  assert.deepEqual(
    sections.map(({ id, alwaysPrimary }) => [id, alwaysPrimary]),
    [
      ["location", true],
      ["schedule", true],
      ["concern", true],
      ["unit", true],
      ["assignment", true],
      ["parts", true],
    ],
  );
  assert.deepEqual(
    [...sections].sort((left, right) => right.priority - left.priority).map(({ id }) => id),
    ["location", "schedule", "concern", "unit", "assignment", "parts"],
  );
  assert.equal(sections.some(({ overflow }) => overflow), false);
});

test("compact Preview remains a supporting create destination", () => {
  const sections = buildCreateWorkorderSections({ includePreview: true });
  const preview = sections.find(({ id }) => id === "preview");

  assert.deepEqual(
    { alwaysPrimary: preview.alwaysPrimary, overflow: preview.overflow, priority: preview.priority },
    { alwaysPrimary: false, overflow: true, priority: 0 },
  );
});

test("create workorder sections respect location module policy", () => {
  const sections = buildCreateWorkorderSections({
    canAssign: true,
    includePreview: true,
    policyOverrides: {
      moduleAccess: {
        office: {
          create: {
            assignment: "hidden",
            concern: "required",
            parts: "hidden",
            preview: "hidden",
            unit: "write",
          },
        },
      },
    },
    role: "office",
  });

  assert.deepEqual(sections.map(({ id }) => id), ["location", "schedule", "concern", "unit"]);
});

test("create validation waits until the invalid phone section is active", () => {
  const errors = { unitNo: "Required" };
  assert.equal(isCreateErrorSectionReady({ activeSection: "work", errors }), false);
  assert.equal(isCreateErrorSectionReady({ activeSection: "unit", errors }), true);
  assert.equal(isCreateErrorSectionReady({ activeSection: "work", errors: {} }), true);
});

test("create validation selects the page containing the first relevant error group", () => {
  assert.equal(createSectionForErrors({ mechanicConcern: "Required", unitNo: "Required" }), "concern");
  assert.equal(createSectionForErrors({ locationId: "Required" }), "location");
  assert.equal(createSectionForErrors({ workStartDate: "Required" }), "schedule");
  assert.equal(createSectionForErrors({ unitNo: "Required" }), "unit");
  assert.equal(createSectionForErrors({ parts: "Invalid quantity" }), "parts");
  assert.equal(createSectionForErrors({ mechanicUserIds: "Invalid mechanic" }), "assignment");
  assert.equal(createSectionForErrors({}), "");
});

test("create navigation filters modules by per-user location policy", () => {
  const policy = {
    userModuleAccess: {
      "surv-1": {
        create: {
          unit: "write",
          concern: "required",
        },
      },
    },
  };

  assert.deepEqual(
    buildCreateWorkorderSections({
      canAssign: false,
      policyOverrides: policy,
      role: "surveillance",
      userId: "surv-1",
    }).map(({ id }) => id),
    ["concern", "unit"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({
      canAssign: false,
      policyOverrides: policy,
      role: "surveillance",
      userId: "surv-2",
    }).map(({ id }) => id),
    [],
  );
});

test("read-only create modules never become editable form sections", () => {
  const sections = buildCreateWorkorderSections({
    policyOverrides: {
      moduleAccess: {
        office: {
          create: {
            assignment: "read",
            concern: "read",
            location: "read",
            parts: "read",
            schedule: "read",
            unit: "read",
          },
        },
      },
    },
    role: "office",
  });

  assert.deepEqual(sections.map(({ id }) => id), ["preview"]);
  assert.equal(sections[0].modulePolicy.canWrite, false);
});
