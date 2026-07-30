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
  assert.match(roleRouter, /\/api\/office\/workorders\/\$\{workorderId\}\/used-parts/);
  assert.match(roleRouter, /body: JSON\.stringify\(\{ parts \}\)/);
  assert.match(roleRouter, /const detail = await api\(`\/api\/office\/workorders\/\$\{result\.workorder\.id\}`\)/);
  assert.match(roleRouter, /savedParts = detail\.workorder\.formData\?\.parts \|\| \[\]/);
  assert.doesNotMatch(roleRouter, /formData:\s*\{\s*\.\.\.\(activeWorkorder\.workorder\.formData \|\| \{\}\),\s*parts,/s);
});

test("detail location and template changes enter the shared autosave queue", () => {
  assert.match(
    roleRouter,
    /function selectOfficeLocation[\s\S]*const locationPatch = \{[\s\S]*locationId: selected\.location\.id[\s\S]*templateFieldsForCreateLocation[\s\S]*stageOfficeWorkorderAutosave\(locationPatch\)/,
  );
});

test("real-time refresh cannot overwrite debounced part edits", () => {
  assert.match(roleRouter, /function updateActiveUsedParts\(parts\) \{\s*setUsedPartsDirty\(true\)/);
  assert.match(roleRouter, /paused: usedPartsDirty \|\| \(/);
  assert.match(roleRouter, /setUsedPartsDirty\(false\);\s*\}/);
});
