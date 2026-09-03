import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { inspectionCreateAttempt } from "./useCreateInspectionController.js";

const controller = readFileSync(new URL("./useCreateInspectionController.js", import.meta.url), "utf8");
const experience = readFileSync(new URL("./InspectionExperience.jsx", import.meta.url), "utf8");

test("a failed create retry reuses one bounded idempotency key, while a material payload change gets a new key", () => {
  let keyNumber = 0;
  const createKey = () => `inspection-create-key-${++keyNumber}`;
  const first = inspectionCreateAttempt(null, { assetId: "asset-1", locationId: "location-1" }, createKey);
  const retry = inspectionCreateAttempt(first, { assetId: "asset-1", locationId: "location-1" }, createKey);
  const changed = inspectionCreateAttempt(first, { assetId: "asset-1", locationId: "location-2" }, createKey);

  assert.equal(first.idempotencyKey, retry.idempotencyKey);
  assert.equal(first.idempotencyKey.length >= 8 && first.idempotencyKey.length <= 120, true);
  assert.notEqual(first.idempotencyKey, changed.idempotencyKey);
});

test("create keeps its attempt across a transport failure and clears it only after onCreated succeeds", () => {
  assert.match(controller, /const createAttempt = useRef\(null\)/);
  assert.match(controller, /inspectionCreateAttempt\(createAttempt\.current, payload\)/);
  assert.match(controller, /idempotencyKey: attempt\.idempotencyKey/);
  assert.match(controller, /await onCreated\?\.\(result\);[\s\S]*createAttempt\.current = null/);
  assert.match(controller, /catch \(error\)[\s\S]*createAttempt\.current = attempt/);
});

test("duplicate-active create responses follow the normal created-inspection contract", () => {
  assert.match(controller, /const result = await request\?\.\("\/api\/inspections"/);
  assert.match(controller, /await onCreated\?\.\(result\);/);
});

test("completion marks only the Admin projection as acting inspector", () => {
  assert.match(experience, /\.\.\.\(projection === "admin" \? \{ actingAsInspector: true \} : \{\}\)/);
  assert.match(experience, /expectedVersion: current\.version, finalNotes,/);
  assert.doesNotMatch(experience, /actingAsInspector: projection !== "admin"/);
});

test("completion and in-app exit wait for response saves and block on a failed item", () => {
  assert.match(experience, /const failedResponseSaves = useRef\(new Map\(\)\)/);
  assert.match(experience, /failedResponseSaves\.current\.set\(itemKey, error\)/);
  assert.match(experience, /failedResponseSaves\.current\.delete\(itemKey\)/);
  assert.match(experience, /async function flushResponseSaves\(\)[\s\S]*await saveQueue\.current/);
  assert.match(experience, /async function complete[\s\S]*if \(!await flushResponseSaves\(\)\) return/);
  assert.match(experience, /async function returnToQueue\(\)[\s\S]*if \(!await flushResponseSaves\(\)\) return/);
  assert.match(experience, /window\.addEventListener\("beforeunload", warnBeforeUnload\)/);
});
