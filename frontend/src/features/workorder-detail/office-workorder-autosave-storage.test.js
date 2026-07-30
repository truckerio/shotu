import assert from "node:assert/strict";
import test from "node:test";
import {
  clearOfficeWorkorderEditBackup,
  officeWorkorderEditStorageKey,
  readOfficeWorkorderEditBackup,
  writeOfficeWorkorderEditBackup,
} from "./office-workorder-autosave-storage.js";

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
