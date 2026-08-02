import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./part-requests-panel.css", import.meta.url), "utf8");

test("office part quantity and unit receive a track wide enough for the shared control", () => {
  assert.match(
    css,
    /\.office-part-request-card \.part-office-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) minmax\(144px, 180px\);[^}]*min-width:\s*0;/s,
  );
  assert.match(
    css,
    /\.office-part-request-card \.part-office-fields > \.quantity-unit-input\s*\{[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("office part fields collapse from split-pane width instead of viewport width", () => {
  assert.match(
    css,
    /@container workorder-control \(max-width: 620px\)[\s\S]*\.office-part-request-card \.part-office-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
});

test("fitment uses a compact track and collapses with its container", () => {
  assert.match(
    css,
    /\.office-part-request-card \.part-fitment-fields\s*\{[^}]*grid-template-columns:\s*minmax\(180px, 220px\) minmax\(0, 1fr\);/s,
  );
  assert.match(
    css,
    /@container workorder-control \(max-width: 620px\)[\s\S]*\.office-part-request-card \.part-fitment-fields\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\);/,
  );
});
