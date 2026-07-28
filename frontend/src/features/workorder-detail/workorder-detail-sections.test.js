import assert from "node:assert/strict";
import test from "node:test";
import {
  buildWorkorderDetailSections,
  buildCompactPhoneDetailSections,
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

test("compact phone detail keeps role actions visible and moves supporting sections into More", () => {
  const sections = [
    { id: "work", label: "Review" },
    { id: "chat", label: "Chat" },
    { id: "parts", label: "Parts" },
    { id: "unit", label: "Truck" },
    { id: "team", label: "Team" },
    { id: "activity", label: "Activity" },
  ];

  const office = buildCompactPhoneDetailSections(sections, "office");
  assert.deepEqual(office.map(({ id }) => id), ["work", "chat", "parts", "preview", "unit", "team", "activity"]);
  assert.deepEqual(office.filter(({ overflow }) => overflow).map(({ id }) => id), ["unit", "team", "activity"]);

  const mechanic = buildCompactPhoneDetailSections(sections, "mechanic");
  assert.deepEqual(mechanic.map(({ id }) => id), ["work", "chat", "parts", "preview", "unit", "activity"]);
  assert.deepEqual(mechanic.filter(({ overflow }) => overflow).map(({ id }) => id), ["unit", "activity"]);

  const surveillance = buildCompactPhoneDetailSections(sections, "surveillance");
  assert.deepEqual(surveillance.map(({ id }) => id), ["work", "parts", "preview", "activity", "unit", "team"]);
  assert.equal(surveillance[0].label, "Review");
  assert.deepEqual(surveillance.filter(({ overflow }) => overflow).map(({ id }) => id), ["unit", "team"]);
});
