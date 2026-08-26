import assert from "node:assert/strict";
import test from "node:test";
import {
  changeDocumentZoom,
  clampDocumentZoom,
  documentZoomLabel,
  documentRotationTransform,
  nextDocumentRotation,
} from "./invoice-document-viewer-model.js";

test("document zoom remains bounded and uses readable quarter steps", () => {
  assert.equal(clampDocumentZoom(0), 0.5);
  assert.equal(clampDocumentZoom(8), 2);
  assert.equal(clampDocumentZoom("bad"), 1);
  assert.equal(changeDocumentZoom(1, "in"), 1.25);
  assert.equal(changeDocumentZoom(0.5, "out"), 0.5);
  assert.equal(documentZoomLabel(1.25), "125%");
});

test("document rotation advances clockwise and normalizes invalid state", () => {
  assert.equal(nextDocumentRotation(0), 90);
  assert.equal(nextDocumentRotation(270), 0);
  assert.equal(nextDocumentRotation("bad"), 90);
  assert.equal(documentRotationTransform(0), "rotate(0deg)");
  assert.equal(documentRotationTransform(90), "rotate(90deg) translateY(-100%)");
  assert.equal(documentRotationTransform(180), "rotate(180deg) translate(-100%, -100%)");
  assert.equal(documentRotationTransform(270), "rotate(270deg) translateX(-100%)");
});
