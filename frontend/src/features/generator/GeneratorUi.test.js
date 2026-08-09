import assert from "node:assert/strict";
import test from "node:test";
import { normalizePreviewZoom, PREVIEW_ZOOM_MAX, PREVIEW_ZOOM_MIN } from "./preview-zoom.js";

test("preview zoom normalizes missing and out-of-range values", () => {
  assert.equal(normalizePreviewZoom(undefined), 1);
  assert.equal(normalizePreviewZoom("not-a-number"), 1);
  assert.equal(normalizePreviewZoom(-10), PREVIEW_ZOOM_MIN);
  assert.equal(normalizePreviewZoom(99), PREVIEW_ZOOM_MAX);
  assert.equal(normalizePreviewZoom(1.6), 2);
});
