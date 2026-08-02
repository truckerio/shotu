import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import test from "node:test";

const featureUrl = new URL("./", import.meta.url);
const surfaceUrl = new URL("../../components/workorders/WorkorderDetailSurface.jsx", featureUrl);

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

  const detailPage = source("./WorkorderDetailPage.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");

  assertUsesComponent(detailPage, "WorkorderDetailSurface", "WorkorderDetailPage");
  assertUsesComponent(surveillance, "WorkorderDetailSurface", "SurveillanceDetailPage");

  for (const componentName of ["WorkorderDetailLayout", "WorkorderObjectSummary", "WorkorderSectionNav"]) {
    assertUsesComponent(surface, componentName, "WorkorderDetailSurface");
    assert.equal(importedComponentNames(detailPage).has(componentName), false, `WorkorderDetailPage must not import ${componentName} directly`);
    assert.equal(importedComponentNames(surveillance).has(componentName), false, `SurveillanceWorkspace must not import ${componentName} directly`);
    assert.equal(renderedComponentNames(detailPage).has(componentName), false, `WorkorderDetailPage must not compose ${componentName} directly`);
    assert.equal(renderedComponentNames(surveillance).has(componentName), false, `SurveillanceWorkspace must not compose ${componentName} directly`);
  }
});

test("role actions remain outside the shared structural surface", () => {
  const detailPage = source("./WorkorderDetailPage.jsx");
  const detailSections = source("./WorkorderDetailSections.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surveillanceOdoo = source("../surveillance/workspace/SurveillanceOdooPanel.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");

  assert.match(surveillanceOdoo, /surveillance-odoo-form/);
  assert.match(surveillanceOdoo, /markEntered/);
  assert.match(surveillanceOdoo, /markMissingInfo/);
  assert.doesNotMatch(surface, /surveillance-odoo-form|markEntered|markMissingInfo|Service order no\./);

  assertUsesComponent(detailPage, "ChatComposer", "WorkorderDetailPage");
  assertUsesComponent(detailPage, "WorkorderDetailSections", "WorkorderDetailPage");
  assert.match(detailSections, /officeNotes|mechanicProgress|saveOfficeWorkorder|saveMechanicProgress/);
  assert.equal(importedComponentNames(surveillance).has("ChatComposer"), false);
  assert.equal(importedComponentNames(surveillance).has("WorkorderDetailSections"), false);
});

test("preview and activity use the existing shared implementations", () => {
  const detailPage = source("./WorkorderDetailPage.jsx");
  const detailSections = source("./WorkorderDetailSections.jsx");
  const surveillance = source("../surveillance/workspace/SurveillanceDetailPage.jsx");
  const surface = source("../../components/workorders/WorkorderDetailSurface.jsx");

  assertUsesComponent(detailPage, "PreviewPane", "WorkorderDetailPage");
  assertUsesComponent(detailPage, "CompactWorkorderPreview", "WorkorderDetailPage");
  assertUsesComponent(surveillance, "PreviewPane", "SurveillanceDetailPage");
  assertUsesComponent(surveillance, "CompactWorkorderPreview", "SurveillanceDetailPage");
  assertUsesComponent(detailSections, "WorkorderTimelinePanel", "WorkorderDetailSections");
  assertUsesComponent(surveillance, "WorkorderTimelinePanel", "SurveillanceDetailPage");

  const implementationPattern = /(?:function|const)\s+(PreviewPane|CompactWorkorderPreview|WorkorderTimelinePanel)\b/;
  assert.doesNotMatch(detailPage, implementationPattern);
  assert.doesNotMatch(detailSections, implementationPattern);
  assert.doesNotMatch(surveillance, implementationPattern);
  assert.doesNotMatch(surface, implementationPattern);
});
