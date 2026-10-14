import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

test("sticky draft headers fade into rows without intercepting input", () => {
  const css = readFileSync(new URL("./operations-page.css", import.meta.url), "utf8");
  assert.match(css, /\.admin-operations-content \.workorder-drafts-table-head::after\s*\{[^}]*linear-gradient\(to bottom, rgb\(249 250 251 \/ 70%\), rgb\(249 250 251 \/ 25%\) 40%,[^}]*height: 16px;[^}]*inset: 100% 0 auto;[^}]*pointer-events: none;[^}]*position: absolute;/);
  assert.match(css, /position: sticky;\s*top: 0;\s*z-index: 2;/);
  assert.doesNotMatch(css, /workorder-drafts-table-head, \.operational-collection-table-head/);
});

test("Operations table scroll surfaces round all corners with the shared radius", () => {
  const css = readFileSync(new URL("./operations-page.css", import.meta.url), "utf8");
  assert.match(css, /@media \(min-width: 701px\)\s*\{\s*\.admin-operations-content :is\(\.operations-table, \.part-request-queue-table, \.workorder-drafts-results\)\s*\{\s*border-radius: var\(--workspace-card-radius\);/);
});

test("Operations rows have no scroll-linked curl or opacity animation", () => {
  const css = readFileSync(new URL("./operations-page.css", import.meta.url), "utf8");
  assert.doesNotMatch(css, /operations-row-roll-away|animation-timeline|rotateX/);
});
