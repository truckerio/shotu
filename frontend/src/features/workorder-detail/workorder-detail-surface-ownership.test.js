import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const featureUrl = new URL("./", import.meta.url);
const surfaceUrl = new URL("../../components/workorders/WorkorderDetailSurface.jsx", featureUrl);
const panelShellUrl = new URL("../../components/workorders/WorkorderPanelShell.jsx", featureUrl);
const sharedOdooPanelUrl = new URL("../workorder-modules/odoo/WorkorderOdooPanel.jsx", featureUrl);
const sharedOdooControllerUrl = new URL("../workorder-modules/odoo/useWorkorderOdooModule.js", featureUrl);

function source(relativeUrl) {
  return readFileSync(new URL(relativeUrl, featureUrl), "utf8");
}

function importedComponentNames(moduleSource) {
  const names = new Set();
  const importPattern = /import\s+([^;]+?)\s+from\s+["'][^"']+["'];?/g;

  for (const match of moduleSource.matchAll(importPattern)) {
    const clause = match[1].trim();
    if (clause.startsWith("{")) {
      for (const name of clause.slice(1, clause.lastIndexOf("}")).split(",")) {
        const imported = name.trim().split(/\s+as\s+/)[1] || name.trim().split(/\s+as\s+/)[0];
        if (imported) names.add(imported.trim());
      }
      continue;
    }

    const defaultImport = clause.split(",")[0].trim();
    if (defaultImport) names.add(defaultImport);
  }

  return names;
}

function renderedComponentNames(moduleSource) {
  return new Set(Array.from(moduleSource.matchAll(/<([A-Z][A-Za-z0-9]*)\b/g), (match) => match[1]));
}

function assertUsesComponent(moduleSource, componentName, ownerName) {
  assert.equal(
    importedComponentNames(moduleSource).has(componentName),
    true,
    `${ownerName} must import ${componentName}`,
  );
  assert.equal(
    renderedComponentNames(moduleSource).has(componentName),
    true,
    `${ownerName} must render ${componentName}`,
  );
}

test("office/mechanic and surveillance details consume one structural surface", () => {
  assert.equal(existsSync(surfaceUrl), true, "WorkorderDetailSurface.jsx must be the shared frame owner");
  assert.equal(existsSync(panelShellUrl), true, "WorkorderPanelShell.jsx must be the canonical panel owner");

  const detailPage = source("./WorkorderDetailPage.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");
  const panelShell = source("../../components/workorders/WorkorderPanelShell.jsx");

  assertUsesComponent(detailPage, "WorkorderDetailSurface", "WorkorderDetailPage");
  assertUsesComponent(surveillance, "WorkorderDetailSurface", "SurveillanceDetailPage");

  assertUsesComponent(surface, "WorkorderPanelShell", "WorkorderDetailSurface");
  for (const componentName of ["WorkorderDetailLayout", "WorkorderObjectSummary", "WorkorderSectionNav"]) {
    assertUsesComponent(panelShell, componentName, "WorkorderPanelShell");
    assert.equal(importedComponentNames(detailPage).has(componentName), false, `WorkorderDetailPage must not import ${componentName} directly`);
    assert.equal(importedComponentNames(surveillance).has(componentName), false, `SurveillanceWorkspace must not import ${componentName} directly`);
    assert.equal(renderedComponentNames(detailPage).has(componentName), false, `WorkorderDetailPage must not compose ${componentName} directly`);
    assert.equal(renderedComponentNames(surveillance).has(componentName), false, `SurveillanceWorkspace must not compose ${componentName} directly`);
  }

  assertUsesComponent(panelShell, "ArrowLeft", "WorkorderPanelShell");
  assert.doesNotMatch(panelShell, /ContextBreadcrumbs|breadcrumbs/);
  assert.match(surface, /back:\s*\{[\s\S]*label: context\.parent\.label,[\s\S]*onClick: context\.parent\.onClick/);
  assert.match(panelShell, /context\.back[\s\S]*onClick=\{context\.back\.onClick\}[\s\S]*aria-label=\{context\.back\.label\}/);
  assert.match(detailPage, /label: actorRole === "admin" \? "Operations" : isOfficeDetail \? "Office" : interfaceText\(locale, "mechanic\.myWork"\)/);
  assert.match(detailPage, /isPlainPrimaryActivation\(event\)/);
  assert.match(detailPage, /\[role='row'\]\[aria-label\]/);
  assert.match(detailPage, /focus\(\{ preventScroll: true \}\)/);
  assert.match(surveillance, /label: "Surveillance"/);
  assert.match(surveillance, /isPlainPrimaryActivation\(event\)/);
  assert.match(surveillance, /button\[aria-label\]/);
  assert.match(surveillance, /focus\(\{ preventScroll: true \}\)/);
});

test("Create and Detail cannot drift into separate workorder panel markup", () => {
  const createShell = source("../create-workorder/CreateWorkorderShell.jsx");
  const detailSurface = source("../../components/workorders/WorkorderDetailSurface.jsx");
  const panelShell = source("../../components/workorders/WorkorderPanelShell.jsx");

  assertUsesComponent(createShell, "WorkorderPanelShell", "CreateWorkorderShell");
  assertUsesComponent(detailSurface, "WorkorderPanelShell", "WorkorderDetailSurface");
  for (const owner of [createShell, detailSurface]) {
    assert.doesNotMatch(owner, /<WorkorderDetailLayout|<WorkorderObjectSummary/);
  }
  assert.match(panelShell, /<WorkorderDetailLayout/);
  assert.match(panelShell, /<WorkorderObjectSummary/);
  assert.match(panelShell, /<WorkorderSectionNav/);
  assert.match(panelShell, /supportingPane/);
});

test("canonical workorder header keeps context and actions in two grid columns", () => {
  const panelShell = source("../../components/workorders/WorkorderPanelShell.jsx");
  const toolbarCss = source("./workorder-detail-toolbar.css");
  const createMobileCss = source("../create-workorder/legacy-mobile-create-controls.css");

  assert.match(
    panelShell,
    /<div className=\{`detail-context-bar[^>]+>\s*<div className="workorder-context-main">[\s\S]*<div className="detail-context-actions">/,
  );
  assert.match(toolbarCss, /\.detail-context-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
  assert.match(toolbarCss, /\.workorder-context-main\s*\{[^}]*display:\s*flex;/s);
  assert.match(createMobileCss, /\.office-create-nav\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
  assert.match(createMobileCss, /\.office-create-nav \.workorder-context-main > button/);
});

test("shared detail header gives workorder identity the flexible grid track", () => {
  const detailCss = source("../../styles/workorder-detail.css");

  assert.match(
    detailCss,
    /\.workorder-detail-page \.detail-context-bar\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s,
  );
  assert.doesNotMatch(
    detailCss,
    /\.workorder-detail-page \.detail-context-bar\s*\{[^}]*grid-template-columns:\s*(?:34px|44px)/s,
  );
});

test("role actions remain outside the shared structural surface", () => {
  const detailPage = source("./WorkorderDetailPage.jsx");
  const detailSections = source("./WorkorderDetailSections.jsx");
  const concernModule = source("../workorder-modules/work/WorkorderConcernModule.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const sharedOdoo = source("../workorder-modules/odoo/WorkorderOdooPanel.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");

  assert.match(sharedOdoo, /surveillance-odoo-form/);
  assert.match(sharedOdoo, /createOdooDraft/);
  assert.match(sharedOdoo, /markMissingInfo/);
  assert.doesNotMatch(surface, /surveillance-odoo-form|createOdooDraft|markMissingInfo|Create Odoo draft/);

  assertUsesComponent(detailPage, "ChatComposer", "WorkorderDetailPage");
  assertUsesComponent(detailPage, "WorkorderDetailSections", "WorkorderDetailPage");
  assert.match(detailSections, /WorkorderDetailModuleHost/);
  assert.match(concernModule, /officeNotes|onSave/);
  assert.equal(importedComponentNames(surveillance).has("ChatComposer"), false);
  assert.equal(importedComponentNames(surveillance).has("WorkorderDetailSections"), false);
});

test("Admin and Surveillance reuse one policy-aware Odoo module owner", () => {
  assert.equal(existsSync(sharedOdooPanelUrl), true, "WorkorderOdooPanel.jsx must own shared Odoo UI");
  assert.equal(existsSync(sharedOdooControllerUrl), true, "useWorkorderOdooModule.js must own shared Odoo state and requests");

  const detailSections = source("./WorkorderDetailSections.jsx");
  const sharedOdooModule = source("../workorder-modules/odoo/WorkorderOdooModule.jsx");
  const sharedOdooPanel = source("../workorder-modules/odoo/WorkorderOdooPanel.jsx");
  const sharedOdooController = source("../workorder-modules/odoo/useWorkorderOdooModule.js");
  const surveillanceDetail = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surveillanceController = source("../surveillance/workspace/useSurveillanceDetail.js");

  const detailHost = source("../workorder-modules/WorkorderDetailModuleHost.jsx");
  assert.equal(importedComponentNames(detailHost).has("WorkorderOdooModule"), true);
  assert.match(detailHost, /odoo: WorkorderOdooModule/);
  assertUsesComponent(sharedOdooModule, "WorkorderOdooPanel", "WorkorderOdooModule");
  assert.match(sharedOdooPanel, /Create Odoo draft/);
  assert.match(sharedOdooPanel, /Odoo readiness/);
  assert.match(sharedOdooPanel, /canWrite/);
  assert.match(sharedOdooPanel, /canWrite\s*\?/);
  assert.match(sharedOdooPanel, /disabled=\{saving \|\| !canCreateDraft\}/);

  assert.match(sharedOdooController, /modules\/odoo/);
  assert.match(sharedOdooController, /moduleEndpoint\(workorderId, "readiness"\)/);
  assert.doesNotMatch(sharedOdooController, /moduleEndpoint\(workorderId, "preparation"\)/);
  assert.match(sharedOdooController, /moduleEndpoint\(workorderId, "draft"\)/);
  assert.match(sharedOdooController, /moduleEndpoint\(workorderId, "missing-info"\)/);
  assert.doesNotMatch(surveillanceController, /odoo-readiness|odoo-preparation|odoo-draft|mark-missing-info/);
  assert.match(surveillanceController, /useWorkorderOdooModule/);

  assert.match(surveillanceDetail, /WorkorderDetailModuleHost/);
  assert.match(detailHost, /odoo: WorkorderOdooModule/);
});

test("preview and activity use the existing shared implementations", () => {
  const detailPage = source("./WorkorderDetailPage.jsx");
  const detailSections = source("./WorkorderDetailSections.jsx");
  const activityModule = source("../workorder-modules/activity/WorkorderActivityModule.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");

  assertUsesComponent(detailPage, "PreviewPane", "WorkorderDetailPage");
  assertUsesComponent(detailPage, "CompactWorkorderPreview", "WorkorderDetailPage");
  assertUsesComponent(surveillance, "PreviewPane", "SurveillanceDetailPage");
  assertUsesComponent(surveillance, "CompactWorkorderPreview", "SurveillanceDetailPage");
  const detailHost = source("../workorder-modules/WorkorderDetailModuleHost.jsx");
  assert.equal(importedComponentNames(detailHost).has("WorkorderActivityModule"), true);
  assert.match(detailHost, /activity: WorkorderActivityModule/);
  assertUsesComponent(activityModule, "WorkorderTimelinePanel", "WorkorderActivityModule");
  assert.match(surveillance, /WorkorderDetailModuleHost/);

  const implementationPattern = /(?:function|const)\s+(PreviewPane|CompactWorkorderPreview|WorkorderTimelinePanel)\b/;
  assert.doesNotMatch(detailPage, implementationPattern);
  assert.doesNotMatch(detailSections, implementationPattern);
  assert.doesNotMatch(surveillance, implementationPattern);
  assert.doesNotMatch(surface, implementationPattern);
});

test("parts workspace remounts when the selected workorder changes", () => {
  const partsModule = source("../workorder-modules/parts/WorkorderPartsModule.jsx");
  assert.match(partsModule, /<PartRequestsPanel\s+key=\{activeWorkorder\.workorder\.id\}/);
});

test("detail section coordinator delegates module bodies to owned components", () => {
  const detailSections = source("./WorkorderDetailSections.jsx");
  const detailHost = source("../workorder-modules/WorkorderDetailModuleHost.jsx");
  assertUsesComponent(detailSections, "WorkorderDetailModuleHost", "WorkorderDetailSections");
  for (const componentName of [
    "WorkorderConcernModule",
    "WorkorderDiagnosisRepairModule",
    "WorkorderChatModule",
    "WorkorderPartsModule",
    "WorkorderPhotosModule",
    "WorkorderUnitModule",
    "WorkorderLocationModule",
    "WorkorderAssignmentModule",
    "WorkorderScheduleModule",
    "WorkorderActivityModule",
    "WorkorderCompletionModule",
    "WorkorderOdooModule",
  ]) {
    assert.equal(importedComponentNames(detailHost).has(componentName), true, `WorkorderDetailModuleHost must import ${componentName}`);
    assert.match(detailHost, new RegExp(`: ${componentName}\\b`));
  }
  assert.ok(detailSections.split("\n").length <= 220, "WorkorderDetailSections must remain a thin coordinator");
  assert.doesNotMatch(detailSections, /<ProgressiveWorkorderSection|<PartRequestsPanel|<WorkorderTimelinePanel/);
});
