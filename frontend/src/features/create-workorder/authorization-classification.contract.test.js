import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const page = readFileSync(new URL("./CreateWorkorderPage.jsx", import.meta.url), "utf8");
const customerField = readFileSync(new URL("./CustomerDirectoryField.jsx", import.meta.url), "utf8");
const approvalControl = readFileSync(new URL("./ApprovalRequestControl.jsx", import.meta.url), "utf8");
const commands = readFileSync(new URL("../../app/routes/useRoleRouterCommands.js", import.meta.url), "utf8");
const draftApi = readFileSync(new URL("./workorder-draft-api.js", import.meta.url), "utf8");
const draftLifecycle = readFileSync(new URL("./useWorkorderDraftLifecycle.js", import.meta.url), "utf8");

test("all new drafts default to informational approval and only explicit approval requests block direct create", () => {
  assert.match(customerField, /ApprovalRequestControl/);
  assert.match(page, /authorizationClassification \|\| ""/);
  assert.match(page, /authorizationResolved/);
  assert.match(page, /authorizationClassification !== "required_external_customer"/);
  assert.match(commands, /form\.authorizationClassification === "required_external_customer"/);
});

test("draft restore preserves the canonical legacy classification without defaulting it", () => {
  assert.match(draftLifecycle, /savedDraft\.authorizationClassification === "unclassified"[\s\S]*?\? ""/);
  assert.match(draftLifecycle, /savedDraft\.authorizationClassification \|\| savedDraft\.payload\?\.authorizationClassification/);
  assert.match(approvalControl, /Choose approval/);
  assert.match(approvalControl, /Not required/);
  assert.match(commands, /!form\.authorizationClassification/);
});

test("Admin exceptions remain audited but do not replace the default approval-not-required path", () => {
  assert.match(page, /authorizationExceptionReady/);
  assert.match(page, /Legacy authorization exceptions/);
  assert.match(page, /Exception reason/);
  assert.match(commands, /\["internal_fleet", "exempt"\]\.includes\(form\.authorizationClassification\).*authorizationExceptionReason/);
  assert.match(draftApi, /authorizationClassification: payload\.authorizationClassification \|\| undefined/);
});
