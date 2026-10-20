import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm, unlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { chromium } from "playwright";

const repo = resolve(dirname(fileURLToPath(import.meta.url)), "../..");
const frontend = join(repo, "frontend");
const htmlPath = join(frontend, ".shared-rates-ui-harness.html");
const jsxPath = join(frontend, ".shared-rates-ui-harness.jsx");
const port = 5190;
const url = `http://127.0.0.1:${port}/.shared-rates-ui-harness.html`;
const watched = [
  "frontend/src/components/forms/Dropdown.jsx",
  "frontend/src/components/pricing/SetRatesDialog.jsx",
  "frontend/src/components/pricing/PartRatesDialog.jsx",
  "frontend/src/components/workorders/LaborPriceCell.jsx",
  "frontend/src/components/workorders/WorkorderPartPriceCell.jsx",
  "frontend/src/features/inventory/PartCommercialDetails.jsx",
  "frontend/src/features/workorder-modules/parts/CreateWorkorderPriceCell.jsx",
];

const html = `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Shared rates UI QA</title><link rel="icon" href="data:,"></head><body><div id="root"></div><script type="module" src="/.shared-rates-ui-harness.jsx"></script></body></html>`;
const jsx = String.raw`
import React, { useState } from "react";
import { createRoot } from "react-dom/client";
import "./src/styles.css";
import "./src/components/forms/operational-form.css";
import "./src/components/workorders/used-parts-editor.css";
import "./src/features/workorder-modules/parts/create-parts-module.css";
import { PartCommercialDetails } from "./src/features/inventory/PartCommercialDetails.jsx";
import { CreatePartPriceCell } from "./src/features/workorder-modules/parts/CreateWorkorderPriceCell.jsx";
import { LaborPriceCell } from "./src/components/workorders/LaborPriceCell.jsx";
import { WorkorderPartPriceCell } from "./src/components/workorders/WorkorderPartPriceCell.jsx";

const options = {
  batch_cost: { status: "known", price: { unitPrice: "70", currency: "USD" } },
  internal_cost: { status: "known", price: { unitPrice: "85", currency: "USD" } },
  selling_price: { status: "known", price: { unitPrice: "150", currency: "USD" } },
};
const rates = {
  internal_cost: { id: "labor-internal", status: "known", amount: "90", currency: "USD", version: 2, locationId: "location-1" },
  selling_price: { id: "labor-selling", status: "known", amount: "125", currency: "USD", version: 3, locationId: "location-1" },
};

function Harness() {
  const [createSelection, setCreateSelection] = useState("selling_price");
  return <main className="qa-shell">
    <h1>Shared rates UI QA</h1>
    <section data-testid="stock"><h2>Stock</h2><PartCommercialDetails
      part={{ catalogPartId: "part-1", partNumber: "QA-PART", description: "QA Part", trackingMode: "quantity", uomCode: "ea" }}
      location={{ locationId: "location-1", locationName: "Main Shop" }} onChanged={() => {}} />
    </section>
    <section data-testid="create"><h2>Create Workorder part</h2><CreatePartPriceCell
      eligible catalogPartId="part-1" partLabel="QA Create Part" locationId="location-1" uomCode="ea" trackingMode="quantity"
      selection={createSelection} previewStatus="ready" preview={{ status: "known", price: { unitPrice: "150", currency: "USD" }, options }}
      onChange={setCreateSelection} onCustomUnitPriceChange={() => {}} onRatesSaved={() => {}} />
    </section>
    <section data-testid="labor"><h2>Saved labor</h2><LaborPriceCell compact workorderId="workorder-1" locationId="location-1" productId="labor-1"
      hours="2" uomCode="hr" currentRates={rates} price={{ selection: "selling_price", productId: "labor-1", hours: "2", unitPrice: "125", currency: "USD" }} onChanged={() => {}} />
    </section>
    <section data-testid="part"><h2>Saved part</h2><WorkorderPartPriceCell compact workorderId="workorder-1" usageKind="aggregate" usageId="usage-1"
      catalogPartId="part-1" partLabel="QA Saved Part" locationId="location-1" uomCode="ea" quantity="2"
      price={{ selection: "selling_price", unitPrice: "150", currency: "USD", allocations: [] }} onChanged={() => {}} />
    </section>
  </main>;
}

createRoot(document.getElementById("root")).render(<Harness />);
`;

async function hashFiles() {
  const result = {};
  for (const relative of watched) {
    const contents = await readFile(join(repo, relative));
    result[relative] = createHash("sha256").update(contents).digest("hex");
  }
  return result;
}

async function waitForServer(processHandle) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    if (processHandle.exitCode !== null) throw new Error(`Vite exited before serving the harness (${processHandle.exitCode}).`);
    try {
      const response = await fetch(url);
      if (response.ok) return;
    } catch {}
    await new Promise((resolvePromise) => setTimeout(resolvePromise, 150));
  }
  throw new Error(`Timed out waiting for ${url}`);
}

async function choose(page, select, optionName) {
  await select.click();
  const option = page.getByRole("option", { name: optionName, exact: true });
  await option.waitFor();
  await option.click();
}

async function openRatesFromDropdown(page, section) {
  await choose(page, section.getByRole("button", { name: /price source/i }), "Set rates…");
  const dialog = page.getByRole("dialog", { name: "Set rates" });
  await dialog.waitFor();
  return dialog;
}

function commercialResponse() {
  const internal = { id: "internal-4", amount: "85", currency: "USD", version: 4, taxTreatment: "not_configured" };
  return {
    part: { catalogPartId: "part-1", companyId: "company-1", trackingMode: "quantity", uomCode: "ea" },
    scope: { locationId: "location-1", locationName: "Main Shop" },
    capabilities: { canEditPrices: true },
    prices: {
      internal: { current: internal, effective: internal, source: "location_override", override: { current: internal, history: [internal] }, companyDefault: { current: null, history: [] } },
      selling: { current: null, effective: null, source: null, override: { current: null, history: [] }, companyDefault: { current: null, history: [] } },
    },
    receiptCosts: { observations: [], coverage: {}, latest: null },
    purchaseOrders: { observations: [], latest: null },
  };
}

function sellingResponse() {
  return { policy: { id: "selling-5", locationId: "location-1", version: 5, method: "fixed", value: "150", currency: "USD" }, writeVersion: 5, availableBatches: [], capabilities: { canEdit: true, canEditBatchCost: true } };
}

async function main() {
  const before = await hashFiles();
  const artifactDir = await mkdtemp(join(tmpdir(), "shared-rates-ui-"));
  let vite;
  let browser;
  const requests = [];
  let failFirstInternalSave = true;
  const errors = [];
  try {
    await writeFile(htmlPath, html);
    await writeFile(jsxPath, jsx);
    const viteBin = join(repo, "node_modules/vite/bin/vite.js");
    vite = spawn(process.execPath, [viteBin, "--config", "frontend/vite.config.js", "--host", "127.0.0.1", "--port", String(port), "--strictPort"], { cwd: repo, stdio: ["ignore", "pipe", "pipe"] });
    await waitForServer(vite);
    browser = await chromium.launch({ headless: true });
    const page = await browser.newPage({ viewport: { width: 1440, height: 1000 }, reducedMotion: "reduce" });
    page.on("pageerror", (error) => errors.push(error.message));
    page.on("console", (message) => { if (message.type() === "error") errors.push(message.text()); });
    await page.route("**/api/**", async (route) => {
      const request = route.request();
      const parsed = new URL(request.url());
      const body = request.postDataJSON?.() || null;
      if (request.method() !== "GET") requests.push({ method: request.method(), path: parsed.pathname, body });
      if (parsed.pathname.endsWith("/commercial")) return route.fulfill({ json: commercialResponse() });
      if (parsed.pathname.endsWith("/selling-policy") && request.method() === "GET") return route.fulfill({ json: sellingResponse() });
      if (parsed.pathname.endsWith("/rates") && request.method() === "GET") return route.fulfill({ json: { currentRates: {
        internal_cost: { amount: "90", currency: "USD", version: 2, locationId: "location-1", sourceLabel: "Location override" },
        selling_price: { amount: "125", currency: "USD", version: 3, locationId: "location-1", sourceLabel: "Location override" },
      } } });
      if (body?.operation === "partPricingPreview") return route.fulfill({ json: { fingerprint: "preview-1", catalogPartId: "part-1", locationId: "location-1", partNumber: "QA Saved Part", uomCode: "ea", options: {
        batch_cost: { status: "known", price: { unitPrice: "70", currency: "USD" } },
        internal_cost: { status: "known", price: { unitPrice: "85", currency: "USD" } },
        selling_price: { status: "known", price: { unitPrice: "150", currency: "USD" } },
      } } });
      if (parsed.pathname.endsWith("/prices/internal") && request.method() === "PUT" && failFirstInternalSave) {
        failFirstInternalSave = false;
        return route.fulfill({ status: 409, json: { error: "Synthetic stale response" } });
      }
      return route.fulfill({ json: { result: {}, price: {}, policy: {} } });
    });
    await page.goto(url, { waitUntil: "networkidle" });
    await page.getByRole("heading", { name: "Shared rates UI QA" }).waitFor();

    const create = page.getByTestId("create");
    const createSelect = create.getByRole("button", { name: /price source/i });
    await createSelect.focus();
    await createSelect.click();
    const sellingOption = page.getByRole("option", { name: /^Selling price/ });
    await sellingOption.waitFor();
    const popover = page.locator(".workorder-price-source-popover");
    assert.equal(await popover.locator(".dropdown-select-check").count(), 0, "priced dropdown must not render Check icons");
    const optionGeometry = await sellingOption.evaluate((node) => {
      const label = node.querySelector(".dropdown-select-option-label").getBoundingClientRect();
      const description = node.querySelector(".dropdown-select-option-description").getBoundingClientRect();
      const style = getComputedStyle(node);
      return { labelRight: label.right, priceLeft: description.left, color: style.color, background: style.backgroundColor, selected: node.hasAttribute("data-selected") };
    });
    assert.ok(optionGeometry.labelRight <= optionGeometry.priceLeft, `label/price overlap: ${JSON.stringify(optionGeometry)}`);
    assert.equal(optionGeometry.selected, true);
    assert.equal(optionGeometry.color, "rgb(23, 92, 211)", "selected priced option must be blue");
    await page.keyboard.press("ArrowUp");
    assert.equal(await popover.locator(".dropdown-select-option[data-focused]").count(), 1, "keyboard navigation must focus one option");
    assert.equal(await popover.locator(".dropdown-select-option[data-focus-visible]").count(), 1, "keyboard focus must be visibly styled");
    await page.keyboard.press("Escape");

    const stock = page.getByTestId("stock");
    await stock.getByRole("button", { name: "Set rates", exact: true }).click();
    let dialog = page.getByRole("dialog", { name: "Set rates" });
    await dialog.waitFor();
    assert.match(await dialog.locator(".set-rates-source").innerText(), /Location override/);
    assert.equal(await dialog.getByRole("button", { name: "Rate type" }).getAttribute("aria-label"), "Rate type");
    assert.equal(await dialog.getByRole("button", { name: "Method" }).getAttribute("aria-label"), "Method");
    await choose(page, dialog.getByRole("button", { name: "Rate type" }), "Internal price");
    await dialog.getByLabel("Amount", { exact: true }).fill("95");
    await dialog.getByLabel("Reason", { exact: true }).fill("Rendered retry proof");
    await choose(page, dialog.getByRole("button", { name: "Currency" }), "Choose currency");
    assert.equal(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled(), true, "currency is required");
    await choose(page, dialog.getByRole("button", { name: "Currency" }), "USD");
    await dialog.getByLabel("Reason", { exact: true }).fill("");
    assert.equal(await dialog.getByRole("button", { name: "Save", exact: true }).isDisabled(), true, "reason is required");
    await dialog.getByLabel("Reason", { exact: true }).fill("Rendered retry proof");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.getByRole("alert").filter({ hasText: "Synthetic stale response" }).waitFor();
    assert.equal(await dialog.isVisible(), true, "save error must keep dialog open");
    const failed = requests.filter((entry) => entry.path.endsWith("/prices/internal"));
    assert.equal(failed.length, 1);
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    const retried = requests.filter((entry) => entry.path.endsWith("/prices/internal"));
    assert.equal(retried.length, 2);
    assert.equal(retried[0].body.idempotencyKey, retried[1].body.idempotencyKey, "identical retry must reuse idempotency key");

    dialog = await openRatesFromDropdown(page, create);
    assert.match(await dialog.locator(".set-rates-subject").innerText(), /QA Create Part/);
    await dialog.getByRole("button", { name: "Cancel" }).click();

    const labor = page.getByTestId("labor");
    const laborSnapshot = await labor.getByLabel("Labor unit price").inputValue();
    dialog = await openRatesFromDropdown(page, labor);
    await dialog.getByLabel("Amount", { exact: true }).fill("210");
    await dialog.getByLabel("Reason", { exact: true }).fill("Future labor rate");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await labor.getByLabel("Labor unit price").inputValue(), laborSnapshot, "saving a labor rate must not reprice the saved snapshot");
    assert.equal(await labor.locator(".dropdown-select-value").innerText(), "Select price", "saved labor must require explicit source reselection");
    await labor.getByText("Rate saved. Select a price source to apply it to this workorder.").waitFor();

    const part = page.getByTestId("part");
    const partSnapshot = await part.getByLabel("Part unit price").inputValue();
    dialog = await openRatesFromDropdown(page, part);
    await dialog.getByLabel("Amount", { exact: true }).fill("225");
    await dialog.getByLabel("Reason", { exact: true }).fill("Future part rate");
    await dialog.getByRole("button", { name: "Save", exact: true }).click();
    await dialog.waitFor({ state: "hidden" });
    assert.equal(await part.getByLabel("Part unit price").inputValue(), partSnapshot, "saving a part rate must not reprice the saved snapshot");
    assert.equal(await part.locator(".dropdown-select-value").innerText(), "Select price", "saved part must require explicit source reselection");
    await part.getByText("Rates saved. Choose a price source to apply them to this workorder.").waitFor();

    const geometry = [];
    for (const width of [390, 768, 1440]) {
      await page.setViewportSize({ width, height: 900 });
      dialog = await openRatesFromDropdown(page, create);
      const measurement = await page.evaluate(() => {
        const modal = document.querySelector(".set-rates-dialog").getBoundingClientRect();
        return { width: innerWidth, pageWidth: document.documentElement.scrollWidth, left: modal.left, right: modal.right, top: modal.top, bottom: modal.bottom };
      });
      assert.ok(measurement.pageWidth <= width + 1, `horizontal overflow at ${width}: ${JSON.stringify(measurement)}`);
      assert.ok(measurement.left >= -1 && measurement.right <= width + 1, `dialog outside ${width}px viewport: ${JSON.stringify(measurement)}`);
      assert.ok(measurement.top >= -1 && measurement.bottom <= 901, `dialog outside viewport height: ${JSON.stringify(measurement)}`);
      geometry.push(measurement);
      await page.screenshot({ path: join(artifactDir, `shared-rates-${width}.png`), animations: "disabled" });
      await dialog.getByRole("button", { name: "Cancel" }).click();
      await createSelect.click();
      const responsiveOption = page.getByRole("option", { name: /^Selling price/ });
      const responsiveAlignment = await responsiveOption.evaluate((node) => {
        const label = node.querySelector(".dropdown-select-option-label").getBoundingClientRect();
        const description = node.querySelector(".dropdown-select-option-description").getBoundingClientRect();
        return { labelLeft: label.left, labelRight: label.right, priceLeft: description.left, priceRight: description.right };
      });
      assert.ok(responsiveAlignment.labelLeft < responsiveAlignment.priceLeft && responsiveAlignment.labelRight <= responsiveAlignment.priceLeft,
        `priced option alignment failed at ${width}: ${JSON.stringify(responsiveAlignment)}`);
      assert.ok(responsiveAlignment.priceRight <= width + 1, `priced option escaped ${width}px viewport: ${JSON.stringify(responsiveAlignment)}`);
      geometry[geometry.length - 1].pricedOption = responsiveAlignment;
      await page.keyboard.press("Escape");
    }

    const expectedSyntheticErrors = errors.filter((message) => message.includes("server responded with a status of 409"));
    assert.equal(expectedSyntheticErrors.length, 1, `expected exactly one synthetic 409 console entry: ${JSON.stringify(errors)}`);
    const unexpectedErrors = errors.filter((message) => !message.includes("server responded with a status of 409"));
    assert.deepEqual(unexpectedErrors, [], `browser errors: ${JSON.stringify(errors)}`);
    const after = await hashFiles();
    const changedDuringRun = watched.filter((relative) => before[relative] !== after[relative]);
    console.log(JSON.stringify({
      result: "PASS",
      evidence: "supplemental mocked rendered UI; not real client-to-API end-to-end",
      contexts: ["Stock", "Create Workorder part", "saved labor", "saved part"],
      retryKey: retried[0].body.idempotencyKey,
      geometry,
      requests: requests.map(({ method, path, body }) => ({ method, path, operation: body?.operation || null, priceKind: body?.priceKind || null })),
      expectedSyntheticErrors,
      changedDuringRun,
    }, null, 2));
  } finally {
    await browser?.close().catch(() => {});
    if (vite && vite.exitCode === null) {
      vite.kill("SIGTERM");
      await new Promise((resolvePromise) => vite.once("exit", resolvePromise));
    }
    await Promise.allSettled([unlink(htmlPath), unlink(jsxPath), rm(artifactDir, { recursive: true, force: true })]);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
