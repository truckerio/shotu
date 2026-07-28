import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./surveillance.css", import.meta.url), "utf8");

test("phone surveillance queues keep tabs and filter trigger on one row", () => {
  const phoneCss = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(phoneCss, /grid-template-columns:\s*minmax\(0,\s*1fr\) 44px;/);
  assert.match(phoneCss, /\.mechanic-queue-tabs\s*\{[^}]*grid-column:\s*1;/s);
  assert.match(phoneCss, /\.mobile-queue-tools\s*\{[^}]*flex:\s*0 0 44px;[^}]*grid-column:\s*2;[^}]*width:\s*44px;/s);
  assert.match(phoneCss, /\.mechanic-queue-tabs button\s*\{[^}]*white-space:\s*nowrap;/s);
});
