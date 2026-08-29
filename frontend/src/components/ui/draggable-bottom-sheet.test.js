import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

async function loadExportedSnapHelper() {
  const source = await readFile(new URL("./DraggableBottomSheet.jsx", import.meta.url), "utf8");
  const start = source.indexOf("export function getBottomSheetSnap");
  const bodyStart = source.indexOf("{", source.indexOf(") {", start));
  let depth = 0;
  let end = bodyStart;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}" && depth && --depth === 0) break;
  }
  const helper = source.slice(start, end + 1).replace("export function", "function");
  return Function("DRAG_THRESHOLD", "VELOCITY_THRESHOLD", "SNAP_PEEK", "SNAP_EXPANDED", `${helper}; return getBottomSheetSnap;`)(32, .42, "peek", "expanded");
}

async function loadExportedTransitionHelper() {
  const source = await readFile(new URL("./DraggableBottomSheet.jsx", import.meta.url), "utf8");
  const start = source.indexOf("export function hasTransformTransition");
  const bodyStart = source.indexOf("{", source.indexOf(") {", start));
  let depth = 0;
  let end = bodyStart;
  for (; end < source.length; end += 1) {
    if (source[end] === "{") depth += 1;
    if (source[end] === "}" && depth && --depth === 0) break;
  }
  const helper = source.slice(start, end + 1).replace("export function", "function");
  return Function(`${helper}; return hasTransformTransition;`)();
}

test("bottom-sheet snap decision honors velocity before distance", async () => {
  const getBottomSheetSnap = await loadExportedSnapHelper();
  assert.equal(getBottomSheetSnap({ startSnap: "expanded", velocityY: .5 }), "peek");
  assert.equal(getBottomSheetSnap({ startSnap: "peek", velocityY: -.5 }), "expanded");
  assert.equal(getBottomSheetSnap({ startSnap: "expanded", deltaY: 40 }), "peek");
  assert.equal(getBottomSheetSnap({ startSnap: "peek", deltaY: -40 }), "expanded");
  assert.equal(getBottomSheetSnap({ startSnap: "peek", deltaY: 8 }), "peek");
});

test("bottom-sheet detects only nonzero transform transitions", async () => {
  const hasTransformTransition = await loadExportedTransitionHelper();
  assert.equal(hasTransformTransition({ transitionProperty: "transform", transitionDuration: "320ms" }), true);
  assert.equal(hasTransformTransition({ transitionProperty: "opacity", transitionDuration: "320ms" }), false);
  assert.equal(hasTransformTransition({ transitionProperty: "all", transitionDuration: "0s" }), false);
});

test("bottom-sheet keeps pointer and keyboard interaction accessible", async () => {
  const [source, css] = await Promise.all([
    readFile(new URL("./DraggableBottomSheet.jsx", import.meta.url), "utf8"),
    readFile(new URL("./draggable-bottom-sheet.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /setPointerCapture/);
  assert.match(source, /onPointerCancel/);
  assert.match(source, /rect\.bottom - window\.innerHeight/);
  assert.match(source, /peekOffset,/);
  assert.match(source, /Math\.min\(drag\.peekOffset,/);
  assert.match(source, /inert=\{snap === SNAP_PEEK \? "" : undefined\}/);
  assert.match(source, /handleRef\.current\?\.focus\(\)/);
  assert.match(source, /disabled = false/);
  assert.match(source, /disabled=\{disabled\}/);
  assert.match(source, /if \(disabled\) return;/);
  assert.match(source, /onSnapSettled/);
  assert.match(source, /onTransitionEnd=\{onTransitionEnd\}/);
  assert.match(source, /event\.target !== sheetRef\.current \|\| event\.propertyName !== "transform"/);
  assert.match(source, /requestAnimationFrame/);
  assert.match(source, /minimizeLabel = "Minimize details"/);
  assert.match(source, /expandLabel = "Expand details"/);
  assert.match(source, /role="dialog"/);
  assert.match(source, /aria-modal="false"/);
  assert.match(source, /ArrowUp/);
  assert.match(source, /ArrowDown/);
  assert.match(css, /height: 44px/);
  assert.match(css, /env\(safe-area-inset-bottom\)/);
  assert.match(css, /max\(16px, env\(safe-area-inset-left\)\)/);
  assert.match(css, /max\(16px, env\(safe-area-inset-right\)\)/);
  assert.match(css, /prefers-reduced-motion/);
  assert.match(css, /\.draggable-bottom-sheet-handle:disabled/);
  assert.match(css, /\.draggable-bottom-sheet\.is-peek \.draggable-bottom-sheet-content/);
  assert.match(css, /\.draggable-bottom-sheet\.is-peek \.draggable-bottom-sheet-footer/);
  assert.match(css, /\.draggable-bottom-sheet\.is-peek \{[\s\S]*pointer-events: none/);
  assert.match(css, /\.draggable-bottom-sheet\.is-peek \.draggable-bottom-sheet-handle \{[\s\S]*pointer-events: auto/);
  assert.match(css, /\.draggable-bottom-sheet\.is-expanded \.draggable-bottom-sheet-content/);
  assert.match(css, /pointer-events: none/);
  assert.match(css, /pointer-events: auto/);
});
