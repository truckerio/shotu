import assert from "node:assert/strict";
import test from "node:test";

import {
  normalizeSavedUsedParts,
  useRoleRouterFormController,
} from "./useRoleRouterFormController.js";

test("used-parts persistence strips transient UI fields", () => {
  assert.deepEqual(normalizeSavedUsedParts([{
    partNo: "FILTER-1",
    qty: "2",
    uomCode: "pc",
    repairOrder: "Replace",
    searchOpen: true,
  }]), [{
    partNo: "FILTER-1",
    qty: "2",
    uomCode: "pc",
    repairOrder: "Replace",
  }]);
});

test("start-date changes keep the state updater pure and autosave the derived end date once", () => {
  const autosavePatches = [];
  let update;
  const controller = useRoleRouterFormController({
    activeWorkorder: {
      allowedActions: { update: true },
      workorder: { id: "workorder-1" },
    },
    actorId: "office-1",
    form: { workEndDate: "2026-08-01" },
    isOfficeDetail: true,
    officeActionsRef: { current: { queueOfficeWorkorderAutosave: () => autosavePatches.push("queued") } },
    setActiveWorkorder: () => {},
    setCreateErrors: () => {},
    setForm: (next) => { update = next; },
    setUsedPartsDirty: () => {},
  });

  controller.updateStartDate("2026-08-02");

  assert.deepEqual(update({ workEndDate: "2026-08-01", concern: "Inspect" }), {
    workDate: "2026-08-02",
    workStartDate: "2026-08-02",
    workEndDate: "2026-08-02",
    concern: "Inspect",
  });
  assert.deepEqual(autosavePatches, ["queued"]);
});
