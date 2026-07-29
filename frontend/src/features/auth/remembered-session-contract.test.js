import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("password login explicitly remembers the browser session", async () => {
  const source = await readFile(new URL("./LoginPage.jsx", import.meta.url), "utf8");

  assert.equal((source.match(/rememberMe:\s*true/g) || []).length, 2);
  assert.match(source, /signIn\.email/);
  assert.match(source, /signIn\.username/);
});

test("AuthGate applies inactivity only after resolving the role and session mode", async () => {
  const source = await readFile(new URL("./AuthGate.jsx", import.meta.url), "utf8");

  assert.match(source, /shouldEnforceInactivity\(\{/);
  assert.match(source, /role:\s*actor\?\.role/);
  assert.match(source, /sessionMode:\s*actorSession\.sessionMode/);
  assert.match(source, /enabled:\s*inactivityEnabled/);
});
