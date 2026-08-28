import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkorderDetailSections,
  buildCompactPhoneDetailSections,
  buildSurveillanceWorkorderDetailSections,
  allowedDetailSection,
  defaultDetailSection,
  defaultSupportingView,
  workorderDetailSectionMode,
  workorderNeedsChatAttention,
  workorderPreviewState,
} from "./workorder-detail-sections.js";

test("workorder detail sections keep shared tab contract across roles", () => {
  const base = {
    activeWorkorder: { workorder: { id: "wo-1" } },
    assignedMechanicCount: 2,
    conversationCount: 4,
    detailStatus: "accepted",
    filledPartCount: 1,
    isCompact: false,
    pendingPartCount: 0,
    timelineCount: 6,
    unitType: "Truck",
  };

  assert.deepEqual(
    buildWorkorderDetailSections({ ...base, isMechanicDetail: true, isOfficeDetail: false }).map((section) => section.id),
    ["concern", "diagnosisRepair", "chat", "parts", "photos", "unit", "location", "assignment", "schedule", "activity", "preview", "completion"],
  );
  const mechanic = buildWorkorderDetailSections({ ...base, isMechanicDetail: true, isOfficeDetail: false });
  assert.equal(mechanic.find(({ id }) => id === "chat").label, "Help");
  assert.equal(mechanic.find(({ id }) => id === "completion").alwaysPrimary, true);
  assert.deepEqual(mechanic.filter(({ overflow }) => overflow).map(({ id }) => id), []);
  assert.deepEqual(
    buildWorkorderDetailSections({ ...base, isMechanicDetail: false, isOfficeDetail: true }).map((section) => section.id),
    ["concern", "diagnosisRepair", "chat", "parts", "photos", "unit", "location", "assignment", "schedule", "activity", "preview", "completion"],
  );
});

test("mechanic detail navigation localizes every static section label", () => {
  const sections = buildWorkorderDetailSections({
    activeWorkorder: { workorder: { id: "wo-es" } },
    detailStatus: "closed",
    isMechanicDetail: true,
    isOfficeDetail: false,
    locale: "es",
    role: "mechanic",
    unitType: "Truck",
  });
  const labels = Object.fromEntries(sections.map(({ id, label }) => [id, label]));
  assert.deepEqual({
    concern: labels.concern,
    photos: labels.photos,
    location: labels.location,
    assignment: labels.assignment,
    schedule: labels.schedule,
    preview: labels.preview,
    completion: labels.completion,
    unit: labels.unit,
  }, {
    concern: "Problema",
    photos: "Fotos",
    location: "Ubicación",
    assignment: "Asignación",
    schedule: "Horario",
    preview: "Vista previa",
    completion: "Finalización",
    unit: "Camión",
  });
});

test("eligible Admin detail exposes Odoo in manifest order with resolved write access", () => {
  const sections = buildWorkorderDetailSections({
    activeWorkorder: { workorder: { id: "wo-odoo", status: "closed" } },
    assignedMechanicCount: 1,
    detailStatus: "closed",
    isMechanicDetail: false,
    isOfficeDetail: true,
    role: "admin",
  });

  assert.deepEqual(
    sections.map(({ id }) => id),
    ["concern", "diagnosisRepair", "chat", "parts", "photos", "unit", "location", "assignment", "schedule", "activity", "preview", "completion", "odoo"],
  );
  assert.equal(sections.find(({ id }) => id === "odoo")?.access, "write");
});

test("Odoo read access remains visible while a named-user hidden override removes it", () => {
  const base = {
    activeWorkorder: { workorder: { id: "wo-odoo", status: "closed" } },
    detailStatus: "closed",
    isMechanicDetail: false,
    isOfficeDetail: true,
    role: "admin",
  };
  const readSections = buildWorkorderDetailSections({
    ...base,
    policyOverrides: {
      moduleAccess: { admin: { detail: { odoo: "read" } } },
    },
  });
  assert.equal(readSections.find(({ id }) => id === "odoo")?.access, "read");

  const hiddenSections = buildWorkorderDetailSections({
    ...base,
    policyOverrides: {
      userModuleAccess: {
        "admin-1": { detail: { odoo: "hidden" } },
      },
    },
    userId: "admin-1",
  });
  assert.equal(hiddenSections.some(({ id }) => id === "odoo"), false);
  assert.equal(allowedDetailSection({ requestedSection: "odoo", sections: hiddenSections }), "concern");
});

test("Admin keeps Odoo visible before lifecycle eligibility while role defaults can hide it", () => {
  const base = {
    activeWorkorder: { workorder: { id: "wo-1" } },
    detailStatus: "in_progress",
  };
  const adminSections = buildWorkorderDetailSections({
    ...base,
    isMechanicDetail: false,
    isOfficeDetail: true,
    role: "admin",
  });
  assert.equal(adminSections.some(({ id }) => id === "odoo"), true);
  assert.equal(adminSections.find(({ id }) => id === "odoo")?.access, "write");

  for (const role of ["office", "mechanic"]) {
    assert.equal(buildWorkorderDetailSections({
      ...base,
      activeWorkorder: { workorder: { id: "wo-2", status: "closed" } },
      detailStatus: "closed",
      isMechanicDetail: role === "mechanic",
      isOfficeDetail: role === "office",
      role,
    }).some(({ id }) => id === "odoo"), false, role);
  }
});

test("compact attention status starts on chat and opens chat dock", () => {
  assert.equal(defaultDetailSection("mechanic", "parts_requested", true), "chat");
  assert.equal(defaultSupportingView("office", "waiting_office"), "chat");
  assert.equal(workorderNeedsChatAttention("waiting_office"), true);
  assert.equal(workorderNeedsChatAttention("accepted"), false);
});

test("workorder detail tabs render as page panels", () => {
  assert.equal(workorderDetailSectionMode(), "panel");
});

test("compact phone detail keeps role actions visible and moves supporting sections into More", () => {
  const sections = [
    { id: "concern", label: "Concern" },
    { id: "diagnosisRepair", label: "Diagnosis and repair" },
    { id: "chat", label: "Help" },
    { id: "parts", label: "Parts" },
    { id: "unit", label: "Truck" },
    { id: "assignment", label: "Assignment" },
    { id: "location", label: "Location" },
    { id: "schedule", label: "Schedule" },
    { id: "photos", label: "Photos" },
    { id: "completion", label: "Completion" },
    { id: "activity", label: "Activity" },
  ];

  const office = buildCompactPhoneDetailSections(sections, "office");
  assert.deepEqual(office.map(({ id }) => id), ["concern", "diagnosisRepair", "chat", "parts", "assignment", "preview", "completion", "photos", "unit", "location", "schedule", "activity"]);
  assert.deepEqual(office.filter(({ overflow }) => overflow).map(({ id }) => id), ["photos", "unit", "location", "schedule", "activity"]);

  const mechanic = buildCompactPhoneDetailSections(sections, "mechanic");
  assert.deepEqual(mechanic.map(({ id }) => id), ["concern", "diagnosisRepair", "chat", "parts", "assignment", "preview", "completion", "photos", "unit", "location", "schedule", "activity"]);
  assert.deepEqual(mechanic.filter(({ overflow }) => overflow).map(({ id }) => id), ["photos", "unit", "location", "schedule", "activity"]);

  const surveillance = buildCompactPhoneDetailSections(sections, "surveillance");
  assert.deepEqual(surveillance.map(({ id }) => id), ["concern", "diagnosisRepair", "chat", "parts", "activity", "preview", "completion", "photos", "unit", "location", "assignment", "schedule"]);
  assert.equal(surveillance[0].label, "Concern");
  assert.deepEqual(surveillance.filter(({ overflow }) => overflow).map(({ id }) => id), ["photos", "unit", "location", "assignment", "schedule"]);
});

test("compact detail keeps an eligible Odoo action in manifest order", () => {
  const compact = buildCompactPhoneDetailSections([
    { id: "concern", label: "Concern" },
    { id: "odoo", label: "Odoo", access: "write" },
    { id: "parts", label: "Parts" },
    { id: "unit", label: "Truck" },
    { id: "assignment", label: "Assignment" },
    { id: "activity", label: "Activity" },
  ], "admin");

  assert.equal(compact.findIndex(({ id }) => id === "odoo"), 4);
  assert.equal(compact.find(({ id }) => id === "odoo").access, "write");
});

test("phone preview is present whenever workorder form data exists", () => {
  assert.deepEqual(
    workorderPreviewState({ workorder: { id: "wo-1" } }, { parts: [{ partNo: "LF3972" }] }),
    { status: "ready", message: "" },
  );
  assert.equal(workorderPreviewState(null, null).status, "loading");
});

test("compact Preview honors the active workorder policy instead of role defaults", () => {
  const compact = buildCompactPhoneDetailSections([
    { id: "concern", label: "Concern" },
    { id: "parts", label: "Parts" },
  ], "mechanic", {
    policyOverrides: {
      moduleAccess: { mechanic: { detail: { preview: "hidden" } } },
    },
  });

  assert.equal(compact.some(({ id }) => id === "preview"), false);
});

test("surveillance detail uses the same canonical registry modules", () => {
  const sections = buildSurveillanceWorkorderDetailSections({
    activityCount: 3,
    canProcessOdoo: true,
    missingCount: 1,
    unitType: "Trailer",
    usedPartCount: 2,
  });

  assert.deepEqual(sections.map(({ id }) => id), ["concern", "diagnosisRepair", "chat", "parts", "photos", "unit", "location", "assignment", "schedule", "activity", "preview", "completion", "odoo"]);
  assert.equal(sections.find(({ id }) => id === "odoo").access, "write");
  assert.equal(sections.find(({ id }) => id === "odoo").label, "Odoo");
  assert.equal(sections.find(({ id }) => id === "odoo").attention, true);
});

test("detail navigation falls back to the first allowed module when requested section is hidden", () => {
  const sections = buildWorkorderDetailSections({
    activeWorkorder: { workorder: { id: "wo-1" } },
    detailStatus: "open",
    isMechanicDetail: false,
    isOfficeDetail: true,
    policyOverrides: {
      moduleAccess: {
        office: {
          detail: {
            concern: "hidden",
            parts: "write",
          },
        },
      },
    },
    role: "office",
  });

  assert.equal(sections.some(({ id }) => id === "concern"), false);
  assert.equal(allowedDetailSection({ requestedSection: "concern", sections }), "diagnosisRepair");
});
