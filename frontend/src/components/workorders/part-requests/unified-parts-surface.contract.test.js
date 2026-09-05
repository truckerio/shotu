import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

function source(name) {
  return readFileSync(new URL(name, import.meta.url), "utf8");
}

const mechanicSurface = source("./MechanicPartsSurface.jsx");
const mechanicCard = source("./MechanicRequestCard.jsx");
const officeSurface = source("./OfficePartsSurface.jsx");
const officeComposer = source("./OfficePartComposer.jsx");
const officeCard = source("./OfficeRequestCard.jsx");
const panelCss = source("../part-requests-panel.css");
const legacyCss = source("./legacy-part-requests.css");
const mechanicLocales = ["en", "es", "pa"].map((locale) => source(`../../../i18n/locales/${locale}.js`));

test("mechanic parts keeps actual use visible and makes requesting a single permission-gated disclosure", () => {
  const usedParts = mechanicSurface.indexOf("<UsedPartsSection");
  const requestAction = mechanicSurface.indexOf("mechanic-part-request-action");
  assert.ok(usedParts >= 0 && requestAction > usedParts);
  assert.match(mechanicSurface, /mechanicActions\.canRequestPart \? \(/);
  assert.match(mechanicSurface, /aria-expanded=\{requestFormOpen\}/);
  assert.match(mechanicSurface, /aria-controls=\{requestPartPanelId\}/);
  assert.match(mechanicSurface, /t\("parts\.requestsSupply"\)/);
  assert.match(mechanicSurface, /t\("parts\.completedRequests"\)/);
  assert.doesNotMatch(mechanicSurface, /usedPartAction|needPartAction|activeAction|aria-pressed/);
});

test("labor editing remains separate from actual-part editing when Parts is View", () => {
  const panel = source("../PartRequestsPanel.jsx");
  const section = source("./UsedPartsSection.jsx");
  const editor = source("../UsedPartsEditor.jsx");
  const accessModel = source("../used-parts-model.js");
  assert.match(panel, /laborEditable = detail\.allowedActions\?\.saveNotes === true/);
  assert.match(section, /partsEditable=\{editable\}/);
  assert.match(section, /laborEditable=\{laborEditable\}/);
  assert.match(editor, /!partsEditable && !laborEditable/);
  assert.match(editor, /disabled=\{!laborEditable \|\| laborRepairOrderDisabled\}/);
  assert.match(editor, /\{partsEditable \? <WorkorderPartsRow className="used-part-intake-row"[\s\S]*className="create-part-identity-field used-parts-manual-picker"[\s\S]*<PartCatalogCombobox/);
  assert.doesNotMatch(editor, /used-part-quantity-/);
  assert.match(accessModel, /Actual parts are read-only/);
});

test("mechanic requests preserve exceptions while collapsing only conservative terminal outcomes", () => {
  assert.match(mechanicSurface, /\["rejected", "cancelled"\]/);
  assert.match(mechanicSurface, /\["installed", "returned"\]/);
  assert.match(mechanicSurface, /openRequests = requests\.filter\(\(request\) => !isCompletedRequest\(request\)\)/);
  assert.match(mechanicSurface, /<details className="part-request-history">/);
  assert.match(mechanicSurface, /`not_used` remains open: the Office queue treats it as an unresolved exception/);
  assert.doesNotMatch(mechanicSurface, /\["installed", "returned", "not_used"\]/);
  assert.doesNotMatch(mechanicCard, /<Dropdown|\/usage`|usageStatus\), \{/);
  assert.match(mechanicCard, /const usageKey = `parts\.usage\.\$\{request\.usageStatus\}`/);
  assert.match(mechanicCard, /localizedUsage === usageKey \? statusText\(request\.usageStatus\) : localizedUsage/);
});

test("office planning follows actual used parts and cannot use the used-part endpoint", () => {
  assert.ok(officeSurface.indexOf("<UsedPartsSection") < officeSurface.indexOf("<OfficePartComposer"));
  assert.match(officeSurface, /detail\.allowedActions\?\.planParts \? \(/);
  assert.match(officeSurface, /<OfficePartComposer detail=\{detail\} onChanged=\{onChanged\} \/>/);
  assert.match(officeComposer, /\/part-plans/);
  assert.match(officeComposer, /purpose="request"/);
  assert.doesNotMatch(officeComposer, /purpose="plan"/);
  assert.doesNotMatch(officeComposer, /workorders\/\$\{detail\.workorder\.id\}\/parts`/);
  assert.match(officeComposer, /interfaceText\(locale, key\)/);
  assert.match(officeComposer, /t\("parts\.planSourcePart"\)/);
  assert.doesNotMatch(officeComposer, /t\("parts\.planningDoesNotRecordUse"\)/);
  assert.match(officeSurface, /<SectionHelpDisclosure label=\{t\("parts\.planningDoesNotRecordUse"\)\}>/);
  assert.match(officeComposer, /className="office-part-plan-trigger"/);
  assert.match(officeSurface, /\{requests\.length \? <div className="office-part-overview">/);
  assert.match(legacyCss, /\.office-part-planning\s*\{[^}]*grid-template-columns:\s*minmax\(0, 1fr\) auto;/s);
  assert.match(legacyCss, /> \.office-part-plan-trigger\s*\{[^}]*width:\s*auto;/s);
});

test("mechanic request labels remain owned by every supported locale", () => {
  for (const dictionary of mechanicLocales) {
    assert.match(dictionary, /"parts\.requestsSupply":\s*"[^"\n]+"/);
    assert.match(dictionary, /"parts\.completedRequests":\s*"[^"\n]+"/);
    assert.match(dictionary, /"parts\.usage\.not_issued":\s*"[^"\n]+"/);
    assert.match(dictionary, /"parts\.usage\.returned":\s*"[^"\n]+"/);
  }
});

test("Office and read-only Parts surfaces remain English regardless of mechanic locale", () => {
  const panel = source("../PartRequestsPanel.jsx");
  assert.match(panel, /<OfficePartsSurface \{\.\.\.commonProps\} \/>/);
  assert.match(panel, /<ReadOnlyPartsSurface \{\.\.\.commonProps\} \/>/);
});

test("office allocation choices are exclusively server-provided transitions", () => {
  assert.match(officeCard, /const nextStatuses = Array\.isArray\(allocation\.nextStatuses\) \? allocation\.nextStatuses : \[\];/);
  assert.match(officeCard, /nextStatuses\.length \? \(/);
  assert.match(officeCard, /<option value=\{allocation\.status\}>\{statusLabel\}<\/option>/);
  assert.match(officeCard, /nextStatuses\.map\(\(status\) => <option value=\{status\} key=\{status\}>/);
  assert.match(officeCard, /: <span className="allocation-source-status">\{statusLabel\}<\/span>/);
  assert.doesNotMatch(officeCard, /Object\.entries\(ALLOCATION_STATUS_LABELS\)\.map/);
});

test("new compact controls retain touch-safe mobile geometry", () => {
  assert.match(panelCss, /mechanic-part-request-action > button[\s\S]*min-height: 44px/);
  assert.match(panelCss, /@media \(max-width: 640px\)[\s\S]*mechanic-part-request-action > button \{ width: 100%; \}/);
  assert.match(legacyCss, /part-request-history > summary[\s\S]*min-height: 44px/);
  assert.match(legacyCss, /office-part-planning \.button,[\s\S]*min-height: 44px/);
});
