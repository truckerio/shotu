import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("restoring a draft clears stale create feedback without a redundant success notice", () => {
  const source = readFileSync(new URL("./useWorkorderDraftLifecycle.js", import.meta.url), "utf8");
  const restore = source.slice(source.indexOf("const restoreWorkorderDraft"), source.indexOf("const openSavedDraft"));
  assert.match(restore, /draft.reset\(savedDraft\)/);
  assert.match(restore, /setCreateState\(\{ busy: false, message: "" \}\)/);
  assert.doesNotMatch(source, /Draft restored\./);
  const form = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");
  assert.match(form, /role=\{error \? "alert" : "status"\}/);
});
