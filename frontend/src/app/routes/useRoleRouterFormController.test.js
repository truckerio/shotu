import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

import {
  createRoleRouterFormController,
  normalizeSavedUsedParts,
} from "./useRoleRouterFormController.js";

const source = readFileSync(new URL("./useRoleRouterFormController.js", import.meta.url), "utf8");

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
  const controller = createRoleRouterFormController({
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

test("diagnosis module changes do not race the administrative autosave", () => {
  const autosaveCalls = [];
  const controller = createRoleRouterFormController({
    activeWorkorder: {
      allowedActions: { update: true },
      workorder: { id: "workorder-1" },
    },
    actorId: "admin-1",
    form: { workEndDate: "" },
    isOfficeDetail: true,
    officeActionsRef: { current: { queueOfficeWorkorderAutosave: () => autosaveCalls.push("queued") } },
    setActiveWorkorder: () => {},
    setCreateErrors: () => {},
    setForm: () => {},
    setUsedPartsDirty: () => {},
  });

  controller.updateField("diagnosis", "Found leak");
  controller.updateField("workPerformed", "Replaced hose");

  assert.deepEqual(autosaveCalls, []);
});

test("shared form callbacks remain stable across unrelated router renders", () => {
  assert.match(source, /return useMemo\(\(\) => createRoleRouterFormController/);
  assert.match(source, /form: \{ workEndDate: form\.workEndDate \}/);
  assert.doesNotMatch(source, /\[form,/);
});
