import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";

const createCss = readFileSync(new URL("./create-workorder-page.css", import.meta.url), "utf8");
const createPage = readFileSync(new URL("./CreateWorkorderPage.jsx", import.meta.url), "utf8");
const createShell = readFileSync(new URL("./CreateWorkorderShell.jsx", import.meta.url), "utf8");
const workorderPanelShell = readFileSync(
  new URL("../../components/workorders/WorkorderPanelShell.jsx", import.meta.url),
  "utf8",
);
const createSections = readFileSync(new URL("./create-workorder-sections.js", import.meta.url), "utf8");
const createForm = readFileSync(new URL("../generator/CreateWorkorderForm.jsx", import.meta.url), "utf8");
const createHost = readFileSync(new URL("../workorder-modules/WorkorderCreateModuleHost.jsx", import.meta.url), "utf8");
const createUnit = readFileSync(new URL("../workorder-modules/unit/CreateUnitModule.jsx", import.meta.url), "utf8");
const operationalFormCss = readFileSync(
  new URL("../../components/forms/operational-form.css", import.meta.url),
  "utf8",
);
const datePickerCss = readFileSync(
  new URL("../../components/forms/date-picker.css", import.meta.url),
  "utf8",
);
const sharedNavigationCss = readFileSync(
  new URL("../../components/workorders/workorder-object-page.css", import.meta.url),
  "utf8",
);

test("Create and shared detail navigation use the same phone breakpoint", () => {
  assert.match(createCss, /@media \(max-width: 700px\)/);
  assert.match(sharedNavigationCss, /@media \(max-width: 700px\)/);
});

test("Create replaces its legacy Preview surfaces with one Documents supporting panel", () => {
  assert.match(createPage, /import \{ DocumentsPanel \}/);
  assert.match(createPage, /previewOpen=\{customerPreviewOpen\}/);
  assert.match(createPage, /supportingPane=\{<DocumentsPanel[\s\S]*open=\{customerPreviewOpen\}/);
  assert.doesNotMatch(createPage, /<PreviewPane|CompactWorkorderPreview|PreviewFullscreen|WorkorderPreview|BrowserPrintDocument|PrintModal/);
  assert.doesNotMatch(createShell, /PreviewToggle|onTogglePreview|previewActive|previewVisible/);
});

test("phone Create select and shared date fields have 44px controls", () => {
  assert.match(
    createCss,
    /\.create-workorder-page\s+\.operational-form\s+select\s*\{[^}]*block-size:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*inline-size:\s*100%;[^}]*max-block-size:\s*44px;[^}]*max-inline-size:\s*100%;[^}]*min-block-size:\s*44px;[^}]*min-inline-size:\s*0;[^}]*padding-block:\s*0;/s,
  );
  assert.match(datePickerCss, /\.date-picker-control \{[^}]*min-height: 44px;/);
});

test("shared operational controls include padding inside their contained width", () => {
  assert.match(
    operationalFormCss,
    /\.operational-form\s+:where\(input:not\(\[type="checkbox"\]\):not\(\[type="radio"\]\), select, textarea\)\s*\{[^}]*box-sizing:\s*border-box;[^}]*max-width:\s*100%;[^}]*min-width:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("known parts editor can container-wrap rows inside narrow desktop cards", () => {
  assert.match(
    operationalFormCss,
    /\.operational-parts-editor\s*\{[^}]*container-type:\s*inline-size;/s,
  );
});

test("phone Create uses the shared date picker instead of a native date control", () => {
  assert.doesNotMatch(createForm, /type="date"/);
  assert.match(datePickerCss, /\.date-picker-control/);
});

test("phone Create uses shared keyboard foundation and one docked primary action", () => {
  assert.match(createPage, /useVisualViewport/);
  assert.match(createPage, /useFocusedFieldVisibility/);
  assert.match(createShell, /<KeyboardAwareDock/);
  assert.match(createShell, /t\("create\.creating"\) : createLabel \|\| t\("create\.title"\)/);
  assert.match(createShell, /\{!isPhone \? \([\s\S]*className="detail-create-button"/);
  assert.match(createCss, /@media \(max-width:\s*1180px\)[\s\S]*\.prototype\.create-workorder-page\.is-keyboard-open\s*\{[^}]*position:\s*fixed;[^}]*width:\s*100%;/s);
  assert.match(createCss, /\.create-workorder-page\.is-keyboard-open\s+\.create-workorder-form\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s);
});

test("phone keyboard hides Create dock while the active form remains scrollable", () => {
  assert.match(createPage, /keyboardOpen=\{keyboardOpen\}/);
  assert.match(createShell, /mode="hide"/);
  assert.match(createPage, /mobileScrollRef=\{mobileScrollRef\}/);
  assert.match(createPage, /margin:\s*12/);
  assert.match(createPage, /window\.scrollTo\(\{ top: 0, left: 0, behavior: "auto" \}\)/);
  assert.match(createPage, /dismissKeyboard\(\);[\s\S]*setActiveSection\(errorSection\);[\s\S]*resetMobileScroll\(\);/);
});

test("Create fields provide keyboard intent without changing textarea behavior", () => {
  assert.match(createUnit, /aria-autocomplete="list"[\s\S]*enterKeyHint="search"/);
  assert.match(createUnit, /id="workorder-mileage"[\s\S]*inputMode="numeric"/);
  assert.doesNotMatch(createUnit, /<textarea[^>]*enterKeyHint=/);
});

test("phone Create keeps one form page and opens Documents from its header toggle", () => {
  assert.match(createHost, /sections\.map/);
  assert.match(createUnit, /<ProgressiveWorkorderSection[\s\S]*displayMode="panel"[\s\S]*keepMounted/);
  assert.doesNotMatch(createForm, /<FormCard/);
  assert.match(createShell, /\{customerDocumentAction\}/);
  assert.doesNotMatch(createShell, /create-workorder-mobile-action">\{customerDocumentAction\}/);
  assert.match(createPage, /<PreviewToggle[\s\S]*controls="workorder-documents-panel"/);
  assert.match(createPage, /async function previewCustomerEstimate\(\{ open = true \} = \{\}\) \{\s*if \(open\) setCustomerPreviewOpen\(true\)/);
  assert.doesNotMatch(createPage, /activeSection === "preview"/);
  assert.doesNotMatch(createSections, /WORKORDER_MODULE_IDS\.PREVIEW,[\s\S]*\];/);
});

test("Create mounts review, loading, and error states inside Documents rather than below the form", () => {
  assert.match(createPage, /<DocumentsPanel[\s\S]*customerDocumentBusy && !customerProjection[\s\S]*customerDocumentError[\s\S]*<CustomerDocumentReview/);
  assert.match(createPage, /<CreateWorkorderForm[\s\S]*customerDocumentError && !customerPreviewOpen/);
  assert.doesNotMatch(createPage, /customerPreviewOpen && customerProjection \? <CustomerDocumentReview/);
});

test("Create uses the shared continuous form for every role", () => {
  assert.match(createShell, /<WorkorderPanelShell/);
  assert.match(workorderPanelShell, /<WorkorderObjectSummary/);
  assert.match(workorderPanelShell, /<WorkorderSectionNav/);
  assert.match(createPage, /const createPresentation = "one-page"/);
  assert.match(createShell, /presentation=\{presentation\}/);
  assert.match(createShell, /presentation === "panel"[\s\S]*?<WorkorderSectionNav/s);
  assert.match(workorderPanelShell, /\{!onePage \? \([\s\S]*?<WorkorderObjectSummary[\s\S]*?<WorkorderSectionNav/s);
  assert.match(createShell, /showPristine/);
  assert.doesNotMatch(createShell, /create-workorder-section-tabs/);
  assert.match(createPage, /<CreateWorkorderShell/);
  assert.match(createShell, /className="create-workorder-section-nav"/);
});

test("mechanic Create omits assignment page while preserving assigned mechanic data", () => {
  assert.match(createSections, /filter\(\(\{ id \}\) => canAssign \|\| id !== WORKORDER_MODULE_IDS\.ASSIGNMENT\)/);
  assert.doesNotMatch(createForm, /You are assigned to this workorder\./);
  assert.doesNotMatch(createCss, /\.create-self-assignment\s*\{/);
  assert.match(createPage, /canAssign=\{canAssign\}/);
});
