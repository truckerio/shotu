import assert from "node:assert/strict";
import test from "node:test";

import { requestedMechanicSection } from "./useWorkorderDetailRoute.js";

test("detail route preserves an explicitly requested compact section", () => {
  assert.equal(requestedMechanicSection({
    requestedSection: "chat",
    status: "in_progress",
    isCompact: true,
  }), "chat");
});

test("detail route rejects unknown sections and uses the role default", () => {
  const section = requestedMechanicSection({
    requestedSection: "unknown",
    status: "in_progress",
    isCompact: true,
  });
  assert.equal(section, "work");
});
