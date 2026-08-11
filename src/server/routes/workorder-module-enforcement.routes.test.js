import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const mechanicSource = await readFile(new URL("./mechanic.routes.js", import.meta.url), "utf8");
const officeSource = await readFile(new URL("./office.routes.js", import.meta.url), "utf8");

function delegatedAction(source, moduleKey, action) {
  assert.match(
    source,
    new RegExp(`runAction\\([\\s\\S]{0,180}?"${moduleKey}"[\\s\\S]{0,60}?"${action}"`),
    `missing ${moduleKey}/${action} canonical delegate`,
  );
}

test("mechanic workorder mutations declare their canonical module actions", () => {
  for (const [moduleKey, action] of [
    ["parts", "request"],
    ["parts", "record"],
    ["assignment", "accept"],
    ["assignment", "release"],
    ["diagnosisRepair", "update"],
    ["completion", "markWorkDone"],
    ["chat", "acknowledge"],
  ]) {
    if (action === "update") continue;
    delegatedAction(mechanicSource, moduleKey, action);
  }

  assert.match(mechanicSource, /patchModule\(requestContext, progressId, "diagnosisRepair", input\)/);
  assert.match(mechanicSource, /"chat", input\.attachment \? "attach" : "send"/);
  assert.match(mechanicSource, /createRuntime\(requestContext, input, rawInput\)/);
});

test("office workorder mutations declare their canonical module actions", () => {
  for (const [moduleKey, action] of [
    ["unit", "update"],
    ["location", "update"],
    ["schedule", "update"],
    ["concern", "update"],
    ["parts", "record"],
    ["parts", "allocate"],
    ["chat", "acknowledge"],
    ["completion", "markWorkDone"],
    ["completion", "close"],
    ["completion", "requestChanges"],
    ["completion", "cancel"],
    ["assignment", "reassign"],
    ["assignment", "assign"],
  ]) {
    if (action === "update") continue;
    delegatedAction(officeSource, moduleKey, action);
  }

  assert.match(officeSource, /patchModules\([\s\S]{0,180}?moduleKeys\.map/);
  assert.match(officeSource, /const action = input\.decision === "rejected" \? "decline" : "approve"/);
  assert.match(officeSource, /"chat", input\.attachment \? "attach" : "send"/);
  assert.match(officeSource, /createRuntime\(requestContext, input, rawInput\)/);
});
