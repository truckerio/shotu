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

test("scanned approved parts replace a blank draft row and preserve exact catalog identity", () => {
  let update;
  const controller = createRoleRouterFormController({
    activeWorkorder: null,
    actorId: "office-1",
    form: { workEndDate: "" },
    isOfficeDetail: false,
    officeActionsRef: { current: null },
    setActiveWorkorder: () => {},
    setCreateErrors: () => {},
    setForm: (next) => { update = next; },
    setUsedPartsDirty: () => {},
  });

  controller.addPartRow({
    catalogPartId: "part-1",
    partNo: "FILTER-1",
    qty: "1",
    uomCode: "ea",
    repairOrder: "",
  });

  assert.deepEqual(update({
    concern: "Inspect",
    parts: [{ partNo: "", qty: "", uomCode: "pc", repairOrder: "" }],
  }), {
    concern: "Inspect",
    parts: [{ catalogPartId: "part-1", partNo: "FILTER-1", qty: "1", uomCode: "ea", repairOrder: "" }],
  });
});

test("shared form callbacks remain stable across unrelated router renders", () => {
  assert.match(source, /return useMemo\(\(\) => createRoleRouterFormController/);
  assert.match(source, /form: \{ workEndDate: form\.workEndDate \}/);
  assert.doesNotMatch(source, /\[form,/);
});

test("Used Parts stays dirty until the editor acknowledges the latest saved revision", () => {
  const dirtyStates = [];
  const formUpdates = [];
  const detailUpdates = [];
  const controller = createRoleRouterFormController({
    activeWorkorder: {
      allowedActions: { update: true },
      workorder: { id: "workorder-1" },
    },
    actorId: "mechanic-1",
    form: { workEndDate: "" },
    isOfficeDetail: false,
    officeActionsRef: { current: null },
    setActiveWorkorder: (next) => detailUpdates.push(next),
    setCreateErrors: () => {},
    setForm: (next) => formUpdates.push(next),
    setUsedPartsDirty: (dirty) => dirtyStates.push(dirty),
  });
  const draft = [{ partNo: "FILTER  ", qty: "1", uomCode: "pc", repairOrder: "Replace" }];
  const canonicalWorkorder = { id: "workorder-1", formData: { parts: draft } };

  controller.updateActiveUsedParts(draft);
  controller.updateActiveUsedParts(draft, { saved: true, workorder: canonicalWorkorder });

  assert.deepEqual(dirtyStates, [true, false]);
  assert.deepEqual(formUpdates[0]({ other: "preserved", parts: [] }), { other: "preserved", parts: draft });
  assert.deepEqual(formUpdates[1]({ other: "preserved", parts: [] }), { other: "preserved", parts: draft });
  assert.deepEqual(detailUpdates[0]({ allowedActions: {}, workorder: { id: "old" } }), {
    allowedActions: {},
    workorder: canonicalWorkorder,
  });
});
