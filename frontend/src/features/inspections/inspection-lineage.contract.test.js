import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
const detail=readFileSync(new URL("./InspectionDetail.jsx",import.meta.url),"utf8");const experience=readFileSync(new URL("./InspectionExperience.jsx",import.meta.url),"utf8");
test("lineage keeps correction distinct, creates reinspection without bypassing start evidence, and retains retry identity",()=>{assert.match(detail,/\{onCorrect\?<Button/);assert.match(detail,/correctedResponseChanges/);assert.match(detail,/responsePayload\(itemKey,value\)/);assert.match(detail,/Correct checklist answers/);assert.match(detail,/responses:correctedResponseChanges/);assert.match(detail,/mechanicReinspect\?<p>Assignee: Myself/);assert.match(detail,/mechanicUserIds:mechanicReinspect\?\[actor.id\]/);assert.match(detail,/startImmediately:false/);assert.match(detail,/>Create reinspection<\/Button>/);assert.match(detail,/setLineageReason\(""\)/);assert.match(detail,/role="alert"/);assert.match(detail,/lineageBusy/);assert.match(detail,/predecessorInspectionId/);assert.match(experience,/lineageKeys/);assert.match(experience,/if\(!lineageKeys\.current\.has\(identity\)\)/);});
test("successful lineage creation updates the reloadable route to the returned inspection",()=>{
  assert.match(experience,/setActive\(next\);replaceRouteSearch\(inspectionWorkspaceSearch\(actor\.role,next\.id\)\)/);
});
