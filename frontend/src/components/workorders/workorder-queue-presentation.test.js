import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const queueUrl = new URL("./WorkorderQueue.jsx", import.meta.url);

test("shared queue delegates lifecycle and visible dates to the presentation registry", async () => {
  const source = await readFile(queueUrl, "utf8");

  assert.match(source, /from "\.\.\/\.\.\/lib\/workorder-presentation\.js"/);
  assert.match(source, /formatLifecycleLabel\(lifecycle, \{/);
  assert.match(source, /openAsUnassigned: available/);
  assert.match(source, /formatUiDateTime\(lastActivity\)/);
  assert.match(source, /formatUiDateTime\(workorder\.createdAt\)/);
  assert.doesNotMatch(source, /const LIFECYCLE_LABELS/);
  assert.doesNotMatch(source, /Ready for review|Odoo entered/);
});

test("queue search keeps ISO discoverability without exposing ISO as its UI formatter", async () => {
  const source = await readFile(queueUrl, "utf8");

  assert.match(source, /createdDate\.toISOString\(\)\.slice\(0, 10\)/);
  assert.match(source, /formatUiDate\(workorder\.createdAt\)/);
  assert.match(source, /formatUiDateTime\(workorder\.createdAt\)/);
  assert.doesNotMatch(source, /toLocaleDateString\(\)/);
});
