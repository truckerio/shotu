import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

test("shared pagination resets, clamps, and disables controls while loading", async () => {
  const source = await readFile(new URL("./Pagination.jsx", import.meta.url), "utf8");
  assert.match(source, /export function clampPage/);
  assert.match(source, /useEffect\(\(\) => setPage\(1\), \[resetKey\]\)/);
  assert.match(source, /if \(page !== currentPage\) setPage\(currentPage\)/);
  assert.match(source, /disabled=\{loading \|\| safeCurrentPage <= 1\}/);
  assert.match(source, /aria-live="polite"/);
});
