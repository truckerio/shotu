import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const detailPage = readFileSync(new URL("../workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
const createPage = readFileSync(new URL("../create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
const diagnosisRepairModule = readFileSync(new URL("./diagnosis-repair/WorkorderDiagnosisRepairModule.jsx", import.meta.url), "utf8");

test("hidden Preview does not mount printable or fullscreen detail data", () => {
  assert.match(detailPage, /previewPolicy\.canRead \? <BrowserPrintDocument/);
  assert.match(detailPage, /previewPolicy\.canRead \? <PreviewFullscreen/);
  assert.match(detailPage, /renderedDetailSection === "preview" && previewPolicy\.canRead/);
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

test("hidden Create Preview does not mount print or fullscreen data", () => {
  assert.match(createPage, /previewPolicy\.canRead \? <BrowserPrintDocument/);
  assert.match(createPage, /previewPolicy\.canRead \? <PreviewFullscreen/);
  assert.match(createPage, /!isPhone && previewPolicy\.canRead \? <PreviewPane/);
});
