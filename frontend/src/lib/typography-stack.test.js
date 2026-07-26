import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workorderTemplateStyles } from "../../../shared/workorder-template.js";

test("application and workorder print use the native cross-platform font stack", async () => {
  const typographyStyles = await readFile(new URL("../typography.css", import.meta.url), "utf8");

  assert.match(typographyStyles, /--font-sans:\s*system-ui,/);
  assert.match(workorderTemplateStyles, /font-family:\s*system-ui,/);
  assert.doesNotMatch(typographyStyles, /SF Pro/);
  assert.doesNotMatch(workorderTemplateStyles, /SF Pro/);
});
