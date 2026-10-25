import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import {
  checkpointCapacity,
  checkpointRecordRange,
  nextCheckpointPage,
  normalizePageCount,
  selectCheckpointPages,
} from "../ui/checkpoint-rail-model.js";

const component = readFileSync(new URL("../ui/CheckpointRail.jsx", import.meta.url), "utf8");
const styles = readFileSync(new URL("../ui/checkpoint-rail.css", import.meta.url), "utf8");

test("checkpoint grouping respects measured hitboxes and always keeps the current page", () => {
  assert.equal(checkpointCapacity(1000), 40);
  assert.equal(checkpointCapacity(220), 22);
  assert.equal(checkpointCapacity(280), 28);
  assert.deepEqual(selectCheckpointPages(4, 3, 240), [1, 2, 3, 4]);

  const grouped = selectCheckpointPages(100, 47, 240);
  assert.ok(grouped.length <= 24);
  assert.equal(grouped[0], 1);
  assert.equal(grouped.at(-1), 100);
  assert.ok(grouped.includes(47));
  assert.deepEqual(grouped, [...grouped].sort((left, right) => left - right));
});

test("checkpoint ranges clamp partial final batches and derive absent page counts", () => {
  assert.equal(normalizePageCount(undefined, 45, 20), 3);
  assert.deepEqual(checkpointRecordRange(1, 45, 20), { start: 1, end: 20 });
  assert.deepEqual(checkpointRecordRange(3, 45, 20), { start: 41, end: 45 });
  assert.deepEqual(checkpointRecordRange(1, 0, 20), { start: 0, end: 0 });
});

test("roving navigation follows visible checkpoints without wrapping", () => {
  const pages = [1, 20, 47, 70, 100];
  assert.equal(nextCheckpointPage(pages, 47, "ArrowUp"), 20);
  assert.equal(nextCheckpointPage(pages, 47, "ArrowDown"), 70);
  assert.equal(nextCheckpointPage(pages, 1, "ArrowUp"), 1);
  assert.equal(nextCheckpointPage(pages, 70, "Home"), 1);
  assert.equal(nextCheckpointPage(pages, 20, "End"), 100);
});

test("rail source keeps previews local and exposes keyboard and responsive exact selection contracts", () => {
  assert.match(component, /import \{ Dropdown \} from "\.\.\/forms\/Dropdown\.jsx"/);
  assert.match(component, /new ResizeObserver\(measure\)/);
  assert.match(component, /\}, \[count > 0\]\);/);
  assert.match(component, /\["ArrowUp", "ArrowDown", "Home", "End"\]/);
  assert.match(component, /\["Enter", " "\]/);
  assert.match(component, /aria-current=\{active \? "page" : undefined\}/);
  assert.match(component, /tabIndex=\{page === rovingPage \? 0 : -1\}/);
  assert.match(component, /count <= MAX_DROPDOWN_BATCHES/);
  assert.match(component, /popoverClassName="checkpoint-rail-dropdown-popover"/);
  assert.match(component, /Choose batch, current batch/);
  assert.match(component, /aria-label=\{`\$\{label\}: \$\{checkpointAriaLabel/);
  assert.match(component, /type="number"/);
  assert.doesNotMatch(component, /fetch\(|axios|XMLHttpRequest|useQuery/);
  assert.match(styles, /flex:\s*0 0 25px/);
  assert.match(styles, /padding-inline:\s*0.5px/);
  assert.match(styles, /align-self:\s*center/);
  assert.match(component, /"--checkpoint-batch-count": count/);
  assert.match(styles, /height:\s*min\(100%, calc\(var\(--checkpoint-batch-count, 28\) \* 10px\), 280px\)/);
  assert.match(styles, /grid-auto-rows:\s*10px/);
  assert.match(styles, /min-height:\s*10px/);
  assert.match(styles, /\.checkpoint-rail-tick\s*\{[^}]*box-sizing:\s*border-box;[^}]*justify-content:\s*flex-start;[^}]*padding:\s*0 0 0 6px;/);
  assert.match(styles, /\.checkpoint-rail-mark\s*\{[\s\S]*?background:\s*#8492a6;[\s\S]*?border-radius:\s*50%;[\s\S]*?height:\s*2px;[\s\S]*?width:\s*2px;/);
  assert.match(styles, /:focus-visible \.checkpoint-rail-mark\s*\{[\s\S]*?border-radius:\s*999px;[\s\S]*?height:\s*2px;[\s\S]*?width:\s*6px;/);
  assert.match(styles, /\[aria-current="page"\] \.checkpoint-rail-mark\s*\{[\s\S]*?background:\s*#1570ef;[\s\S]*?border-radius:\s*999px;[\s\S]*?height:\s*2.5px;[\s\S]*?width:\s*9px;/);
  assert.match(styles, /\.checkpoint-rail-preview\s*\{[\s\S]*?background:\s*#fff;[\s\S]*?position:\s*fixed;[\s\S]*?width:\s*260px;/);
  assert.match(styles, /\.checkpoint-rail-compact\s*\{[\s\S]*?display:\s*none;/);
  assert.match(styles, /@media \(max-width: 960px\)[\s\S]*?\.checkpoint-rail-compact\s*\{[\s\S]*?display:\s*block;/);
  assert.match(styles, /@media \(max-width: 960px\)/);
  assert.match(styles, /position:\s*absolute/);
  assert.match(styles, /@media \(prefers-reduced-motion: reduce\)/);
});
