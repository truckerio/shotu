import assert from "node:assert/strict";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

export const CSS_OWNERSHIP_VIEWPORTS = [
  { name: "phone", width: 390, height: 844 },
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
`;

const fixtureMarkup = `
  <main class="visual-shell">
    <section class="part-requests-panel" data-testid="parts-panel">
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
    const preview = document.querySelector('[data-testid="preview-panel"]');
    const previewGrid = document.querySelector(".preview-grid");
    const previewPage = document.querySelector(".preview-page-card");
    const rect = (element) => element.getBoundingClientRect();

    return {
      documentClientWidth: documentElement.clientWidth,
      documentScrollWidth: documentElement.scrollWidth,
      parts: rect(parts),
      preview: rect(preview),
      previewGridClientWidth: previewGrid.clientWidth,
      previewGridScrollWidth: previewGrid.scrollWidth,
      previewPage: rect(previewPage),
    };
  });

  assert.equal(geometry.documentScrollWidth, geometry.documentClientWidth, `${viewport.name}: document must not overflow horizontally`);
  assert.ok(geometry.parts.width > 0 && geometry.preview.width > 0, `${viewport.name}: owned surfaces must have positive width`);
  assert.ok(geometry.parts.left >= 0 && geometry.parts.right <= viewport.width, `${viewport.name}: parts panel must remain in the viewport`);
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
