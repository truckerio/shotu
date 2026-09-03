import assert from "node:assert/strict";
import test from "node:test";
import { INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT, INSPECTION_REMOTE_WRITE_CONFIRMATION, parseInspectionWorkflowConfig, publicInspectionWorkflowConfig } from "./inspection-config.js";

const environment = { DATABASE_URL: "postgresql://qa:secret@localhost/workorders", QA_E2E_TARGET_ENVIRONMENT: "local", QA_E2E_BASE_URL: "http://localhost:4173", QA_LOCATION_NAME: "Chino Yard", QA_ACCOUNT_PASSWORD: "not-a-real-secret-123", QA_INSPECTION_TRUCK_ASSET_ID: "truck-fixture", QA_INSPECTION_TRAILER_ASSET_ID: "trailer-fixture" };

test("inspection workflow refuses production, unconfirmed staging writes, and incomplete fixtures", () => {
  assert.throws(() => parseInspectionWorkflowConfig({ ...environment, QA_E2E_TARGET_ENVIRONMENT: "production" }), /production/i);
  assert.throws(() => parseInspectionWorkflowConfig({ ...environment, QA_E2E_TARGET_ENVIRONMENT: "staging", QA_E2E_BASE_URL: "https://staging.example.test" }), /CONFIRM_REMOTE_WRITES/);
  assert.throws(() => parseInspectionWorkflowConfig({ ...environment, QA_E2E_TARGET_ENVIRONMENT: "staging", QA_E2E_BASE_URL: "https://staging.example.test", QA_INSPECTION_CONFIRM_REMOTE_WRITES: INSPECTION_REMOTE_WRITE_CONFIRMATION }), /EVIDENCE_RETENTION_ACKNOWLEDGEMENT/);
  assert.throws(() => parseInspectionWorkflowConfig({ ...environment, QA_INSPECTION_TRUCK_ASSET_ID: "" }), /TRUCK_ASSET_ID/);
});

test("inspection workflow redacts password and requires every deferred capability", () => {
  const config = parseInspectionWorkflowConfig(environment);
  assert.equal(JSON.stringify(publicInspectionWorkflowConfig(config)).includes(environment.QA_ACCOUNT_PASSWORD), false);
  assert.throws(() => parseInspectionWorkflowConfig({ ...environment, QA_INSPECTION_CAPABILITIES: "follow_up" }), /cannot silently skip/i);
  assert.equal(INSPECTION_REMOTE_WRITE_CONFIRMATION, "RUN_INSPECTION_WORKFLOW");
  assert.equal(INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT, "RETAIN_QA_INSPECTION_EVIDENCE");
});
