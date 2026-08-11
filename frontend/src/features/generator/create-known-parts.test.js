import test from "node:test";
import assert from "node:assert/strict";
import { createInitialKnownParts } from "./create-known-parts.js";
import { formValuesFromWorkorderDraft } from "./workorder-draft.js";

test("a new workorder starts with three independent blank known-part rows", () => {
  assert.deepEqual(createInitialKnownParts(), [
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
    { partNo: "", qty: "", uomCode: "pc", repairOrder: "" },
  ]);
});

test("fresh known-part state is not shared between workorders", () => {
  const first = createInitialKnownParts();
  const second = createInitialKnownParts();

  first[0].partNo = "FILTER";

  assert.equal(second[0].partNo, "");
});

test("an empty restored draft keeps the current three blank rows", () => {
  const currentForm = { parts: createInitialKnownParts() };
  const restored = formValuesFromWorkorderDraft({ formData: { parts: [] } }, currentForm);

  assert.deepEqual(restored.parts, currentForm.parts);
});

test("a restored draft preserves every entered part row", () => {
  const savedParts = [
    { partNo: "OIL", qty: "2.5", uomCode: "gal", repairOrder: "Refill" },
    { partNo: "FILTER", qty: "1", uomCode: "pc", repairOrder: "Replace" },
  ];
  const restored = formValuesFromWorkorderDraft(
    { formData: { parts: savedParts } },
    { parts: createInitialKnownParts() },
  );

  assert.deepEqual(restored.parts, savedParts);
});
