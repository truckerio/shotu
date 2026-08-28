import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { isPlainPrimaryActivation } from "./context-navigation.js";

test("context breadcrumbs expose a calm accessible parent path", async () => {
  const [component, styles] = await Promise.all([
    readFile(new URL("./ContextBreadcrumbs.jsx", import.meta.url), "utf8"),
    readFile(new URL("./context-breadcrumbs.css", import.meta.url), "utf8"),
  ]);

  assert.match(component, /<nav className="context-breadcrumbs" aria-label="Breadcrumb">/);
  assert.match(component, /<a href=\{item\.href\} onClick=\{item\.onClick\}>/);
  assert.match(component, /aria-current="page"/);
  assert.match(component, /aria-hidden="true"/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /:focus-visible/);
  assert.match(styles, /text-overflow: ellipsis/);
});

test("context links preserve native modified-click behavior", () => {
  assert.equal(isPlainPrimaryActivation({ button: 0 }), true);
  assert.equal(isPlainPrimaryActivation({ button: 0, metaKey: true }), false);
  assert.equal(isPlainPrimaryActivation({ button: 0, ctrlKey: true }), false);
  assert.equal(isPlainPrimaryActivation({ button: 0, shiftKey: true }), false);
  assert.equal(isPlainPrimaryActivation({ button: 0, altKey: true }), false);
  assert.equal(isPlainPrimaryActivation({ button: 1 }), false);
});
