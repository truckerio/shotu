import assert from "node:assert/strict";
import test from "node:test";

import { requestedAllowedDetailSection, requestedDetailSection } from "./useWorkorderDetailRoute.js";

test("detail route preserves an explicitly requested compact section", () => {
  assert.equal(requestedDetailSection({
    requestedSection: "chat",
    role: "mechanic",
    status: "in_progress",
    isCompact: true,
  }), "chat");
});

test("detail route rejects unknown sections and uses the role default", () => {
  const section = requestedDetailSection({
    requestedSection: "unknown",
    role: "mechanic",
    status: "in_progress",
    isCompact: true,
  });
  assert.equal(section, "diagnosisRepair");
});

test("office and admin detail routes preserve explicit shared sections", () => {
  for (const role of ["office", "admin"]) {
    assert.equal(requestedDetailSection({
      requestedSection: "activity",
      role,
      status: "closed",
      isCompact: false,
    }), "activity");
  }
});

test("Admin detail route preserves an explicitly requested Odoo module", () => {
  assert.equal(requestedDetailSection({
    requestedSection: "odoo",
    role: "admin",
    status: "closed",
    isCompact: false,
  }), "odoo");
});

test("Admin Odoo route falls back when a named-user override hides the module", () => {
  const section = requestedAllowedDetailSection({
    detail: {
      workorder: { id: "wo-odoo", status: "closed", formData: {} },
      messages: [],
      partRequests: [],
      policy: {
        userModuleAccess: {
          "admin-1": { detail: { odoo: "hidden" } },
        },
      },
      timeline: [],
    },
    isCompact: false,
    isMechanicDetail: false,
    isOfficeDetail: true,
    requestedSection: "odoo",
    role: "admin",
    status: "closed",
    userId: "admin-1",
  });

  assert.equal(section, "concern");
});

test("detail route redirects hidden requested sections to first allowed module", () => {
  const section = requestedAllowedDetailSection({
    detail: {
      workorder: { id: "wo-1", status: "open", formData: {} },
      messages: [],
      partRequests: [],
      policy: {
        userModuleAccess: {
          "office-1": {
            detail: {
              concern: "hidden",
              parts: "write",
            },
          },
        },
      },
      timeline: [],
    },
    isCompact: false,
    isMechanicDetail: false,
    isOfficeDetail: true,
    requestedSection: "concern",
    role: "office",
    status: "open",
    userId: "office-1",
  });

  assert.equal(section, "diagnosisRepair");
});
