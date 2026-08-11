import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  clearOfficeWorkorderEditBackup,
  officeWorkorderEditStorageKey,
  readOfficeWorkorderEditBackup,
  writeOfficeWorkorderEditBackup,
} from "./office-workorder-autosave-storage.js";

const roleRouter = readFileSync(new URL("../../app/routes/RoleRouter.jsx", import.meta.url), "utf8");
const formController = readFileSync(new URL("../../app/routes/useRoleRouterFormController.js", import.meta.url), "utf8");
const lifecycleEffects = readFileSync(new URL("../../app/routes/useRoleRouterLifecycleEffects.js", import.meta.url), "utf8");
const officeActions = readFileSync(new URL("../office/useOfficeWorkorderActions.js", import.meta.url), "utf8");
const createLocationController = readFileSync(new URL("../create-workorder/useCreateLocationController.js", import.meta.url), "utf8");
const createLocationModel = readFileSync(new URL("../create-workorder/create-location-controller-model.js", import.meta.url), "utf8");

function memoryStorage() {
  const values = new Map();
  return {
    getItem: (key) => values.get(key) ?? null,
    removeItem: (key) => values.delete(key),
    setItem: (key, value) => values.set(key, value),
  };
}

test("office workorder edit backups isolate actor and workorder", () => {
  const storage = memoryStorage();
  writeOfficeWorkorderEditBackup("office-1", "wo-1", { customerSignature: "Driver One" }, storage);
  writeOfficeWorkorderEditBackup("office-1", "wo-1", { officeNotes: "Call complete" }, storage);
  assert.deepEqual(readOfficeWorkorderEditBackup("office-1", "wo-1", storage), {
    customerSignature: "Driver One",
    officeNotes: "Call complete",
  });
  assert.equal(readOfficeWorkorderEditBackup("office-2", "wo-1", storage), null);
  assert.notEqual(officeWorkorderEditStorageKey("office-1", "wo-1"), officeWorkorderEditStorageKey("office-1", "wo-2"));
});

test("confirmed saves clear only the scoped backup", () => {
  const storage = memoryStorage();
  writeOfficeWorkorderEditBackup("office-1", "wo-1", { customerSignature: "Driver One" }, storage);
  writeOfficeWorkorderEditBackup("office-1", "wo-2", { customerSignature: "Driver Two" }, storage);
  clearOfficeWorkorderEditBackup("office-1", "wo-1", storage);
  assert.equal(readOfficeWorkorderEditBackup("office-1", "wo-1", storage), null);
  assert.deepEqual(readOfficeWorkorderEditBackup("office-1", "wo-2", storage), { customerSignature: "Driver Two" });
});

test("Office parts autosave uses the narrow persistence endpoint and reloads server truth", () => {
  assert.match(officeActions, /workorderPath\(workorderId, "\/used-parts"\)/);
  assert.match(officeActions, /body: JSON\.stringify\(\{ parts, laborHours \}\)/);
  assert.match(officeActions, /reloadOfficeWorkorder\(result\.workorder\.id/);
  assert.match(officeActions, /savedParts = detail\.workorder\.formData\?\.parts \|\| \[\]/);
  assert.match(officeActions, /savedLaborHours = detail\.workorder\.formData\?\.laborHours \|\| ""/);
  assert.doesNotMatch(officeActions, /formData:\s*\{\s*\.\.\.\(activeWorkorder\.workorder\.formData \|\| \{\}\),\s*parts,/s);
  assert.match(roleRouter, /useOfficeWorkorderActions/);
});

test("detail location and template changes enter the shared autosave queue", () => {
  assert.match(createLocationModel, /function createLocationSelectionPatch[\s\S]*locationId: selectedLocation\.location\.id[\s\S]*templateFieldsForCreateLocation/);
  assert.match(createLocationController, /onSelectionPatch\(patch\)/);
  assert.match(roleRouter, /onSelectionPatch: stageOfficeWorkorderAutosave/);
});

test("real-time refresh cannot overwrite debounced part edits", () => {
  assert.match(formController, /function updateActiveUsedParts\(parts\) \{\s*setUsedPartsDirty\(true\)/);
  assert.match(lifecycleEffects, /paused: usedPartsDirty \|\| \(/);
  assert.match(formController, /setUsedPartsDirty\(false\);\s*\}/);
});
