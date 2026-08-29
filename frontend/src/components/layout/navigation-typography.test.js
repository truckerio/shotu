import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("shared mobile navigation labels use the 12px navigation token", () => {
  const typography = source("../../typography.css");
  const consumers = [
    source("../../features/admin/admin.css"),
    source("../account/profile-menu.css"),
    source("../operations/mobile-queue-tools.css"),
    source("../workorders/workorder-object-page.css"),
  ];

  assert.match(typography, /--text-navigation:\s*12px;/);
  for (const consumer of consumers) assert.match(consumer, /font-size:\s*var\(--text-navigation\);/);
});
