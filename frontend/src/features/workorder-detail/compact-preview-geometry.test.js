import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { compactPreviewDocumentScale } from "../../components/workorders/compact-preview-geometry.js";

const css = readFileSync(
  new URL("../../components/workorders/workorder-object-page.css", import.meta.url),
  "utf8",
);

test("compact Preview document has non-zero geometry at supported phone widths", () => {
  for (const viewportWidth of [390, 430]) {
    const shellWidth = viewportWidth - 48;
    const scale = compactPreviewDocumentScale(shellWidth);
    const articleWidth = 1056 * scale;
    const articleHeight = 816 * scale;

    assert.ok(scale > 0);
    assert.ok(articleWidth > 0);
    assert.ok(articleHeight > 0);
    assert.equal(articleWidth, shellWidth);
  }
});

test("compact Preview applies measured numeric scale instead of relying on container units", () => {
  assert.match(
    css,
    /\.workorder-compact-preview\s+\.workorder-preview-shell\s*>\s*div\s*\{[^}]*transform:\s*scale\(var\(--workorder-preview-scale,\s*1\)\);/s,
  );
});
