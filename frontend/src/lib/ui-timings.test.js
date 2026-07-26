import assert from "node:assert/strict";
import test from "node:test";
import {
  MAP_CLOSE_DELAY_MS,
  MAP_OPEN_DELAY_MS,
  MAP_SURFACE_TRANSITION_MS,
} from "./ui-timings.js";

test("all delayed satellite maps use shared open and close timing", () => {
  assert.equal(MAP_OPEN_DELAY_MS, 250);
  assert.equal(MAP_CLOSE_DELAY_MS, 250);
  assert.equal(MAP_SURFACE_TRANSITION_MS, 250);
});
