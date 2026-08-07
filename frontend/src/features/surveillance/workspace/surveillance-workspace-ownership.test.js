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
  assert.doesNotMatch(entry, /api\(|surveillance-odoo-form|WorkorderDetailSurface|MobileQueueToolbar/);
  assert.ok(entry.split("\n").length < 80, "composition owner should stay small");
});

test("queue, detail, and Odoo behavior have focused owners", () => {
  const queueController = source("./useSurveillanceQueue.js");
  const queueView = source("./SurveillanceQueueView.jsx");
  const detailController = source("./useSurveillanceDetail.js");
  const detailPage = source("./SurveillanceDetailPage.jsx");
  const odooPanel = source("./SurveillanceOdooPanel.jsx");

  assert.match(queueController, /useWorkorderPreferences\("surveillance"\)/);
  assert.match(queueController, /\/api\/surveillance\/dashboard/);
  assert.match(queueView, /<MobileQueueToolbar/);
  assert.match(queueView, /<ProgressiveQueue/);
  assert.match(detailController, /odoo-readiness/);
  assert.match(detailController, /odoo-preparation/);
  assert.match(detailController, /odoo-draft/);
  assert.match(detailController, /mark-missing-info/);
  assert.match(detailController, /useWorkorderDetailRealtime/);
  assert.match(detailPage, /<WorkorderDetailSurface/);
  assert.match(detailPage, /<SurveillanceOdooPanel/);
  assert.match(odooPanel, /Create Odoo draft/);
  assert.match(odooPanel, /Labor hours/);
  assert.doesNotMatch(detailPage, /mark-odoo-entered|mark-missing-info/);
});

test("surveillance keeps shared preview and timeline implementations", () => {
  const detailPage = source("./SurveillanceDetailPage.jsx");
  assert.match(detailPage, /<PreviewPane/);
  assert.match(detailPage, /<CompactWorkorderPreview/);
  assert.match(detailPage, /<WorkorderTimelinePanel/);
  assert.doesNotMatch(detailPage, /(?:function|const)\s+(PreviewPane|CompactWorkorderPreview|WorkorderTimelinePanel)\b/);
});
