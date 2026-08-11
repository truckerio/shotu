import assert from "node:assert/strict";
import test from "node:test";
import {
  CalendarDate,
  Camera01,
  CheckCircle,
  ClipboardCheck,
  Database01,
  MarkerPin01,
} from "@untitledui/icons";

import {
  defaultWorkorderModuleAccess,
  filterWorkorderModulesForPolicy,
  orderWorkorderModules,
  resolveWorkorderModulePolicy,
  WORKORDER_MODULE_ACCESS,
  WORKORDER_MODULE_IDS,
  WORKORDER_MODULE_ALIASES,
  WORKORDER_MODULE_REGISTRY,
  WORKORDER_SURFACES,
  workorderModuleDescriptor,
  workorderModuleLabel,
  workorderModuleRouteIds,
} from "./workorder-module-registry.js";
import { WORKORDER_MODULES as SHARED_MODULES } from "../../../../shared/workorder-modules.js";

test("workorder module defaults preserve current role surfaces", () => {
  assert.equal(
    defaultWorkorderModuleAccess({
      moduleId: WORKORDER_MODULE_IDS.ASSIGNMENT,
      role: "mechanic",
      surface: WORKORDER_SURFACES.CREATE,
    }),
    WORKORDER_MODULE_ACCESS.HIDDEN,
  );
  assert.equal(
    defaultWorkorderModuleAccess({
      moduleId: WORKORDER_MODULE_IDS.ASSIGNMENT,
      role: "office",
      surface: WORKORDER_SURFACES.CREATE,
    }),
    WORKORDER_MODULE_ACCESS.WRITE,
  );
  assert.equal(
    defaultWorkorderModuleAccess({
      moduleId: WORKORDER_MODULE_IDS.ODOO,
      role: "surveillance",
      surface: WORKORDER_SURFACES.DETAIL,
    }),
    WORKORDER_MODULE_ACCESS.WRITE,
  );
});

test("Odoo detail defaults are writable only for Admin and Surveillance", () => {
  const expectedByRole = {
    admin: WORKORDER_MODULE_ACCESS.WRITE,
    surveillance: WORKORDER_MODULE_ACCESS.WRITE,
    office: WORKORDER_MODULE_ACCESS.HIDDEN,
    mechanic: WORKORDER_MODULE_ACCESS.HIDDEN,
  };

  for (const [role, expected] of Object.entries(expectedByRole)) {
    assert.equal(
      defaultWorkorderModuleAccess({
        moduleId: WORKORDER_MODULE_IDS.ODOO,
        role,
        surface: WORKORDER_SURFACES.DETAIL,
      }),
      expected,
      role,
    );
  }
});

test("Admin diagnosis and repair defaults resolve to write access", () => {
  const policy = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR,
    role: "admin",
    surface: WORKORDER_SURFACES.DETAIL,
  });

  assert.equal(policy.access, WORKORDER_MODULE_ACCESS.WRITE);
  assert.equal(policy.canRead, true);
  assert.equal(policy.canWrite, true);
  assert.equal(policy.readOnly, false);
});

test("Office diagnosis and repair defaults resolve to write access", () => {
  const policy = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR,
    role: "office",
    surface: WORKORDER_SURFACES.DETAIL,
  });

  assert.equal(policy.access, WORKORDER_MODULE_ACCESS.WRITE);
  assert.equal(policy.canWrite, true);
});

test("Odoo policy exposes read and write modes while user overrides win", () => {
  const readPolicy = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.ODOO,
    role: "office",
    surface: WORKORDER_SURFACES.DETAIL,
    overrides: {
      moduleAccess: {
        office: { detail: { odoo: WORKORDER_MODULE_ACCESS.READ } },
      },
    },
  });
  assert.equal(readPolicy.visible, true);
  assert.equal(readPolicy.access, WORKORDER_MODULE_ACCESS.READ);

  const hiddenForUser = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.ODOO,
    role: "admin",
    surface: WORKORDER_SURFACES.DETAIL,
    userId: "admin-1",
    overrides: {
      userModuleAccess: {
        "admin-1": { detail: { odoo: WORKORDER_MODULE_ACCESS.HIDDEN } },
      },
    },
  });
  assert.equal(hiddenForUser.visible, false);
  assert.equal(hiddenForUser.access, WORKORDER_MODULE_ACCESS.HIDDEN);
});

test("policy overrides can enable create modules for a single user", () => {
  const policy = resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.WORK,
    role: "surveillance",
    surface: WORKORDER_SURFACES.CREATE,
    userId: "user-1",
    overrides: [
      {
        access: WORKORDER_MODULE_ACCESS.WRITE,
        moduleId: WORKORDER_MODULE_IDS.WORK,
        surface: WORKORDER_SURFACES.CREATE,
        userId: "user-1",
      },
    ],
  });

  assert.equal(policy.visible, true);
  assert.equal(policy.access, WORKORDER_MODULE_ACCESS.WRITE);
});

test("nested admin moduleAccess policy shape drives frontend filtering", () => {
  const modules = [
    { id: WORKORDER_MODULE_IDS.WORK, label: "Work" },
    { id: WORKORDER_MODULE_IDS.PREVIEW, label: "Preview" },
  ];
  const filtered = filterWorkorderModulesForPolicy(modules, {
    role: "surveillance",
    surface: WORKORDER_SURFACES.CREATE,
    overrides: {
      moduleAccess: {
        surveillance: {
          create: {
            concern: WORKORDER_MODULE_ACCESS.REQUIRED,
          },
        },
      },
    },
  });

  assert.deepEqual(filtered.map(({ id }) => id), [WORKORDER_MODULE_IDS.WORK]);
});

test("nested userModuleAccess policy wins before role defaults", () => {
  assert.equal(resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.WORK,
    role: "surveillance",
    surface: WORKORDER_SURFACES.CREATE,
    userId: "surv-1",
    overrides: {
      userModuleAccess: {
        "surv-1": {
          create: {
            concern: WORKORDER_MODULE_ACCESS.REQUIRED,
          },
        },
      },
    },
  }).visible, true);
});

test("nested admin moduleAccess aliases assignment and diagnosis blocks", () => {
  assert.equal(resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.TEAM,
    role: "office",
    surface: WORKORDER_SURFACES.DETAIL,
    overrides: {
      moduleAccess: {
        office: {
          detail: {
            assignment: WORKORDER_MODULE_ACCESS.HIDDEN,
          },
        },
      },
    },
  }).visible, false);

  assert.equal(resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.DIAGNOSIS,
    role: "mechanic",
    surface: WORKORDER_SURFACES.DETAIL,
    overrides: {
      mechanic: {
        detail: {
          diagnosisRepair: WORKORDER_MODULE_ACCESS.READ,
        },
      },
    },
  }).access, WORKORDER_MODULE_ACCESS.READ);
});

test("policy filtering keeps module ids and hides disabled blocks", () => {
  const modules = [
    { id: WORKORDER_MODULE_IDS.WORK, label: "Work" },
    { id: WORKORDER_MODULE_IDS.PARTS, label: "Parts" },
  ];
  const filtered = filterWorkorderModulesForPolicy(modules, {
    role: "office",
    surface: WORKORDER_SURFACES.DETAIL,
    overrides: [
      {
        access: WORKORDER_MODULE_ACCESS.HIDDEN,
        moduleId: WORKORDER_MODULE_IDS.PARTS,
        role: "office",
        surface: WORKORDER_SURFACES.DETAIL,
      },
    ],
  });

  assert.deepEqual(filtered.map(({ id }) => id), [WORKORDER_MODULE_IDS.WORK]);
});

test("registry labels are stable for shared navigation", () => {
  assert.equal(workorderModuleLabel(WORKORDER_MODULE_IDS.PREVIEW), "Preview");
  assert.equal(workorderModuleLabel("unknown", "Fallback"), "Fallback");
});

test("every canonical shared module has an explicit frontend owner", () => {
  for (const module of SHARED_MODULES) {
    const descriptor = WORKORDER_MODULE_REGISTRY[module.key];
    assert.ok(descriptor, module.key);
    assert.match(descriptor.owner, /^workorder-modules\//, module.key);
    assert.equal(descriptor.policyKey, module.key, module.key);
  }
  assert.equal(WORKORDER_MODULE_ALIASES.work, "concern");
  assert.equal(WORKORDER_MODULE_ALIASES.team, "assignment");
  assert.equal(WORKORDER_MODULE_ALIASES.diagnosis, "diagnosisRepair");
  assert.equal(WORKORDER_MODULE_REGISTRY.work, undefined);
  assert.equal(WORKORDER_MODULE_REGISTRY.team, undefined);
  assert.equal(WORKORDER_MODULE_REGISTRY.diagnosis, undefined);
});

test("module manifests own distinct semantic navigation icons", () => {
  assert.equal(workorderModuleDescriptor("completion").icon, CheckCircle);
  assert.equal(workorderModuleDescriptor("photos").icon, Camera01);
  assert.equal(workorderModuleDescriptor("schedule").icon, CalendarDate);
  assert.equal(workorderModuleDescriptor("diagnosisRepair").icon, ClipboardCheck);
  assert.equal(workorderModuleDescriptor("location").icon, MarkerPin01);
  assert.equal(workorderModuleDescriptor("odoo").icon, Database01);

  const canonicalIcons = Object.values(WORKORDER_MODULE_REGISTRY)
    .filter(({ id, policyKey }) => id === policyKey)
    .map(({ icon }) => icon);
  assert.equal(canonicalIcons.every(Boolean), true);
  assert.equal(new Set(canonicalIcons).size, canonicalIcons.length);
});

test("legacy aliases resolve the icon owned by their canonical manifest", () => {
  assert.equal(workorderModuleDescriptor("work").icon, workorderModuleDescriptor("concern").icon);
  assert.equal(workorderModuleDescriptor("team").icon, workorderModuleDescriptor("assignment").icon);
  assert.equal(workorderModuleDescriptor("diagnosis").icon, workorderModuleDescriptor("diagnosisRepair").icon);
});

test("detail routes and compact placement come from module manifests", () => {
  assert.deepEqual(workorderModuleRouteIds(WORKORDER_SURFACES.DETAIL), [
    "concern",
    "diagnosisRepair",
    "chat",
    "parts",
    "photos",
    "unit",
    "location",
    "assignment",
    "schedule",
    "activity",
    "preview",
    "completion",
    "odoo",
  ]);

  const ordered = orderWorkorderModules([
    { id: "activity" },
    { id: "unit" },
    { id: "parts" },
    { id: "concern" },
    { id: "preview" },
  ], { compact: true, role: "mechanic", surface: WORKORDER_SURFACES.DETAIL });
  assert.deepEqual(ordered.map(({ id }) => id), ["concern", "parts", "preview", "unit", "activity"]);
  assert.deepEqual(ordered.filter(({ overflow }) => overflow).map(({ id }) => id), ["unit", "activity"]);
});

test("assignment stays in the main detail navigation for operational roles", () => {
  for (const role of ["admin", "mechanic", "office"]) {
    const [assignment] = orderWorkorderModules(
      [{ id: "assignment" }],
      { compact: true, role, surface: WORKORDER_SURFACES.DETAIL },
    );
    assert.equal(assignment.overflow, undefined, role);
  }

  const [surveillanceAssignment] = orderWorkorderModules(
    [{ id: "assignment" }],
    { compact: true, role: "surveillance", surface: WORKORDER_SURFACES.DETAIL },
  );
  assert.equal(surveillanceAssignment.overflow, true);
});

test("resolved policies expose stable read and write metadata", () => {
  const readPolicy = resolveWorkorderModulePolicy({
    moduleId: "unit",
    role: "mechanic",
    surface: WORKORDER_SURFACES.DETAIL,
  });
  assert.equal(readPolicy.access, "read");
  assert.equal(readPolicy.canRead, true);
  assert.equal(readPolicy.canWrite, false);
  assert.equal(readPolicy.readOnly, true);

  const writePolicy = resolveWorkorderModulePolicy({
    moduleId: "parts",
    role: "mechanic",
    surface: WORKORDER_SURFACES.DETAIL,
  });
  assert.equal(writePolicy.canRead, true);
  assert.equal(writePolicy.canWrite, true);
  assert.equal(writePolicy.readOnly, false);
});
