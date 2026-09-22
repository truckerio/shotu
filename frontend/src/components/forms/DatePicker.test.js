import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import test from "node:test";

const frontendUrl = new URL("../../", import.meta.url);

test("runtime JSX uses the shared DatePicker instead of native date inputs", async () => {
  const entries = await readdir(frontendUrl, { recursive: true, withFileTypes: true });
  const offenders = [];

  for (const entry of entries) {
    if (!entry.isFile() || !entry.name.endsWith(".jsx") || entry.name.endsWith(".test.jsx")) continue;
    const filePath = `${entry.parentPath}/${entry.name}`;
    const source = await readFile(filePath, "utf8");
    if (/type="date"|type='date'/.test(source)) offenders.push(filePath);
  }

  assert.deepEqual(offenders, []);
});
