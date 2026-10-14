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

test("customer-document adjustment intent enters the Office backup and autosave queue", () => {
  const values = new Map();
  const priorWindow = globalThis.window;
  globalThis.window = { localStorage: {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  } };
  try {
    const autosaveCalls = [];
    let update;
    const controller = createRoleRouterFormController({
      activeWorkorder: {
        allowedActions: { update: true },
        workorder: { id: "workorder-1" },
      },
      actorId: "office-1",
      form: { workEndDate: "" },
      isOfficeDetail: true,
      officeActionsRef: { current: { queueOfficeWorkorderAutosave: () => autosaveCalls.push("queued") } },
      setActiveWorkorder: () => {},
      setCreateErrors: () => {},
      setForm: (next) => { update = next; },
      setUsedPartsDirty: () => {},
    });
    const adjustments = {
      lineDiscounts: [],
      documentDiscount: { kind: "percentage", value: "", reason: "" },
      overrideReasons: [],
    };
    const revisionId = "22222222-2222-4222-8222-222222222222";

    controller.updateField("customerDocumentAdjustments", adjustments);
    assert.deepEqual(update({ existing: true }), { existing: true, customerDocumentAdjustments: adjustments });
    controller.updateField("customerDocumentAdjustmentBaseRevisionId", revisionId);
    assert.deepEqual(update({ customerDocumentAdjustments: adjustments }), {
      customerDocumentAdjustments: adjustments,
      customerDocumentAdjustmentBaseRevisionId: revisionId,
    });

    assert.deepEqual(JSON.parse([...values.values()][0]), {
      customerDocumentAdjustments: adjustments,
      customerDocumentAdjustmentBaseRevisionId: revisionId,
    });
    assert.deepEqual(autosaveCalls, ["queued", "queued"]);
  } finally {
    if (priorWindow === undefined) delete globalThis.window;
    else globalThis.window = priorWindow;
  }
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

test("confirmed multi-unit selection becomes independent serialized draft rows", () => {
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
  const current = {
    parts: [{ catalogPartId: "part-1", partNo: "TIRE-1", qty: "", uomCode: "ea", repairOrder: "Replace", serializationRequired: true }],
  };

  controller.replacePartSerializedUnits(0, {
    serializedUnitIds: ["unit-1", "unit-2"],
    serializedSerialNumbers: ["SER-1", "SER-2"],
  });

  assert.deepEqual(update(current).parts.map((part) => [part.qty, part.serializedUnitIds, part.serializedSerialNumbers]), [
    ["1", ["unit-1"], ["SER-1"]],
    ["1", ["unit-2"], ["SER-2"]],
  ]);
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
