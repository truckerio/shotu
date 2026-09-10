import assert from "node:assert/strict";
import test from "node:test";
import { mainWorkorderSections, requestedWorkorderTool } from "./workorder-tools-model.js";

test("form keeps work fields and parts, supporting tools never become bottom form sections", () => {
  const sections = ["location", "unit", "concern", "diagnosisRepair", "parts", "chat", "photos", "activity", "completion", "odoo", "preview"].map((id) => ({ id, access: "read" }));
  assert.deepEqual(mainWorkorderSections(sections).map(({id}) => id), ["location", "unit", "concern", "diagnosisRepair", "parts"]);
  assert.equal(mainWorkorderSections(sections)[0], sections[0]);
  assert.deepEqual(mainWorkorderSections(), []);
});
test("photos deep link goes to chat without creating a separate photo view", () => {
  assert.equal(requestedWorkorderTool("photos"), "chat");
  assert.equal(requestedWorkorderTool("completion"), "completion");
  assert.equal(requestedWorkorderTool("parts"), null);
  assert.equal(requestedWorkorderTool("unknown"), null);
});
