import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { parseRoleWorkflowConfig, publicRoleWorkflowConfig } from "./config.js";
import {
  ROLE_WORKFLOW_STEPS,
  assertLifecycle,
  assertOdooReadiness,
  buildWorkorderInput,
  chooseWorkflowLocations,
} from "./workflow.js";

const validEnvironment = {
  DATABASE_URL: "postgresql://qa:secret@localhost/workorders",
  QA_E2E_TARGET_ENVIRONMENT: "local",
  QA_E2E_BASE_URL: "http://localhost:4173",
  QA_LOCATION_NAME: "Chino Yard",
  QA_ACCOUNT_PASSWORD: "not-a-real-secret-123",
};

test("role workflow config keeps credentials private and defaults to browser verification", () => {
  const config = parseRoleWorkflowConfig(validEnvironment, []);
  const publicConfig = publicRoleWorkflowConfig(config);
  assert.equal(config.browser.enabled, true);
  assert.equal(config.provisionAccounts, true);
  assert.equal(publicConfig.credentials.length, 4);
  assert.equal(JSON.stringify(publicConfig).includes(validEnvironment.QA_ACCOUNT_PASSWORD), false);
});

test("role workflow refuses production and unconfirmed remote writes", () => {
  assert.throws(
    () => parseRoleWorkflowConfig({ ...validEnvironment, QA_E2E_TARGET_ENVIRONMENT: "production" }, []),
    /cannot run against production|Production QA-account changes/,
  );
  assert.throws(
    () => parseRoleWorkflowConfig({
      ...validEnvironment,
      QA_E2E_TARGET_ENVIRONMENT: "staging",
      QA_E2E_BASE_URL: "https://staging.example.test",
    }, []),
    /QA_E2E_CONFIRM_REMOTE_WRITES=RUN_ROLE_WORKFLOW/,
  );
});

test("location selection requires one scoped location and one inaccessible company location", () => {
  const locations = [
    { id: "chino", company_id: "company", name: "Chino Yard", active: true },
    { id: "texas", company_id: "company", name: "Texas Yard", active: true },
  ];
  assert.deepEqual(
    chooseWorkflowLocations(locations, { primaryName: "Chino Yard", scopedLocationIds: ["chino"] }),
    { primary: locations[0], restricted: locations[1] },
  );
  assert.throws(
    () => chooseWorkflowLocations(locations.slice(0, 1), {
      primaryName: "Chino Yard",
      scopedLocationIds: ["chino"],
    }),
    /second active company location/,
  );
});

test("workorder payload and lifecycle assertions preserve workflow truth", () => {
  const payload = buildWorkorderInput({
    location: { id: "location-id", company_id: "company-id" },
    concern: "QA concern",
  });
  assert.equal(payload.companyId, "company-id");
  assert.equal(payload.locationId, "location-id");
  assert.equal(payload.mechanicUserIds.length, 0);
  assert.equal(payload.formData.parts.length, 0);
  assert.doesNotThrow(() => assertLifecycle({ lifecycle: "closed" }, "closed", "close"));
  assert.throws(() => assertLifecycle({ status: "open" }, "closed", "close"), /expected lifecycle closed/);
});

test("Odoo readiness reports provider truth without inventing a draft result", () => {
  assert.deepEqual(assertOdooReadiness({
    ready: false,
    blockers: [{ code: "ODOO_CONNECTION_MISSING", message: "Configure Odoo." }],
  }), {
    ready: false,
    blockerCodes: ["ODOO_CONNECTION_MISSING"],
  });
  assert.deepEqual(assertOdooReadiness({ ready: true, blockers: [] }), {
    ready: true,
    blockerCodes: [],
  });
  assert.throws(() => assertOdooReadiness({ ready: false, blockers: [] }), /did not explain/);
  assert.throws(() => assertOdooReadiness({}), /boolean ready state/);
});

test("workflow source covers every requested stage and avoids production domain imports", async () => {
  assert.deepEqual(ROLE_WORKFLOW_STEPS, [
    "admin-create",
    "authorization-boundaries",
    "office-assign",
    "mechanic-accept",
    "chat-and-parts",
    "office-part-decision",
    "mechanic-done",
    "office-close",
    "surveillance-odoo-readiness",
  ]);
  const workflowPath = fileURLToPath(new URL("./workflow.js", import.meta.url));
  const source = await readFile(workflowPath, "utf8");
  assert.match(source, /expectedStatuses: \[403, 404\]/);
  assert.match(source, /WORKORDER_ALREADY_ACCEPTED/);
  assert.match(source, /decision: "rejected"/);
  assert.match(source, /modules\/odoo\/readiness/);
  assert.doesNotMatch(source, /mark-odoo-entered/);
  assert.doesNotMatch(source, /modules\/odoo\/draft/);
  assert.doesNotMatch(source, /src\/server\/modules|src\/server\/db\/repositories/);
});

test("browser workflow measures real role workorders at release viewports and captures browser errors", async () => {
  const browserPath = fileURLToPath(new URL("./browser-assertions.js", import.meta.url));
  const source = await readFile(browserPath, "utf8");
  for (const [name, width, height] of [
    ["phone-390", 390, 844],
    ["phone-430", 430, 932],
    ["desktop-1280", 1280, 800],
    ["desktop-1920", 1920, 1080],
  ]) {
    assert.match(source, new RegExp(`name: "${name}", width: ${width}, height: ${height}`));
  }
  assert.match(source, /documentElement\.scrollWidth/);
  assert.match(source, /page\.on\("console"/);
  assert.match(source, /page\.on\("pageerror"/);
  assert.match(source, /Needs Odoo/);
  assert.match(source, /assertOdooReadinessSurface/);
});
