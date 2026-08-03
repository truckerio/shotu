import assert from "node:assert/strict";
import test from "node:test";

import { requestedDetailSection } from "./useWorkorderDetailRoute.js";

test("detail route preserves an explicitly requested compact section", () => {
  assert.equal(requestedDetailSection({
    requestedSection: "chat",
    role: "mechanic",
    status: "in_progress",
    isCompact: true,
  }), "chat");
});

test("detail route rejects unknown sections and uses the role default", () => {
  const section = requestedDetailSection({
    requestedSection: "unknown",
    role: "mechanic",
    status: "in_progress",
    isCompact: true,
  });
  assert.equal(section, "work");
});

test("office and admin detail routes preserve explicit shared sections", () => {
  for (const role of ["office", "admin"]) {
    assert.equal(requestedDetailSection({
      requestedSection: "activity",
      role,
      status: "closed",
      isCompact: false,
    }), "activity");
  }
});
