import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
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
      concern: "Office request; mechanic found leak",
      diagnosis: "actor A diagnosis",
      workPerformed: "actor A work",
    }, 3);

    assert.equal(readProgressBackup("mechanic-a", "workorder-1").concern, "Office request; mechanic found leak");
    assert.equal(readProgressBackup("mechanic-a", "workorder-1").diagnosis, "actor A diagnosis");
    assert.equal(readProgressBackup("mechanic-a", "workorder-1").expectedVersion, 3);
    assert.equal(readProgressBackup("mechanic-b", "workorder-1"), null);
    assert.equal(storage.getItem("shotu:mechanic-progress:workorder-1"), null);

    clearProgressBackup("mechanic-a", "workorder-1");
    assert.equal(readProgressBackup("mechanic-a", "workorder-1"), null);
  } finally {
    delete globalThis.window;
  }
});

test("normal router unmount preserves recovery data while explicit session exits purge it", () => {
  const lifecycle = readFileSync(
    new URL("../app/routes/useRoleRouterLifecycleEffects.js", import.meta.url),
    "utf8",
  );
  const profile = readFileSync(new URL("../components/account/ProfileMenu.jsx", import.meta.url), "utf8");
  const authGate = readFileSync(new URL("../features/auth/AuthGate.jsx", import.meta.url), "utf8");
  const kiosk = readFileSync(new URL("../features/kiosk/KioskSessionContext.jsx", import.meta.url), "utf8");

  assert.doesNotMatch(lifecycle, /purgeMechanicWorkStorage/);
  assert.match(profile, /authClient\.signOut\(\)[\s\S]*purgeMechanicWorkStorage\(\)/);
  assert.match(authGate, /authClient\.signOut\(\)[\s\S]*purgeMechanicWorkStorage\(\)/);
  assert.match(kiosk, /authClient\.signOut\(\)[\s\S]*purgeMechanicWorkStorage\(\)/);
});

test("concern backup recovery respects current field permissions and old backups", async () => {
  const { mechanicProgressRecoveryPatch } = await import("../features/mechanic/progress/progress-storage.js");
  const backup = { expectedVersion: 3, concern: "Inspected; found leak", diagnosis: "Old diagnosis", workPerformed: "Old repair", laborHours: "2" };
  assert.deepEqual(mechanicProgressRecoveryPatch(backup, { saveConcern: true }, 3), { mechanicConcern: "Inspected; found leak" });
  assert.deepEqual(mechanicProgressRecoveryPatch(backup, {}), {});
  assert.equal(Object.hasOwn(mechanicProgressRecoveryPatch({ ...backup, concern: null }, { saveConcern: true }, 3), "mechanicConcern"), false);
  assert.deepEqual(mechanicProgressRecoveryPatch({ ...backup, concern: "" }, { saveConcern: true }, 3), { mechanicConcern: "" });
});

test("older concern backups cannot overwrite a newer office concern after reload", async () => {
  const { mechanicProgressRecoveryConflict, mechanicProgressRecoveryPatch } = await import("../features/mechanic/progress/progress-storage.js");
  const backup = { concern: "Old mechanic offline draft", expectedVersion: 3, diagnosis: "Old", workPerformed: "Old", laborHours: "1" };
  assert.equal(mechanicProgressRecoveryConflict(backup, 4), true);
  assert.deepEqual(mechanicProgressRecoveryPatch(backup, { saveConcern: true, saveNotes: true }, 4), {});
  assert.equal(mechanicProgressRecoveryConflict({ ...backup, expectedVersion: null }, 4), true);
  assert.equal(mechanicProgressRecoveryConflict({ concern: null, expectedVersion: null }, 4), false);
});
