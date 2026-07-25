import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import { renderWorkorderDocument } from "../../../shared/workorder-template.js";

const serverSource = await readFile(new URL("../../../server.js", import.meta.url), "utf8");

test("browser print backend has no server printer discovery or physical print commands", () => {
  assert.doesNotMatch(serverSource, /listPrinters|printPdf|lpstat|Get-Printer|Start-Process.+PrintTo/);
  assert.doesNotMatch(serverSource, /url\.pathname === "\/api\/printers"/);
  assert.match(serverSource, /process\.env\.WORKORDER_STORAGE_DIR/);
});

test("print endpoint returns the persisted browser-print job contract", () => {
  assert.match(serverSource, /status:\s*"generated"/);
  assert.match(serverSource, /message:\s*"PDF generated and saved\. Open it to print with your browser\."/);
  assert.match(serverSource, /jobId:\s*allocation\.job\.id/);
  assert.match(serverSource, /serials:\s*allocation\.serials/);
  assert.match(serverSource, /nextNumber:\s*allocation\.company\.nextNumber/);
  assert.match(serverSource, /downloadUrl:\s*`\/api\/jobs\/\$\{encodeURIComponent\(allocation\.job\.id\)\}\/pdf`/);
  assert.match(serverSource, /printForm:\s*form/);
  assert.doesNotMatch(serverSource, /status:\s*"printed"|print_failed_serials_consumed/);
});

test("print downloads and operational reprints are resource scoped", () => {
  assert.match(serverSource, /requestContext\.companyIds\?\.has\(job\.companyId\)/);
  assert.match(serverSource, /requireWorkorderAccess\(requestContext,\s*job\.workorderId\)/);
  assert.match(serverSource, /requestContext\.locationIds\?\.has\(job\.locationId\)/);
  assert.match(serverSource, /form = operationalWorkorderPrintForm\(workorder\)/);
});

test("reprinting a serial preserves its existing ledger history", () => {
  assert.match(serverSource, /uploadHistory:\s*existing\?\.uploadHistory \|\| \[\]/);
  assert.match(serverSource, /shareHistory:\s*existing\?\.shareHistory \|\| \[\]/);
  assert.match(serverSource, /jobIds:\s*\[\.\.\.new Set/);
  assert.match(serverSource, /if \(!company\.issued\.some\(\(issued\) => issued\.serial === entry\.serial\)\)/);
});

test("shared print renderer emits one physical page for every reserved serial", () => {
  const serials = Array.from({ length: 10 }, (_, index) => `WO-${String(index + 1).padStart(6, "0")}`);
  const html = renderWorkorderDocument({
    companyName: "Chino Yard",
    headerTitle: "CHINO YARD WORKORDER",
    parts: [],
  }, serials);

  assert.equal((html.match(/class="workorder-page"/g) || []).length, 10);
  for (const serial of serials) assert.match(html, new RegExp(`Invoice No:</span><strong class="wo-value">${serial}`));
  assert.match(html, /page-break-after:\s*always/);
  assert.match(html, /\.workorder-page:last-child\s*\{\s*page-break-after:\s*auto/);
});

test("frontend browser print contract does not depend on enumerating printers", async () => {
  const appSource = await readFile(new URL("../../../frontend/src/app/App.jsx", import.meta.url), "utf8");
  const previewSource = await readFile(new URL("../../../frontend/src/components/preview/PreviewPane.jsx", import.meta.url), "utf8");

  assert.match(appSource, /window\.print\(\)/);
  assert.match(appSource, /BrowserPrintDocument/);
  assert.doesNotMatch(appSource, /\/api\/printers|printerName|refreshPrinters/);
  assert.doesNotMatch(previewSource, /Use printer|Save PDF only|onSelectPrintDestination/);
  assert.match(previewSource, /Each workorder gets a unique serial/);
});
