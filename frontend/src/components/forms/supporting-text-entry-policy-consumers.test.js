import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function policyCount(contents, kind) {
  return contents.match(new RegExp(`textEntryProps\\("${kind}"\\)`, "g"))?.length || 0;
}

test("supporting workorder prose uses the shared suggestion field while identifiers stay conservative", () => {
  const parts = source("../workorders/PartRequestsPanel.jsx");
  const surveillance = source("../../features/surveillance/SurveillanceWorkspace.jsx");

  assert.equal((parts.match(/<NarrativeField/g) || []).length, 4);
  assert.equal(policyCount(parts, "identifier"), 4);
  assert.equal((surveillance.match(/<NarrativeField/g) || []).length, 1);
  assert.equal(policyCount(surveillance, "identifier"), 1);
});

test("supporting workspaces opt every text search out of correction", () => {
  const workspaceSearches = [
    ["../../features/office/OfficeWorkspace.jsx", 2],
    ["../../features/mechanic/MechanicWorkspace.jsx", 2],
    ["../../features/surveillance/SurveillanceWorkspace.jsx", 2],
    ["../../features/workorder-drafts/WorkorderDraftQueue.jsx", 1],
    ["../operations/OperationsWorkspace.jsx", 1],
  ];

  for (const [file, expected] of workspaceSearches) {
    assert.equal(policyCount(source(file), "search"), expected, file);
  }
});

test("supporting account and kiosk credentials disable correction", () => {
  const credentialFields = [
    ["../../features/auth/LoginPage.jsx", 2],
    ["../../features/auth/ForgotPasswordDialog.jsx", 1],
    ["../../features/admin/InviteAcceptPage.jsx", 3],
    ["../../features/kiosk/KioskGate.jsx", 3],
  ];

  for (const [file, expected] of credentialFields) {
    assert.equal(policyCount(source(file), "identifier"), expected, file);
  }
});
