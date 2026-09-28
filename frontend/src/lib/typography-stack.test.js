import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { workorderTemplateStyles } from "../../../shared/workorder-template.js";

test("application headings use the shared semantic scale and native sans-serif stack", async () => {
  const [typographyStyles, inventoryLocationStyles] = await Promise.all([
    readFile(new URL("../typography.css", import.meta.url), "utf8"),
    readFile(new URL("../features/inventory/inventory-locations-workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(typographyStyles, /--font-sans:\s*system-ui,/);
  assert.match(typographyStyles, /--font-mono:\s*ui-monospace,/);
  assert.match(typographyStyles, /--text-h1:\s*24px;/);
  assert.match(typographyStyles, /--text-h2:\s*20px;/);
  assert.match(typographyStyles, /--text-h3:\s*18px;/);
  assert.match(typographyStyles, /--text-h4:\s*16px;/);
  assert.match(typographyStyles, /--text-h5:\s*14px;/);
  assert.match(typographyStyles, /--text-h6:\s*12px;/);
  assert.match(typographyStyles, /--space-1:\s*4px;/);
  assert.match(typographyStyles, /--space-2:\s*8px;/);
  assert.match(typographyStyles, /--space-3:\s*12px;/);
  assert.match(typographyStyles, /--space-4:\s*16px;/);
  assert.match(typographyStyles, /--space-6:\s*24px;/);
  assert.match(typographyStyles, /--space-8:\s*32px;/);
  for (let level = 1; level <= 6; level += 1) {
    assert.match(typographyStyles, new RegExp(`h${level} \\{ font-size: var\\(--text-h${level}\\) !important; \\}`));
  }
  assert.match(workorderTemplateStyles, /font-family:\s*system-ui,/);
  assert.doesNotMatch(typographyStyles, /SF Pro/);
  assert.match(typographyStyles, /code,\s*kbd,\s*samp,\s*pre\s*\{\s*font-family:\s*var\(--font-mono\);/s);
  assert.doesNotMatch(typographyStyles, /textarea,\s*code,\s*kbd,\s*samp,\s*pre\s*\{\s*font-family:\s*var\(--font-sans\);/s);
  assert.doesNotMatch(workorderTemplateStyles, /SF Pro/);
  assert.doesNotMatch(inventoryLocationStyles, /font-family:\s*(?:ui-)?monospace/);
});
