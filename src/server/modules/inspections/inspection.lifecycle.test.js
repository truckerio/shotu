import test from "node:test";
import assert from "node:assert/strict";
import { canTransitionInspection,deriveInspectionResult } from "./inspection.lifecycle.js";
test("weekly lifecycle is forward-only and completed cannot reopen",()=>{assert.equal(canTransitionInspection("requested","assigned"),true);assert.equal(canTransitionInspection("assigned","in_progress"),true);assert.equal(canTransitionInspection("in_progress","completed"),true);assert.equal(canTransitionInspection("completed","in_progress"),false);});
test("result is server derived from findings",()=>{assert.equal(deriveInspectionResult([]),"passed");assert.equal(deriveInspectionResult([{severity:"attention"}]),"issues_found");assert.equal(deriveInspectionResult([{severity:"out_of_service"}]),"out_of_service");});
