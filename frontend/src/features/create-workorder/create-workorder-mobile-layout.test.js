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
const sharedNavigationCss = readFileSync(
  new URL("../../components/workorders/workorder-object-page.css", import.meta.url),
  "utf8",
);

test("Create and shared detail navigation use the same phone breakpoint", () => {
  assert.match(createCss, /@media \(max-width: 700px\)/);
  assert.match(sharedNavigationCss, /@media \(max-width: 700px\)/);
});

test("phone Create select and date fields share the 44px control height", () => {
  assert.match(
    createCss,
    /\.create-workorder-page\s+\.operational-form\s+select,\s*\.create-workorder-page\s+\.operational-form\s+input\[type="date"\]\s*\{[^}]*block-size:\s*44px;[^}]*box-sizing:\s*border-box;[^}]*inline-size:\s*100%;[^}]*max-block-size:\s*44px;[^}]*max-inline-size:\s*100%;[^}]*min-block-size:\s*44px;[^}]*min-inline-size:\s*0;[^}]*padding-block:\s*0;/s,
  );
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

test("phone Create opts date fields out of Safari intrinsic control sizing", () => {
  assert.match(
    createCss,
    /\.create-workorder-page\s+\.operational-form\s+input\[type="date"\]\s*\{[^}]*-webkit-appearance:\s*none;[^}]*appearance:\s*none;[^}]*display:\s*block;/s,
  );
});

test("phone Create uses shared keyboard foundation and one docked primary action", () => {
  assert.match(createPage, /useVisualViewport/);
  assert.match(createPage, /useFocusedFieldVisibility/);
  assert.match(createShell, /<KeyboardAwareDock/);
  assert.match(createShell, /t\("create\.creating"\) : t\("create\.title"\)/);
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
  assert.match(createPage, /dismissKeyboard\(\);[\s\S]*setActiveSection\(errorSection\);[\s\S]*resetMobileScroll\(errorSection\);/);
});

test("Create fields provide keyboard intent without changing textarea behavior", () => {
  assert.match(createUnit, /aria-autocomplete="list"[\s\S]*enterKeyHint="search"/);
  assert.match(createUnit, /id="workorder-mileage"[\s\S]*inputMode="numeric"/);
  assert.doesNotMatch(createUnit, /<textarea[^>]*enterKeyHint=/);
});

test("phone Create renders one form page and a contained compact Preview", () => {
  assert.match(createHost, /sections\.map/);
  assert.match(createUnit, /<ProgressiveWorkorderSection[\s\S]*displayMode="panel"[\s\S]*keepMounted/);
  assert.doesNotMatch(createForm, /<FormCard/);
  assert.match(createPage, /<CreateWorkorderShell[\s\S]*previewOpen=\{previewPolicy\.canRead && showEmbeddedPreview\}/);
  assert.match(
    createCss,
    /\.create-workorder-page\.create-section-preview\s+\.create-workorder-form\s*\{[^}]*display:\s*none;/s,
  );
  assert.match(
    createCss,
    /\.create-workorder-page\.create-section-preview\s+\.workorder-compact-preview\s+\.preview-panel\s*\{[^}]*display:\s*grid;/s,
  );
  assert.match(
    createCss,
    /\.workorder-compact-preview\s+\.preview-pane-content\s*\{[^}]*overflow-x:\s*hidden;[^}]*overflow-y:\s*auto;/s,
  );
  assert.match(
    createPage,
    /activeSection === "preview" && previewPolicy\.canRead[\s\S]*<CompactWorkorderPreview[\s\S]*<WorkorderPreview label=\{t\("preview\.firstPage"\)\}/,
  );
  assert.match(
    createCss,
    /\.workorder-compact-preview\s+\.preview-page-card,[\s\S]*\.workorder-preview-shell\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("Create keeps text entry responsive by deferring only live preview work", () => {
  assert.match(createPage, /const deferredPreviewSource = useDeferredValue\(form\);/);
  assert.match(
    createPage,
    /createWorkorderPreviewForm\(deferredPreviewSource, assignment\)/,
  );
  assert.doesNotMatch(createPage, /useDeferredValue\(form\)[\s\S]*?<CreateWorkorderForm[\s\S]*?form=\{deferredPreviewSource\}/);
});

test("Create shell uses the canonical workorder panel for summary and section navigation", () => {
  assert.match(createShell, /<WorkorderPanelShell/);
  assert.match(workorderPanelShell, /<WorkorderObjectSummary/);
  assert.match(workorderPanelShell, /<WorkorderSectionNav/);
  assert.match(createShell, /<WorkorderSectionNav/);
  assert.match(createShell, /showPristine/);
  assert.doesNotMatch(createShell, /create-workorder-section-tabs/);
  assert.match(createPage, /<CreateWorkorderShell/);
  assert.equal((createShell.match(/className="create-workorder-section-nav"/g) || []).length, 1);
  assert.match(
    createCss,
    /\.create-workorder-section-nav\.workorder-section-nav-desktop\s*\{[^}]*min-width:\s*0;[^}]*width:\s*100%;/s,
  );
});

test("mechanic Create omits assignment page while preserving assigned mechanic data", () => {
  assert.match(createSections, /filter\(\(\{ id \}\) => canAssign \|\| id !== WORKORDER_MODULE_IDS\.ASSIGNMENT\)/);
  assert.doesNotMatch(createForm, /You are assigned to this workorder\./);
  assert.doesNotMatch(createCss, /\.create-self-assignment\s*\{/);
  assert.match(createPage, /canAssign=\{canAssign\}/);
});
