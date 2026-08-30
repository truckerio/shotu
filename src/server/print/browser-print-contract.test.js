import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";
import {
  renderWorkorderDocument,
  renderWorkorderPagesHtml,
  workorderQuantityTotals,
  workorderPhysicalPageCount,
  workorderTemplateStyles,
} from "../../../shared/workorder-template.js";

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

test("print requires a persisted workorder and never allocates a draft serial", () => {
  assert.match(serverSource, /if \(!input\.workorderId\) throw invalidRequest\("Create the workorder before printing\."\)/);
  assert.match(serverSource, /serials:\s*\[workorder\.serial\]/);
  assert.doesNotMatch(
    serverSource,
    /url\.pathname === "\/api\/print"[\s\S]*?reserveWorkorderSerials\([\s\S]*?\n\s*}\n\s*const allocation/,
  );
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

  assert.equal((html.match(/class="workorder-page/g) || []).length, 10);
  for (const serial of serials) assert.match(html, new RegExp(`Invoice No:</span><strong class="wo-value">${serial}`));
  assert.match(html, /page-break-after:\s*always/);
  assert.match(html, /\.workorder-page\.is-document-final-page\s*\{\s*page-break-after:\s*auto/);
  assert.equal((html.match(/is-document-final-page/g) || []).length, 2);
});

test("shared template keeps operational text readable without ellipsis clipping", () => {
  assert.match(workorderTemplateStyles, /\.wo-label\s*\{[^}]*font-size:\s*12px/s);
  assert.match(workorderTemplateStyles, /\.wo-value\s*\{[^}]*font-size:\s*12px/s);
  assert.match(workorderTemplateStyles, /\.wo-part-row > div\s*\{[^}]*font-size:\s*12px/s);
  assert.match(workorderTemplateStyles, /\.wo-footer > div\s*\{[^}]*font-size:\s*12px/s);
  assert.match(workorderTemplateStyles, /\.wo-disclaimer span\s*\{[^}]*font-size:\s*10px/s);
  assert.doesNotMatch(workorderTemplateStyles, /\.wo-value\s*\{[^}]*text-overflow:\s*ellipsis/s);
  assert.doesNotMatch(workorderTemplateStyles, /\.wo-value\s*\{[^}]*white-space:\s*nowrap/s);
  assert.doesNotMatch(workorderTemplateStyles, /\.wo-disclaimer span\s*\{[^}]*text-overflow:\s*ellipsis/s);
});

test("workorder preview renders labor first without treating it as inventory", () => {
  const html = renderWorkorderPagesHtml({
    laborHours: "2.5",
    laborProduct: { externalId: "91", code: "PTR001", name: "LABOR HOURS", uomCode: "hr" },
    workPerformed: "Replace hub seal",
    parts: [{ partNo: "46305", qty: "1", uomCode: "ea", repairOrder: "Replace hub seal" }],
  }, "WO-000102");

  assert.ok(html.indexOf("[PTR001] LABOR HOURS") < html.indexOf("46305"));
  assert.match(html, /\[PTR001\] LABOR HOURS/);
  assert.match(html, />2\.5 hr</);
  assert.match(html, />Replace hub seal</);
  assert.match(html, /Total Labor:<strong>2\.5 hr<\/strong>/);
  assert.match(html, /Total Parts:<strong>1<\/strong>/);
});

test("workorder quantity totals add used parts without counting labor or blank rows", () => {
  const totals = workorderQuantityTotals({
    laborHours: "3.25",
    parts: [
      { partNo: "FILTER", qty: "2", uomCode: "pc" },
      { partNo: "OIL", qty: "1.5", uomCode: "gal" },
      { partNo: "", qty: "9", uomCode: "pc" },
      { partNo: "BELT", qty: "", uomCode: "pc" },
    ],
  });

  assert.deepEqual(totals, { labor: "3.25 hr", parts: "3.5" });
});

test("workorder preview keeps a labor repair order visible before hours are entered", () => {
  const html = renderWorkorderPagesHtml({
    laborProduct: { externalId: "91", code: "LAB200", name: "Shop labor", uomCode: "hr" },
    workPerformed: "Diagnose intermittent no-start",
    parts: [],
  }, "WO-000103");

  assert.match(html, /\[LAB200\] Shop labor/);
  assert.match(html, />Diagnose intermittent no-start</);
});

test("part repair orders stay on their own rows instead of duplicating onto labor", () => {
  const repairOrder = "HEX SCREW MBN 10105-M14X1,";
  const html = renderWorkorderPagesHtml({
    laborHours: "1.5",
    laborProduct: { externalId: "91", code: "PTR001", name: "LABOR HOURS", uomCode: "hr" },
    workPerformed: repairOrder,
    parts: [{ partNo: "0000000002211", qty: "1", uomCode: "ea", repairOrder }],
  }, "WO-000129");

  const renderedRows = [...html.matchAll(/<div class="wo-part-row">([\s\S]*?)<\/div>\s*<\/div>/g)]
    .map((match) => match[1]);
  assert.doesNotMatch(renderedRows[0], /HEX SCREW/);
  assert.match(renderedRows[1], /HEX SCREW MBN 10105-M14X1,/);
  assert.equal((html.match(/HEX SCREW MBN 10105-M14X1,/g) || []).length, 1);
});

test("distinct labor repair text remains while a duplicated part line is filtered", () => {
  const html = renderWorkorderPagesHtml({
    laborHours: "2",
    workPerformed: "Diagnosed wiring fault\nReplace failed sensor",
    parts: [{ partNo: "SENSOR", qty: "1", uomCode: "ea", repairOrder: "Replace failed sensor" }],
  }, "WO-000130");

  assert.match(html, />Diagnosed wiring fault</);
  assert.equal((html.match(/Replace failed sensor/g) || []).length, 1);
});

test("parts overflow creates numbered continuation pages without shrinking the workorder", () => {
  const parts = Array.from({ length: 14 }, (_, index) => ({
    partNo: `PART-${index + 1}`,
    qty: "1",
    repairOrder: `Replaced part ${index + 1} and verified operation.`,
  }));
  const form = { parts, customerCompanyName: "Long Haul" };
  const html = renderWorkorderPagesHtml(form, "WO-000101");

  assert.equal(workorderPhysicalPageCount(form), 3);
  assert.equal((html.match(/class="workorder-page/g) || []).length, 3);
  assert.match(html, /Page 1 of 3/);
  assert.match(html, /Page 3 of 3/);
  assert.match(html, /data-page-number="3"/);
  assert.match(html, />PART-14</);
  assert.match(html, /<div>14<\/div>/);
  assert.equal((html.match(/Invoice No:<\/span><strong class="wo-value">WO-000101/g) || []).length, 3);
});

test("ten serial batch keeps ten workorders while counting continuation pages independently", () => {
  const serials = Array.from({ length: 10 }, (_, index) => `WO-${String(index + 1).padStart(6, "0")}`);
  const form = {
    parts: Array.from({ length: 7 }, (_, index) => ({
      partNo: `P-${index + 1}`,
      qty: "1",
      repairOrder: `Repair ${index + 1}`,
    })),
  };
  const html = renderWorkorderDocument(form, serials);

  assert.equal(workorderPhysicalPageCount(form), 2);
  assert.equal((html.match(/class="workorder-page/g) || []).length, 20);
  assert.equal(new Set([...html.matchAll(/data-workorder-serial="([^"]+)"/g)].map((match) => match[1])).size, 10);
});

test("frontend browser print contract does not depend on enumerating printers", async () => {
  const routeSource = await readFile(new URL("../../../frontend/src/app/routes/RoleRouter.jsx", import.meta.url), "utf8");
  const printControllerSource = await readFile(new URL("../../../frontend/src/features/create-workorder/useWorkorderPrintController.js", import.meta.url), "utf8");
  const createSource = await readFile(new URL("../../../frontend/src/features/create-workorder/CreateWorkorderPage.jsx", import.meta.url), "utf8");
  const detailSource = await readFile(new URL("../../../frontend/src/features/workorder-detail/WorkorderDetailPage.jsx", import.meta.url), "utf8");
  const previewSource = await readFile(new URL("../../../frontend/src/components/preview/PreviewPane.jsx", import.meta.url), "utf8");

  assert.match(routeSource, /useWorkorderPrintController/);
  assert.match(printControllerSource, /printBrowser = \(\) => window\.print\(\)/);
  assert.match(`${createSource}\n${detailSource}`, /BrowserPrintDocument/);
  assert.ok(
    printControllerSource.indexOf("await openPrintDialog") < printControllerSource.indexOf('await request("/api/print"'),
    "the browser print dialog must open before the slower archived PDF request",
  );
  assert.doesNotMatch(`${routeSource}\n${printControllerSource}\n${createSource}\n${detailSource}`, /\/api\/printers|printerName|refreshPrinters/);
  assert.doesNotMatch(previewSource, /Use printer|Save PDF only|onSelectPrintDestination/);
  assert.match(previewSource, /t\("preview\.uniqueSerial"\)/);
});
