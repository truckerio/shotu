import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queueCss = await readFile(new URL("./workorder-queue.css", import.meta.url), "utf8");
const mechanicCss = await readFile(new URL("../../features/mechanic/mechanic-workspace.css", import.meta.url), "utf8");

test("non-queue destinations do not invent zero workorder counts", async () => {
  const component = await readFile(new URL("./WorkorderQueue.jsx", import.meta.url), "utf8");
  assert.match(component, /aria-label=\{count == null \? label/);
  assert.match(component, /count != null \? <strong/);
});

test("mechanic page header keeps one composition step above the queue", () => {
  assert.match(mechanicCss, /\.mechanic-home-content:has\(>\s*\.mechanic-queue-shell\)\s*\{[^}]*display:\s*grid;[^}]*gap:\s*16px;/s);
  assert.match(mechanicCss, /\.mechanic-home-content\s*>\s*\.page-header\s*\{[^}]*margin-top:\s*0;/s);
});

test("desktop mechanic queues reserve a separate action track", () => {
  const desktop = queueCss.slice(queueCss.indexOf("@media (min-width: 1181px)"), queueCss.indexOf("@media (min-width: 1800px)"));

  assert.match(desktop, /--mechanic-row-action-gap:\s*16px/);
  assert.match(desktop, /--mechanic-row-action-width:\s*144px/);
  assert.match(desktop, /\.mechanic-assigned-list:has\(\.queue-row-mechanic\s*>\s*\.accept-work-button\)\s+\.mechanic-work-row\.queue-row-mechanic/);
  assert.match(desktop, /grid-template-columns:\s*minmax\(0,\s*1fr\)\s+var\(--mechanic-row-action-width\)/);
  assert.match(desktop, /\.queue-row-mechanic\s*>\s*\.accept-work-button\s*\{[^}]*margin-right:\s*0;[^}]*width:\s*var\(--mechanic-row-action-width\)/s);
  assert.match(desktop, /\.mechanic-work-open\.queue-variant-mechanic\s+\.ops-status\s*\{[^}]*justify-self:\s*start;[^}]*max-width:\s*100%;[^}]*overflow:\s*hidden;/s);
});

test("tablet and phone keep stacked mechanic actions", () => {
  assert.match(queueCss, /@media \(min-width:\s*701px\) and \(max-width:\s*1180px\)[\s\S]*\.queue-row-mechanic:has\(\.accept-work-button\)\s*\{[^}]*display:\s*grid;/);
  assert.match(queueCss, /@media \(max-width:\s*700px\)[\s\S]*\.accept-work-button\s*\{[^}]*justify-self:\s*stretch;[^}]*min-height:\s*44px;/);
});
