import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const component = readFileSync(new URL("./MessageReceipt.jsx", import.meta.url), "utf8");
const css = readFileSync(new URL("./chat.css", import.meta.url), "utf8");

test("shared receipt renders one sent check and two delivered or read checks", () => {
  assert.match(component, /status === "sent" \? 1 : 2/);
  assert.match(component, /aria-label=\{label\}/);
  assert.match(component, /title=\{label\}/);
});

test("read checks use primary blue while sent and delivered remain gray", () => {
  assert.match(css, /\.message-receipt\s*\{[^}]*color:\s*#667085;/s);
  assert.match(css, /\.message-receipt\.is-read\s*\{[^}]*color:\s*#1570ef;/s);
});
