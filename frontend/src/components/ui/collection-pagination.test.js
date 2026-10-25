import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const read = (path) => readFileSync(new URL(path, import.meta.url), "utf8");
test("collection pagination shares one rail without changing collection data ownership", () => {
  const source = read("./CollectionPagination.jsx");
  assert.match(source, /import \{ CheckpointRail \}/);
  assert.match(source, /showRail = count > 1/);
  assert.match(source, /label=\{label\} disabled=\{loading\}/);
  assert.match(source, /pageSize=\{pageSize\}/);
  assert.match(source, /setPage\(clampPage\(next, count\)\)/);
  assert.match(source, /role="status"/);
  assert.doesNotMatch(source, /fetch\(|useEffect|api\(/);
  assert.match(read("./Pagination.jsx"), /pageItems, pageSize, setPage/);
});
test("shared frame places rail outside clipping results and preserves responsive compact navigation", () => {
  const css = read("./collection-pagination.css");
  assert.match(css, /padding-left: 25px/);
  // Shared CheckpointRail owns count-aware sizing; the frame must not stretch it.
  const railCss = read("./checkpoint-rail.css");
  assert.match(railCss, /height: min\(100%, calc\(var\(--checkpoint-batch-count, 28\) \* 10px\), 280px\)/);
  assert.doesNotMatch(css, /height: min\(100%, 280px\)/);
  assert.match(css, /@media \(max-width: 960px\)/);
  assert.match(css, /position: sticky/);
  assert.match(css, /position: static; width: auto/);
  assert.doesNotMatch(css, /overflow: hidden[^}]*\.checkpoint-rail/);
});
