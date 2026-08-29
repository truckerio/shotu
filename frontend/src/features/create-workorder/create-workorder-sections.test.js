import assert from "node:assert/strict";
import test from "node:test";
import {
  buildCreateWorkorderSections,
  createSectionForErrors,
  defaultCreateWorkorderSection,
  isCreateErrorSectionReady,
} from "./create-workorder-sections.js";

test("create workorder phone sections follow the shared detail navigation shape", () => {
  assert.deepEqual(
    buildCreateWorkorderSections().map(({ id }) => id),
    ["unit", "concern", "schedule", "parts", "location", "assignment", "preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ canAssign: false }).map(({ id }) => id),
    ["unit", "concern", "schedule", "parts", "location", "preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ canAssign: false }).map(({ label }) => label),
    ["Unit", "Concern", "Schedule", "Parts", "Location", "Preview"],
  );
  assert.deepEqual(
    buildCreateWorkorderSections({ includePreview: false }).map(({ id }) => id),
    ["unit", "concern", "schedule", "parts", "location", "assignment"],
  );
});

test("every Create role keeps four task steps primary and defers supporting destinations", () => {
  const sections = buildCreateWorkorderSections({ canAssign: false, role: "mechanic" });

  assert.deepEqual(
    sections.map(({ id, alwaysPrimary, overflow }) => [id, alwaysPrimary, Boolean(overflow)]),
    [
      ["unit", true, false],
      ["concern", true, false],
      ["schedule", true, false],
      ["parts", true, false],
      ["location", false, true],
      ["preview", false, true],
    ],
  );
  assert.equal(defaultCreateWorkorderSection("mechanic"), "unit");
  assert.equal(defaultCreateWorkorderSection("office"), "unit");
});

test("create workorder navigation uses the same core and optional placement for office", () => {
  const sections = buildCreateWorkorderSections({ includePreview: false });

  assert.deepEqual(
    sections.map(({ id, alwaysPrimary }) => [id, alwaysPrimary]),
    [
      ["unit", true],
      ["concern", true],
      ["schedule", true],
      ["parts", true],
      ["location", false],
      ["assignment", false],
    ],
  );
  assert.deepEqual(
    [...sections].sort((left, right) => right.priority - left.priority).map(({ id }) => id),
    ["unit", "concern", "schedule", "parts", "location", "assignment"],
  );
  assert.deepEqual(sections.filter(({ overflow }) => overflow).map(({ id }) => id), ["location", "assignment"]);
});

test("compact Preview remains a supporting create destination", () => {
  const sections = buildCreateWorkorderSections({ includePreview: true });
  const preview = sections.find(({ id }) => id === "preview");

  assert.deepEqual(
    { alwaysPrimary: preview.alwaysPrimary, overflow: preview.overflow, priority: preview.priority },
    { alwaysPrimary: false, overflow: true, priority: 1 },
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

  assert.deepEqual(sections.map(({ id }) => id), ["unit", "concern", "schedule", "location"]);
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
    ["unit", "concern"],
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
