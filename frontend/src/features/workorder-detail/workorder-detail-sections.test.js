import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkorderDetailSections,
  defaultDetailSection,
  defaultSupportingView,
  workorderDetailSectionMode,
  workorderNeedsChatAttention,
} from "./workorder-detail-sections.js";

test("workorder detail sections keep shared tab contract across roles", () => {
  const base = {
    activeWorkorder: { workorder: { id: "wo-1" } },
    assignedMechanicCount: 2,
    conversationCount: 4,
    detailStatus: "accepted",
    filledPartCount: 1,
    isCompact: false,
    pendingPartCount: 0,
    timelineCount: 6,
    unitType: "Truck",
  };

  assert.deepEqual(
    buildWorkorderDetailSections({ ...base, isMechanicDetail: true, isOfficeDetail: false }).map((section) => section.id),
    ["work", "parts", "unit", "activity"],
  );
  assert.deepEqual(
    buildWorkorderDetailSections({ ...base, isMechanicDetail: false, isOfficeDetail: true }).map((section) => section.id),
    ["work", "parts", "unit", "team", "activity"],
  );
});

test("compact attention status starts on chat and opens chat dock", () => {
  assert.equal(defaultDetailSection("mechanic", "parts_requested", true), "chat");
  assert.equal(defaultSupportingView("office", "waiting_office"), "chat");
  assert.equal(workorderNeedsChatAttention("waiting_office"), true);
  assert.equal(workorderNeedsChatAttention("accepted"), false);
});

test("workorder detail tabs render as page panels", () => {
  assert.equal(workorderDetailSectionMode(), "panel");
});
