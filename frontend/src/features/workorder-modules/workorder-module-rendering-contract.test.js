import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("../workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
const createPage = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const diagnosisRepairModule = readFileSync(new URL("./diagnosis-repair/WorkorderDiagnosisRepairModule.jsx", import.meta.url), "utf8");

test("operational detail no longer mounts the legacy paper preview", () => {
  assert.doesNotMatch(detailPage, /<WorkorderPreview|<CompactWorkorderPreview|<PreviewFullscreen/);
  assert.doesNotMatch(detailPage, /renderedDetailSection === "preview"/);
  assert.match(detailPage, /id: "customer-documents"/);
  assert.match(detailPage, /detailStatus === "mechanic_done" \? "Review invoice" : "View estimate"/);
  assert.match(detailPage, /id: "archive"/);
});

test("read-only Chat has no composer and visible Photos enable chat attachments", () => {
  assert.match(detailPage, /chatPolicy\.canWrite && activeWorkorder\.allowedActions\?\.sendMessage/);
  assert.match(detailPage, /allowAttachments=\{photosPolicy\.canRead\}/);
  assert.match(detailPage, /attachment: null, attachments: \[\]/);
});

test("office lifecycle controls require module write and Work done trusts the filtered server action", () => {
  assert.match(detailPage, /completionPolicy\.canWrite && activeWorkorder\.allowedActions\?\.approve/);
  assert.match(detailPage, /completionPolicy\.canWrite && mechanicFinish\.open/);
  assert.match(detailPage, /canMarkWorkDone = \(isMechanicDetail \|\| isOfficeDetail\) && activeWorkorder\.allowedActions\?\.markDone === true/);
  assert.match(diagnosisRepairModule, /writable\(access\) && Boolean\(allowedActions\.saveNotes\)/);
});

test("Create no longer mounts the legacy printable or fullscreen Preview surfaces", () => {
  assert.doesNotMatch(createPage, /BrowserPrintDocument|PreviewFullscreen|PreviewPane|CompactWorkorderPreview|WorkorderPreview|PrintModal/);
  assert.match(createPage, /<DocumentsPanel/);
});
