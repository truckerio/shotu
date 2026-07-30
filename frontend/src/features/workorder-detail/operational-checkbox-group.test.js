import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("return dialog uses shared checkbox rows instead of custom pills", async () => {
  const page = await readFile(new URL("./WorkorderDetailPage.jsx", import.meta.url), "utf8");
  const component = await readFile(new URL("../../components/forms/OperationalCheckboxGroup.jsx", import.meta.url), "utf8");
  const sharedCss = await readFile(new URL("../../components/forms/operational-form.css", import.meta.url), "utf8");
  const appCss = await readFile(new URL("../../styles.css", import.meta.url), "utf8");

  assert.match(page, /<OperationalCheckboxGroup/);
  assert.match(component, /operational-checkbox-option/);
  assert.match(sharedCss, /\.operational-checkbox-options[\s\S]*border-radius:\s*6px/);
  assert.doesNotMatch(sharedCss, /\.operational-checkbox-option[\s\S]*border-radius:\s*999px/);
  assert.doesNotMatch(appCss, /office-return-categories/);
});
