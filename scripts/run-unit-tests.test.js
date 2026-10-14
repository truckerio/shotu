import assert from "node:assert/strict";
import { mkdtemp, mkdir, writeFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverUnitTests, UNIT_TEST_DIRECTORIES } from "./run-unit-tests.js";

test("unit discovery includes new nested owners and excludes executable integration runners", async () => {
  const root = await mkdtemp(join(tmpdir(), "unit-discovery-"));
  try {
    await mkdir(join(root, "features", "new", "nested"), { recursive: true });
    for (const name of ["a.test.js", "workflow.integration.js", "readme.md", "component.jsx"]) {
      await writeFile(join(root, "features", name), "");
    }
    await writeFile(join(root, "features", "new", "nested", "b.test.js"), "");
    assert.deepEqual(await discoverUnitTests(root, ["features"]), ["features/a.test.js", "features/new/nested/b.test.js"]);
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});

test("canonical discovery covers frontend, shared contracts, tooling, and all server owners", () => {
  assert.deepEqual(UNIT_TEST_DIRECTORIES, ["frontend/src", "shared", "scripts", "src/server"]);
});
