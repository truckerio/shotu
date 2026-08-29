import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

test("SurveillanceWorkspace only composes queue and detail owners", () => {
  const entry = source("../SurveillanceWorkspace.jsx");
  assert.match(entry, /useSurveillanceQueue/);
  assert.match(entry, /useSurveillanceDetail/);
  assert.match(entry, /<SurveillanceQueueView/);
  assert.match(entry, /<SurveillanceDetailPage/);
  assert.doesNotMatch(entry, /embedded/);
  assert.doesNotMatch(entry, /api\(|surveillance-odoo-form|WorkorderDetailSurface|MobileQueueToolbar/);
  assert.ok(entry.split("\n").length < 80, "composition owner should stay small");
});

test("queue, detail, and Odoo behavior have focused owners", () => {
  const queueController = source("./useSurveillanceQueue.js");
  const queueView = source("./SurveillanceQueueView.jsx");
  const detailController = source("./useSurveillanceDetail.js");
  const detailPage = source("./SurveillanceDetailPage.jsx");
  const odooPanel = source("../../workorder-modules/odoo/WorkorderOdooPanel.jsx");
  const odooController = source("../../workorder-modules/odoo/useWorkorderOdooModule.js");

  assert.match(queueController, /useWorkorderPreferences\("surveillance"\)/);
  assert.match(queueController, /\/api\/surveillance\/dashboard/);
  assert.match(queueView, /<MobileQueueToolbar/);
  assert.match(queueView, /<ProgressiveQueue/);
  assert.match(detailController, /useWorkorderOdooModule/);
  assert.doesNotMatch(detailController, /odoo-readiness|odoo-preparation|odoo-draft|mark-missing-info/);
  assert.match(odooController, /modules\/odoo/);
  assert.match(odooController, /moduleEndpoint\(workorderId, "readiness"\)/);
  assert.doesNotMatch(odooController, /moduleEndpoint\(workorderId, "preparation"\)/);
  assert.match(odooController, /moduleEndpoint\(workorderId, "draft"\)/);
  assert.match(odooController, /moduleEndpoint\(workorderId, "missing-info"\)/);
  assert.match(detailController, /useWorkorderDetailRealtime/);
  assert.match(detailPage, /<WorkorderDetailSurface/);
  assert.match(detailPage, /<WorkorderDetailModuleHost/);
  assert.match(source("../../workorder-modules/WorkorderDetailModuleHost.jsx"), /WorkorderOdooModule/);
  assert.match(odooPanel, /Create Odoo draft/);
  assert.doesNotMatch(odooPanel, /Labor hours/);
  assert.doesNotMatch(detailPage, /mark-odoo-entered|mark-missing-info/);
});

test("surveillance keeps shared preview and timeline implementations", () => {
  const detailPage = source("./SurveillanceDetailPage.jsx");
  const chatModule = source("../../workorder-modules/chat/WorkorderChatModule.jsx");
  assert.match(detailPage, /<PreviewPane/);
  assert.match(detailPage, /<CompactWorkorderPreview/);
  assert.match(detailPage, /baseDetailSections\.filter\(\(\{ id \}\) => id !== "preview"\)/);
  assert.match(detailPage, /baseDetailSections\.find\(\(section\) => section\.id === moduleId\)/);
  assert.match(detailPage, /renderInDetail: true/);
  assert.match(chatModule, /renderInDetail = isCompact \|\| isMechanicDetail/);
  assert.match(chatModule, /!renderInDetail/);
  assert.match(source("../../workorder-modules/activity/WorkorderActivityModule.jsx"), /<WorkorderTimelinePanel/);
  assert.doesNotMatch(detailPage, /(?:function|const)\s+(PreviewPane|CompactWorkorderPreview|WorkorderTimelinePanel)\b/);
});

test("surveillance keeps shared service history inside the Unit module", () => {
  const detailPage = source("./SurveillanceDetailPage.jsx");
  assert.match(detailPage, /useUnitServiceHistory/);
  assert.match(detailPage, /historyController: unitHistoryController/);
  assert.doesNotMatch(detailPage, /UnitServiceHistorySummary|View history|Hide history/);
});
