import test from "node:test";
import assert from "node:assert/strict";

import {
  isPrimarySectionPointer,
  shouldHandleSectionClick,
} from "../../components/workorders/workorder-section-navigation.js";

test("primary mouse and touch pointers activate a workorder section immediately", () => {
  assert.equal(isPrimarySectionPointer({ button: 0, isPrimary: true }), true);
  assert.equal(isPrimarySectionPointer({ button: 0, isPrimary: true, pointerType: "touch" }), true);
});

test("secondary and non-primary pointers do not activate a workorder section", () => {
  assert.equal(isPrimarySectionPointer({ button: 2, isPrimary: true }), false);
  assert.equal(isPrimarySectionPointer({ button: 0, isPrimary: false }), false);
});

test("click remains a fallback without duplicating an already handled pointer selection", () => {
  assert.equal(shouldHandleSectionClick({ handledPointerSection: "", sectionId: "parts" }), true);
  assert.equal(shouldHandleSectionClick({ handledPointerSection: "work", sectionId: "parts" }), true);
  assert.equal(shouldHandleSectionClick({ handledPointerSection: "parts", sectionId: "parts" }), false);
});
