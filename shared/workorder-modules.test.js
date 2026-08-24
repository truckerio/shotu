import assert from "node:assert/strict";
import test from "node:test";

import {
  canCreateWorkorderForRole,
  canWriteWorkorderModule,
  getWorkorderModule,
  normalizeModuleAccessOverrides,
  normalizeModuleAccessMap,
  normalizeUserModuleAccessMap,
  resolveEffectiveWorkorderModuleAccess,
  resolveWorkorderModuleAccess,
  WORKORDER_ACCESS_MODES,
} from "./workorder-modules.js";

test("every registered module has one stable owner and explicit capabilities", () => {
  const odoo = getWorkorderModule("odoo");

  assert.equal(odoo.owner, "integrations.odoo");
  assert.deepEqual(odoo.capabilities, ["read", "write"]);
  assert.deepEqual(odoo.actions, ["prepare", "mapPart", "createDraft", "markMissingInfo"]);
  assert.equal(getWorkorderModule("unknown"), null);
});

test("sparse role overrides retain inheritance instead of expanding defaults", () => {
  assert.deepEqual(normalizeModuleAccessOverrides({
    office: {
      detail: {
        odoo: "read",
        parts: "inherit",
        unknown: "write",
      },
    },
  }), {
    office: { detail: { odoo: "read" } },
  });
});

test("effective access resolves user then location then company then safe default", () => {
  const base = {
    role: "office",
    surface: "detail",
    moduleKey: "odoo",
    userId: "11111111-1111-4111-8111-111111111111",
    companyPolicy: { moduleAccess: { office: { detail: { odoo: "read" } } } },
    locationPolicy: { moduleAccessOverrides: { office: { detail: { odoo: "write" } } } },
  };

  assert.deepEqual(resolveEffectiveWorkorderModuleAccess(base), {
    access: "write",
    source: "location",
  });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    ...base,
    locationPolicy: {
      ...base.locationPolicy,
      userModuleAccess: {
        "11111111-1111-4111-8111-111111111111": { detail: { odoo: "hidden" } },
      },
    },
  }), {
    access: "hidden",
    source: "user",
  });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    ...base,
    companyPolicy: {
      ...base.companyPolicy,
      userModuleAccess: {
        "11111111-1111-4111-8111-111111111111": { detail: { odoo: "hidden" } },
      },
    },
  }), {
    access: "hidden",
    source: "company_user",
  });
  assert.deepEqual(resolveEffectiveWorkorderModuleAccess({
    role: "mechanic",
    surface: "detail",
    moduleKey: "odoo",
  }), {
    access: "hidden",
    source: "default",
  });
});

test("V2 defaults preserve current create ownership by role", () => {
  assert.equal(canCreateWorkorderForRole("admin"), true);
  assert.equal(canCreateWorkorderForRole("office"), true);
  assert.equal(canCreateWorkorderForRole("mechanic"), true);
  assert.equal(canCreateWorkorderForRole("surveillance"), false);
});

test("Odoo detail defaults are writable for Admin and Surveillance only", () => {
  for (const role of ["admin", "surveillance"]) {
    assert.equal(resolveWorkorderModuleAccess({
      role,
      surface: "detail",
      moduleKey: "odoo",
    }), WORKORDER_ACCESS_MODES.WRITE);
  }
  for (const role of ["office", "mechanic"]) {
    assert.equal(resolveWorkorderModuleAccess({
      role,
      surface: "detail",
      moduleKey: "odoo",
    }), WORKORDER_ACCESS_MODES.HIDDEN);
  }
});

test("Admin can edit diagnosis and repair by default", () => {
  assert.equal(resolveWorkorderModuleAccess({
    role: "admin",
    surface: "detail",
    moduleKey: "diagnosisRepair",
  }), WORKORDER_ACCESS_MODES.WRITE);
  assert.equal(canWriteWorkorderModule({
    role: "admin",
    surface: "detail",
    moduleKey: "diagnosisRepair",
  }), true);
});

test("Office and Admin share diagnosis and repair write defaults", () => {
  for (const role of ["office", "admin"]) {
    assert.equal(resolveWorkorderModuleAccess({
      role,
      surface: "detail",
      moduleKey: "diagnosisRepair",
    }), WORKORDER_ACCESS_MODES.WRITE, role);
  }
});

test("location policy can enable create for surveillance without changing global defaults", () => {
  const policy = {
    moduleAccess: {
      surveillance: {
        create: {
          unit: "write",
          location: "required",
          concern: "required",
        },
      },
    },
  };

  assert.equal(canCreateWorkorderForRole("surveillance"), false);
  assert.equal(canCreateWorkorderForRole("surveillance", policy), true);
  assert.equal(resolveWorkorderModuleAccess({
    role: "surveillance",
    surface: "create",
    moduleKey: "concern",
    policy,
  }), WORKORDER_ACCESS_MODES.REQUIRED);
});

test("invalid or missing module access falls back to safe defaults", () => {
  const normalized = normalizeModuleAccessMap({
    mechanic: {
      detail: {
        odoo: "super-admin",
      },
    },
  });

  assert.equal(normalized.mechanic.detail.odoo, WORKORDER_ACCESS_MODES.HIDDEN);
  assert.equal(canWriteWorkorderModule({
    role: "admin",
    surface: "detail",
    moduleKey: "odoo",
    policy: { moduleAccess: { admin: { detail: { odoo: "write" } } } },
  }), true);
});

test("named user module overrides win over role defaults without changing other users", () => {
  const policy = {
    userModuleAccess: {
      "11111111-1111-4111-8111-111111111111": {
        create: {
          unit: "write",
          location: "required",
        },
      },
    },
  };

  assert.equal(canCreateWorkorderForRole("surveillance", policy), false);
  assert.equal(canCreateWorkorderForRole("surveillance", policy, "11111111-1111-4111-8111-111111111111"), true);
  assert.equal(resolveWorkorderModuleAccess({
    role: "surveillance",
    surface: "create",
    moduleKey: "location",
    policy,
    userId: "11111111-1111-4111-8111-111111111111",
  }), WORKORDER_ACCESS_MODES.REQUIRED);
});

test("named user module overrides store only explicit valid decisions", () => {
  assert.deepEqual(normalizeUserModuleAccessMap({
    "11111111-1111-4111-8111-111111111111": {
      create: {
        unit: "write",
        location: "inherit",
        odoo: "owner",
      },
      detail: {
        odoo: "read",
      },
    },
  }), {
    "11111111-1111-4111-8111-111111111111": {
      create: { unit: "write" },
      detail: { odoo: "read" },
    },
  });
});
