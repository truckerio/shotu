import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const CSS_OWNERSHIP_VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
  { name: "phone-430", width: 430, height: 932 },
  { name: "split-506", width: 506, height: 900 },
  { name: "tablet", width: 768, height: 1024 },
  { name: "desktop-1080", width: 1080, height: 1080 },
  { name: "desktop-1920", width: 1920, height: 1080 },
];

const scriptDirectory = path.dirname(fileURLToPath(import.meta.url));
const repositoryRoot = path.resolve(scriptDirectory, "../..");
const outputDirectory = process.env.CSS_VISUAL_OUTPUT_DIR
  ? path.resolve(process.env.CSS_VISUAL_OUTPUT_DIR)
  : path.join(repositoryRoot, ".tmp/css-ownership");

const cssFiles = [
  "frontend/src/styles/foundation.css",
  "frontend/src/components/forms/operational-form.css",
  "frontend/src/components/forms/quantity-unit-input.css",
  "frontend/src/components/workorders/part-requests/part-catalog-combobox.css",
  "frontend/src/components/workorders/legacy-used-parts-editor.css",
  "frontend/src/components/workorders/workorder-parts-table.css",
  "frontend/src/components/workorders/used-parts-editor.css",
  "frontend/src/components/workorders/part-requests/legacy-part-requests.css",
  "frontend/src/components/preview/legacy-responsive-preview.css",
];

const fixtureCss = `
  * { box-sizing: border-box; }
  html, body { margin: 0; min-width: 0; width: 100%; }
  body { background: #f2f4f7; color: #182230; font-family: Arial, sans-serif; }
  .visual-shell { display: grid; gap: 16px; margin: 0 auto; max-width: 1180px; padding: 16px; width: 100%; }
  .part-requests-panel, .preview-panel { background: #fff; border: 1px solid #d0d5dd; min-width: 0; padding: 16px; }
  .part-request-card { min-width: 0; }
  .preview-grid { display: grid; min-width: 0; width: 100%; }
  .preview-page-card { background: #fff; border: 1px solid #d0d5dd; min-height: 240px; }
  .workorder-preview-shell { min-height: 220px; width: 100%; }
  .fixture-field { border: 1px solid #d0d5dd; min-height: 44px; width: 100%; }
  .fixture-button { align-items: center; background: #fff; border: 1px solid #d0d5dd; border-radius: 8px; display: inline-flex; gap: 8px; justify-content: center; min-height: 44px; padding: 8px 12px; }
`;

const fixtureMarkup = `
  <main class="visual-shell">
    <section class="part-requests-panel" data-testid="parts-panel">
      <div class="used-parts-editor">
        <section class="used-parts-section used-parts-labor-section">
          <h3>Labor</h3>
          <div class="operational-parts-editor detail-operational-parts-editor used-parts-labor-table">
            <div class="operational-part-row has-quantity-unit detail-operational-part-row used-part-labor-row" data-testid="labor-row">
              <strong>1</strong>
              <div class="used-part-field"><strong class="used-part-labor-name">[PTR001] Labor hours</strong></div>
              <div class="used-part-field used-part-quantity"><div class="quantity-unit-input"><input class="fixture-field" aria-label="Labor quantity"><select class="fixture-field" aria-label="Labor unit"><option>hr</option></select></div></div>
              <div class="used-part-field used-part-repair"><input class="fixture-field used-part-labor-repair" aria-label="Labor repair order" placeholder="Repair order / work performed"></div>
              <span></span>
            </div>
          </div>
        </section>
        <section class="used-parts-section used-parts-items-section">
          <h3>Parts used</h3>
          <div class="operational-parts-editor detail-operational-parts-editor used-parts-items-table">
            <div class="used-parts-column-head"><span>#</span><span>Part</span><span>Qty / unit</span><span>Repair order</span><span>Status / action</span></div>
            <div class="operational-part-row has-quantity-unit detail-operational-part-row used-part-recorded-row" data-testid="recorded-row">
              <strong>2</strong>
              <div class="used-part-field used-part-recorded-identity"><span class="used-part-cell-label">Part</span><strong>FUEL-FILTER</strong></div>
              <div class="used-part-field used-part-recorded-value"><span class="used-part-cell-label">Qty / unit</span><strong>1 pc</strong></div>
              <div class="used-part-field used-part-recorded-repair"><span class="used-part-cell-label">Repair order</span>Replace fuel filter</div>
              <span class="used-part-recorded-status"></span>
            </div>
            <div class="used-part-serialized-group">
              <div class="operational-part-row has-quantity-unit used-part-serialized-row" data-testid="serialized-row">
                <strong>3</strong>
                <div class="used-part-field used-part-serialized-identity"><span class="used-part-cell-label">Part</span><strong>Tires</strong><small>WG-S-D77D3209C3694DEE-5</small><small>Serialized parts</small></div>
                <div class="used-part-field used-part-serialized-value"><span class="used-part-cell-label">Qty / unit</span><strong>1 ea</strong></div>
                <div class="used-part-field used-part-repair"><span class="used-part-cell-label">Repair order</span><span class="used-part-pending-repair">Available after installation</span></div>
                <div class="used-part-serialized-actions"><span class="used-part-cell-label used-part-status-label">Status / action</span><span class="used-part-serialized-status">Reserved — awaiting Office approval</span><button class="button fixture-button" type="button">Mark installed</button><button class="button fixture-button" type="button">Return unused</button></div>
              </div>
            </div>
          </div>
          <div class="workorder-parts-actions used-parts-actions">
            <button class="button fixture-button create-parts-compact-action" type="button">+ Add approved part</button>
            <button class="button fixture-button mechanic-scan-trigger is-table-action" type="button"><span aria-hidden="true">⌗</span> Scan parts</button>
          </div>
        </section>
      </div>
      <section class="office-part-planning" data-testid="parts-planning">
        <div class="office-part-planning-heading"><h3>Requests &amp; supply</h3><button class="fixture-button" type="button" aria-label="About requests and supply">?</button></div>
        <button class="button fixture-button office-part-plan-trigger" type="button">+ Plan / source part</button>
      </section>
      <div class="part-request-list">
        <article class="part-request-card">
          <div class="part-request-summary"><strong>Requested part</strong><span class="part-state part-state-submitted">Submitted</span></div>
          <div class="part-office-fields"><input class="fixture-field" value="Filter" aria-label="Part number"><input class="fixture-field" value="1 pc" aria-label="Quantity"></div>
        </article>
      </div>
    </section>
    <section class="preview-panel" data-testid="preview-panel">
      <div class="preview-grid single">
        <article class="preview-page-card"><div class="workorder-preview-shell"></div></article>
      </div>
    </section>
  </main>
`;

async function loadCss() {
  const sources = await Promise.all(cssFiles.map((file) => readFile(path.join(repositoryRoot, file), "utf8")));
  return `${sources.join("\n")}\n${fixtureCss}`;
}

async function verifyViewport(page, viewport) {
  await page.setViewportSize({ width: viewport.width, height: viewport.height });
  await page.setContent(`<style>${await loadCss()}</style>${fixtureMarkup}`, { waitUntil: "load" });

  const geometry = await page.evaluate(() => {
    const documentElement = document.documentElement;
    const parts = document.querySelector('[data-testid="parts-panel"]');
    const columnHead = document.querySelector(".used-parts-column-head");
    const addPart = document.querySelector(".create-parts-compact-action");
    const scan = document.querySelector(".mechanic-scan-trigger");
    const labor = document.querySelector('[data-testid="labor-row"]');
    const recorded = document.querySelector('[data-testid="recorded-row"]');
    const serialized = document.querySelector('[data-testid="serialized-row"]');
    const serializedActions = serialized.querySelector(".used-part-serialized-actions");
    const serializedButtons = [...serializedActions.querySelectorAll("button")];
    const recordedIdentity = recorded.querySelector(".used-part-recorded-identity");
    const recordedQuantity = recorded.querySelector(".used-part-recorded-value");
    const recordedRepair = recorded.querySelector(".used-part-recorded-repair");
    const planning = document.querySelector('[data-testid="parts-planning"]');
    const planningHeading = planning.querySelector(".office-part-planning-heading");
    const planningAction = planning.querySelector(".office-part-plan-trigger");
    const preview = document.querySelector('[data-testid="preview-panel"]');
    const previewGrid = document.querySelector(".preview-grid");
    const previewPage = document.querySelector(".preview-page-card");
    const rect = (element) => {
      const bounds = element.getBoundingClientRect();
      return {
        bottom: bounds.bottom,
        clientWidth: element.clientWidth,
        height: bounds.height,
        left: bounds.left,
        right: bounds.right,
        scrollWidth: element.scrollWidth,
        top: bounds.top,
        width: bounds.width,
      };
    };

    return {
      documentClientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      parts: rect(parts),
      columnHead: rect(columnHead),
      columnHeadDisplay: getComputedStyle(columnHead).display,
      addPart: rect(addPart),
      scan: rect(scan),
      labor: rect(labor),
      recorded: rect(recorded),
      recordedIdentity: rect(recordedIdentity),
      recordedQuantity: rect(recordedQuantity),
      recordedRepair: rect(recordedRepair),
      serialized: rect(serialized),
      serializedChildren: [...serialized.children].map(rect),
      serializedActions: rect(serializedActions),
      serializedButtons: serializedButtons.map(rect),
      planningHeading: rect(planningHeading),
      planningAction: rect(planningAction),
      preview: rect(preview),
      previewGridClientWidth: previewGrid.clientWidth,
      previewGridScrollWidth: previewGrid.scrollWidth,
      previewPage: rect(previewPage),
    };
  });

  console.log(`${viewport.name}: parts=${Math.round(geometry.parts.left)}..${Math.round(geometry.parts.right)} header=${geometry.columnHeadDisplay} labor=${Math.round(geometry.labor.left)}..${Math.round(geometry.labor.right)} actions=${Math.round(geometry.serializedActions.width)}/${geometry.serializedActions.clientWidth}/${geometry.serializedActions.scrollWidth} buttons=${geometry.serializedButtons.map((button) => Math.round(button.width)).join("+")} add=${Math.round(geometry.addPart.width)} scan=${Math.round(geometry.scan.width)}x${Math.round(geometry.scan.height)}`);

  assert.equal(geometry.documentScrollWidth, geometry.documentClientWidth, `${viewport.name}: document must not overflow horizontally`);
  assert.ok(geometry.parts.width > 0 && geometry.preview.width > 0, `${viewport.name}: owned surfaces must have positive width`);
  assert.ok(geometry.parts.left >= 0 && geometry.parts.right <= viewport.width, `${viewport.name}: parts panel must remain in the viewport`);
  assert.ok(geometry.addPart.width >= 44 && geometry.scan.width >= 44 && geometry.scan.height >= 44, `${viewport.name}: add and scan controls must remain usable`);
  assert.ok(geometry.labor.left >= geometry.parts.left && geometry.labor.right <= geometry.parts.right, `${viewport.name}: labor row must remain inside Parts`);
  assert.ok(geometry.recorded.left >= geometry.parts.left && geometry.recorded.right <= geometry.parts.right, `${viewport.name}: recorded row must remain inside Parts`);
  assert.ok(geometry.serialized.left >= geometry.parts.left && geometry.serialized.right <= geometry.parts.right, `${viewport.name}: serialized row must remain inside Parts`);
  assert.ok(geometry.serializedChildren.every((child) => child.left >= geometry.serialized.left && child.right <= geometry.serialized.right), `${viewport.name}: serialized content must remain in its row columns`);
  assert.ok(geometry.serializedActions.scrollWidth <= geometry.serializedActions.clientWidth, `${viewport.name}: serialized actions must not overflow their column`);
  assert.ok(geometry.serializedButtons[0].right <= geometry.serializedButtons[1].left, `${viewport.name}: serialized action buttons must not overlap`);
  assert.equal(geometry.columnHeadDisplay === "none", geometry.serialized.width <= 760, `${viewport.name}: headings must yield to labeled stacked rows when the Parts container is compact`);

  if (geometry.recorded.width <= 520) {
    assert.ok(geometry.recorded.height <= 100, `${viewport.name}: a simple recorded part must remain compact`);
    assert.ok(Math.abs(geometry.recordedIdentity.top - geometry.recordedQuantity.top) <= 4, `${viewport.name}: part and quantity must share the first record line`);
    assert.ok(geometry.recordedIdentity.right <= geometry.recordedQuantity.left, `${viewport.name}: part and quantity columns must not overlap`);
    assert.ok(geometry.recordedRepair.top >= Math.min(geometry.recordedIdentity.bottom, geometry.recordedQuantity.bottom), `${viewport.name}: repair order must follow the primary record line`);
  }

  if (viewport.width <= 700) {
    assert.ok(Math.abs(geometry.addPart.width - geometry.scan.width) <= 1, `${viewport.name}: Add and Scan must fill balanced action columns`);
    assert.ok(Math.abs(geometry.addPart.top - geometry.scan.top) <= 1, `${viewport.name}: Add and Scan must align vertically`);
  }
  assert.ok(Math.abs(geometry.planningHeading.top - geometry.planningAction.top) < 16, `${viewport.name}: planning heading and action must share a compact row`);
  assert.ok(geometry.preview.left >= 0 && geometry.preview.right <= viewport.width, `${viewport.name}: preview panel must remain in the viewport`);
  assert.ok(geometry.previewPage.width > 0 && geometry.previewPage.height > 0, `${viewport.name}: preview page must have positive geometry`);

  if (viewport.width <= 700) {
    assert.ok(geometry.previewGridScrollWidth >= geometry.previewGridClientWidth, `${viewport.name}: preview overflow must stay inside its grid`);
  }

  await page.screenshot({ path: path.join(outputDirectory, `${viewport.name}.png`), fullPage: true });
}

await mkdir(outputDirectory, { recursive: true });
const browser = await chromium.launch({ headless: true });

try {
  const page = await browser.newPage();
  for (const viewport of CSS_OWNERSHIP_VIEWPORTS) {
    await verifyViewport(page, viewport);
  }
  console.log(`CSS ownership viewport checks passed; screenshots: ${outputDirectory}`);
} finally {
  await browser.close();
}
