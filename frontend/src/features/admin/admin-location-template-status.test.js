import assert from "node:assert/strict";
import test from "node:test";
import { locationHasTemplate } from "./adminLocationStatus.js";

test("location template status accepts API flags and populated template fields", () => {
  assert.equal(locationHasTemplate({ has_template: true }), true);
  assert.equal(locationHasTemplate({ hasTemplate: true }), true);
  assert.equal(locationHasTemplate({ has_template: false, header_title: "Chino workorder" }), true);
  assert.equal(locationHasTemplate({ has_template: false, header_title: " " }), false);
});
