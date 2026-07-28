import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const css = readFileSync(new URL("./surveillance.css", import.meta.url), "utf8");
const workspace = readFileSync(new URL("./SurveillanceWorkspace.jsx", import.meta.url), "utf8");

test("phone surveillance queues keep tabs and filter trigger on one row", () => {
  const phoneCss = css.slice(css.lastIndexOf("@media (max-width: 700px)"));

  assert.match(workspace, /surveillance-queue-primary-row/);
  assert.match(phoneCss, /\.surveillance-queue-primary-row\s*\{[^}]*display:\s*flex;/s);
  assert.match(phoneCss, /\.mechanic-queue-tabs\s*\{[^}]*flex:\s*1 1 auto;/s);
  assert.match(phoneCss, /\.mobile-queue-tools\s*\{[^}]*display:\s*flex;[^}]*flex:\s*0 0 44px;[^}]*width:\s*44px;/s);
  assert.match(phoneCss, /\.mechanic-queue-tabs button\s*\{[^}]*white-space:\s*nowrap;/s);
});
