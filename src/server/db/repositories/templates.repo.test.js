import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const source = readFileSync(new URL("./templates.repo.js", import.meta.url), "utf8");

test("location template list keeps location id separate from optional template id", () => {
  assert.match(source, /location\.id as location_id/);
  assert.match(source, /template\.location_id as template_location_id/);
  assert.doesNotMatch(source, /location\.id as location_id,[\s\S]*\$\{templateColumns\}/);
});
