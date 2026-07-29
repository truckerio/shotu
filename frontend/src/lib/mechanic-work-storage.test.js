import assert from "node:assert/strict";
import test from "node:test";
import {
  mechanicWorkStorageKey,
  purgeMechanicWorkStorage,
  removeLegacyMechanicWorkStorage,
} from "../features/mechanic/progress/mechanic-work-storage.js";
import {
  clearProgressBackup,
  readProgressBackup,
  writeProgressBackup,
} from "../features/mechanic/progress/progress-storage.js";

function memoryStorage(entries = {}) {
  const values = new Map(Object.entries(entries));
  return {
    get length() {
      return values.size;
    },
    key(index) {
      return [...values.keys()][index] ?? null;
    },
    getItem(key) {
      return values.get(key) ?? null;
    },
    setItem(key, value) {
      values.set(key, String(value));
    },
    removeItem(key) {
      values.delete(key);
    },
    keys() {
      return [...values.keys()];
    },
  };
}

test("mechanic work keys isolate actor and workorder identities", () => {
  assert.equal(
    mechanicWorkStorageKey("progress", "mechanic-a", "workorder-1"),
    "shotu:mechanic-work:progress:mechanic-a:workorder-1",
  );
  assert.notEqual(
    mechanicWorkStorageKey("progress", "mechanic-a", "workorder-1"),
    mechanicWorkStorageKey("progress", "mechanic-b", "workorder-1"),
  );
  assert.notEqual(
    mechanicWorkStorageKey("used-parts", "mechanic-a", "workorder-1"),
    mechanicWorkStorageKey("progress", "mechanic-a", "workorder-1"),
  );
});

test("mechanic work keys require an actor and workorder", () => {
  assert.throws(() => mechanicWorkStorageKey("progress", "", "workorder-1"), /Actor ID is required/);
  assert.throws(() => mechanicWorkStorageKey("progress", "mechanic-a", ""), /Workorder ID is required/);
});

test("legacy cleanup removes unscoped mechanic data only", () => {
  const storage = memoryStorage({
    "shotu:mechanic-progress:workorder-1": "legacy progress",
    "workorder-used-parts:workorder-1": "legacy parts",
    "shotu:mechanic-work:progress:mechanic-a:workorder-1": "scoped",
    "unrelated-preference": "keep",
  });

  assert.equal(removeLegacyMechanicWorkStorage(storage), 2);
  assert.deepEqual(storage.keys().sort(), [
    "shotu:mechanic-work:progress:mechanic-a:workorder-1",
    "unrelated-preference",
  ]);
});

test("session purge removes scoped and legacy mechanic work without touching preferences", () => {
  const storage = memoryStorage({
    "shotu:mechanic-progress:workorder-1": "legacy progress",
    "workorder-used-parts:workorder-1": "legacy parts",
    "shotu:mechanic-work:progress:mechanic-a:workorder-1": "scoped progress",
    "shotu:mechanic-work:used-parts:mechanic-a:workorder-1": "scoped parts",
    "workorder-detail-preview-width": "48",
  });

  assert.equal(purgeMechanicWorkStorage(storage), 4);
  assert.deepEqual(storage.keys(), ["workorder-detail-preview-width"]);
});

test("progress backups cannot cross mechanic identities", () => {
  const storage = memoryStorage({
    "shotu:mechanic-progress:workorder-1": JSON.stringify({
      diagnosis: "legacy diagnosis",
      workPerformed: "legacy work",
    }),
  });
  globalThis.window = { localStorage: storage };
  try {
    writeProgressBackup("mechanic-a", "workorder-1", {
      diagnosis: "actor A diagnosis",
      workPerformed: "actor A work",
    });

    assert.equal(readProgressBackup("mechanic-a", "workorder-1").diagnosis, "actor A diagnosis");
    assert.equal(readProgressBackup("mechanic-b", "workorder-1"), null);
    assert.equal(storage.getItem("shotu:mechanic-progress:workorder-1"), null);

    clearProgressBackup("mechanic-a", "workorder-1");
    assert.equal(readProgressBackup("mechanic-a", "workorder-1"), null);
  } finally {
    delete globalThis.window;
  }
});
