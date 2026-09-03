import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

const source = await readFile(new URL("./WorkspaceCreateActions.jsx", import.meta.url), "utf8");
const css = await readFile(new URL("./workspace-create-actions.css", import.meta.url), "utf8");

test("create menu exposes only Workorder and Inspection when both actions are authorized", () => {
  assert.match(source, /label: "Workorder"/);
  assert.match(source, /label: "Inspection"/);
  assert.match(source, /actions\.length === 1/);
  assert.match(source, /<Menu[\s\S]*aria-label="Create"/);
  assert.doesNotMatch(source, /Create workorder[^"\n]*description|Create inspection[^"\n]*description/i);
});

test("create controls keep touch-sized targets and keyboard focus styling", () => {
  assert.match(css, /min-height:\s*44px/);
  assert.match(css, /\[data-focused\]/);
});
