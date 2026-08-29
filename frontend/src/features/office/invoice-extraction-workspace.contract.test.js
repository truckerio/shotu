import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const workspaceUrl = new URL("./InvoiceExtractionWorkspace.jsx", import.meta.url);
const viewerUrl = new URL("./InvoiceDocumentViewer.jsx", import.meta.url);
const officeWorkspaceUrl = new URL("./OfficeWorkspace.jsx", import.meta.url);
const confirmationUrl = new URL("./PhysicalReceiptConfirmation.jsx", import.meta.url);
const historyUrl = new URL("./InvoiceHistoryPanel.jsx", import.meta.url);

test("legacy invoice links resolve to Inventory and win over saved queue preferences", async () => {
  const [officeSource, inventorySource] = await Promise.all([
    readFile(officeWorkspaceUrl, "utf8"),
    readFile(new URL("../inventory/InventoryWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(officeSource, /if \(requested === "invoices"\) return "inventory"/);
  assert.match(officeSource, /return \["drafts", "inventory"\]\.includes\(requested\) \? requested : ""/);
  assert.match(officeSource, /const savedTabCandidate = !requestedWorkspace/);
  assert.match(officeSource, /: requestedWorkspace \|\| "needs"/);
  assert.match(inventorySource, /initialParams\.get\("view"\) === "invoices"/);
});

test("refreshed review restores only the authorized source route and keeps learning opt-in explicit", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /\/api\/office\/invoice-extractions\/\$\{encodeURIComponent\(run\.id\)\}\/source/);
  assert.match(source, /setReceipt\(savedRun\.inventoryReceipt \|\| null\)/);
  assert.match(source, /Use my corrections to improve future invoice extraction/);
  assert.match(source, /useState\(false\)/);
  assert.doesNotMatch(source, /original file preview is not retained/i);
});

test("saved-run navigation aborts superseded requests and ignores stale responses", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /savedRunRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(source, /const requestId = crypto\.randomUUID\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(savedRunRequestRef\.current\.id !== requestId\) return/);
  assert.match(source, /if \(savedRunRequestRef\.current\.id === requestId\)/);
});

test("invoice review exposes breadcrumb context and protects unsaved corrections", async () => {
  const workspace = await readFile(new URL("./InvoiceExtractionWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /onContextChange\?\.\(draft \? \{/);
  assert.match(workspace, /label: reviewBreadcrumbLabel/);
  assert.match(workspace, /onBack: clearBatch/);
  assert.match(workspace, /shouldConfirmInvoiceReviewLeave/);
  assert.match(workspace, /\[Boolean\(draft\), busy, onContextChange, reviewBreadcrumbLabel, reviewDirty, run\?\.status\]/);
  assert.match(workspace, /Discard invoice changes\?/);
  assert.match(workspace, /setReviewDirty\(true\)/);
  assert.match(workspace, /Keep editing/);
  assert.match(workspace, /Discard changes/);
  assert.match(workspace, /if \(draft && uploadOpen\) setUploadOpen\(false\)/);
  assert.match(workspace, /isOpen=\{uploadOpen && !draft\}/);
  assert.doesNotMatch(workspace, />Start another<\/Button>/);
});

test("invoice upload returns through the background queue and polls durable run state", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /timeoutMs: 15_000/);
  assert.match(source, /attempt < 120 && current\?\.status === "processing"/);
  assert.doesNotMatch(source, /timeoutMs: 195_000/);
});

test("header upload control opens one compact dialog and leaves vendor identification to review", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /locations\.length > 1/);
  assert.match(source, /className="invoice-upload-context"/);
  assert.match(source, /import \{ Dialog, Heading, Modal, ModalOverlay \} from "react-aria-components"/);
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx"/);
  assert.match(source, /uploadOpen: controlledUploadOpen, onUploadOpenChange/);
  assert.match(source, /const uploadOpen = controlledUploadOpen \?\? internalUploadOpen/);
  assert.match(source, /onUploadOpenChange\?\.\(open\)/);
  assert.doesNotMatch(source, /invoice-upload-launcher/);
  assert.match(source, /<ModalOverlay className="invoice-upload-overlay"/);
  assert.match(source, /<Dialog className="invoice-upload-dialog" aria-labelledby="invoice-upload-title">/);
  assert.match(source, /aria-label="Close invoice upload"/);
  assert.doesNotMatch(source, />Cancel<\/Button>/);
  assert.match(source, /onChange=\{chooseFiles\} multiple required disabled=\{busy === "extract"\}/);
  assert.match(source, /onDragOver=\{\(event\) => event\.preventDefault\(\)\} onDrop=\{dropFiles\}/);
  assert.match(source, /PDF or image · 10 MB each/);
  assert.match(source, /const MAX_ENQUEUE_CONCURRENCY = 3/);
  assert.match(source, /enqueueUploadsInLanes\(uploads, token\)/);
  assert.match(source, /idempotencyKey: upload\.idempotencyKey/);
  assert.match(source, /Invoice \{batchIndex \+ 1\} of \{batchRuns\.length\} · \{batchProgress\.ready\} ready/);
  assert.match(source, /isDismissable=\{busy !== "extract"\}/);
  assert.match(source, /Encrypted · Training use requires your approval/);
  assert.doesNotMatch(source, /More options/);
  assert.doesNotMatch(source, /vendorHint|Vendor name \(optional\)/);
  assert.doesNotMatch(source, /Extract a parts invoice/);
});

test("batch extraction opens the first completed draft while independent pollers continue", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const monitors = queued\.map\(\(entry\) => monitorBatchEntry\(entry, token\)\)/);
  assert.match(source, /if \(!activeRunRef\.current \|\| activeRunRef\.current\.status === "reviewed"\)/);
  assert.match(source, /showBatchEntry\(completedEntry, currentIndex\)/);
  assert.match(source, /Review will open as soon as the first draft is ready\./);
  assert.match(source, /batchTokenRef\.current !== token/);
  assert.match(source, /setBusy\(""\)/);
  assert.match(source, /nextReviewableBatchIndex\(updatedBatchRuns, batchIndex\)/);
  assert.doesNotMatch(source, /Stopped at \$\{failed\.fileName\}/);
});

test("invoice review stays compact while confidence and evidence remain available", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(new URL("./invoice-extraction.css", import.meta.url), "utf8");
  assert.match(source, /className="invoice-field-heading"/);
  assert.match(source, /<Confidence field=\{field\} optional=\{options\.optional\} \/>/);
  assert.match(source, /<details className="invoice-field-evidence">/);
  assert.match(source, /title="Additional details"/);
  assert.match(source, /PO number only if your company gave one to the seller\./);
  assert.match(source, /invoiceFieldNeedsReview\(candidate\.field, candidate\.options\)/);
  assert.match(source, /confidence >= 90 \? "high" : confidence >= 70 \? "medium" : "low"/);
  assert.match(source, /\{state\} · <span className=\{`invoice-confidence-value is-\$\{level\}`\}>\{field\.confidence\}%<\/span>/);
  assert.match(styles, /\.invoice-confidence-value\.is-high\s*\{[^}]*color:#067647;/);
  assert.match(styles, /\.invoice-confidence-value\.is-medium\s*\{[^}]*color:#b54708;/);
  assert.match(styles, /\.invoice-confidence-value\.is-low\s*\{[^}]*color:#b42318;/);
  assert.doesNotMatch(styles, /\.needs-review\s*\{/);
});

test("completed invoice status banners dismiss after 1.5 seconds without hiding review notes", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const STATUS_DISMISS_MS = 1_500/);
  assert.match(source, /if \(!message \|\| busy\) return undefined;/);
  assert.match(source, /window\.setTimeout\(\(\) => setMessage\(""\), STATUS_DISMISS_MS\)/);
  assert.match(source, /window\.clearTimeout\(timer\)/);
  assert.match(source, /draft\.warnings\.length \? \(/);
  assert.match(source, /<details className="invoice-review-notes">/);
});

test("invoice review always composes the reusable document viewer before the form", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /import \{ InvoiceDocumentViewer \}/);
  assert.match(source, /<div className="invoice-review-layout">[\s\S]*<InvoiceDocumentViewer[\s\S]*<div className="invoice-review-form">/);
  assert.doesNotMatch(source, /displayedPreviewUrl \? \(/);
});

test("document viewer toolkit keeps bounded controls and truthful unavailable state", async () => {
  const source = await readFile(viewerUrl, "utf8");
  assert.match(source, /role="toolbar" aria-label="Document viewer tools"/);
  for (const label of ["Zoom out", "Zoom in", "Reset document view", "Rotate image clockwise", "Open fullscreen document view", "Open original invoice in a new tab", "Download original invoice"]) assert.match(source, new RegExp(label));
  assert.match(source, /Document source unavailable/);
  assert.match(source, /isPdf[\s\S]*<object[\s\S]*<img/);
});

test("physical receipt confirmation requires explicit attestation and keeps exceptions write-free", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  const confirmation = await readFile(confirmationUrl, "utf8");
  assert.match(workspace, /<PhysicalReceiptConfirmation/);
  assert.match(workspace, /\/confirm-receipt/);
  assert.match(confirmation, /All reviewed items received and undamaged/);
  assert.match(confirmation, /Missing or damaged/);
  assert.match(confirmation, /Inventory unchanged/);
  assert.match(confirmation, /correct the invoice if its values are wrong/);
  assert.match(confirmation, /disabled=\{busy \|\| disabled \|\| !attested\}/);
  assert.doesNotMatch(confirmation, /api\(/);
});

test("review notes and footer use compact progressive disclosure", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /<details className="invoice-review-notes">/);
  assert.match(source, /extraction note\{draft\.warnings\.length === 1/);
  assert.match(source, /<details className="invoice-learning-option">/);
  assert.match(source, /Saves review only · Inventory stays unchanged/);
  assert.doesNotMatch(source, /className="invoice-warning"/);
  assert.doesNotMatch(source, /Check totals and document quality/);
  assert.doesNotMatch(source, /Reviewed values are locked\. Adding inventory is a separate, auditable action\./);
});

test("reviewed invoice values are locked before physical confirmation", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /disabled=\{run\.status === "reviewed"\}/);
  assert.match(source, /readOnly=\{run\.status === "reviewed"\}/);
  assert.match(source, /run\.status === "reviewed"/);
  assert.match(source, /receipt\.units\.slice\(0, 12\)/);
  assert.doesNotMatch(source, /inventory\/receipts\/\$\{encodeURIComponent\(receipt\.id\)\}\/labels/);
});

test("completed invoice can be re-extracted from retained source without overwriting history or inventory", async () => {
  const source = await readFile(new URL("./InvoiceExtractionWorkspace.jsx", import.meta.url), "utf8");
  const reextractDialog = source.slice(source.indexOf("const reextractDialog"), source.indexOf("if (draft)"));
  assert.match(source, /\/api\/office\/invoice-extractions\/\$\{encodeURIComponent\(run\.id\)\}\/reextract/);
  assert.match(source, /idempotencyKey: `reextract-\$\{crypto\.randomUUID\(\)\}`/);
  assert.match(source, /<Heading slot="title" id="invoice-reextract-title">Re-extract this invoice\?<\/Heading>/);
  assert.match(reextractDialog, /<Modal className="invoice-upload-modal">/);
  assert.match(reextractDialog, /<div className="invoice-upload-dialog-heading">/);
  assert.match(reextractDialog, /<div className="invoice-upload-dialog-actions">/);
  assert.match(source, /The current invoice stays in history and inventory will not change\./);
  assert.match(source, /Unsaved edits are not copied into the new extraction\./);
  assert.match(source, /setBatchRuns\(\[entry\]\);[\s\S]*showBatchEntry\(entry, 0\);/);
  assert.match(source, /disabled=\{Boolean\(busy\) \|\| receipt\?\.status === "posted"\}/);
  assert.match(source, /Reverse the posted receipt before re-extracting/);
});

test("invoice intake owns one bounded, abortable, server-paginated history surface", async () => {
  const [workspace, history, inventory] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(historyUrl, "utf8"),
    readFile(new URL("../inventory/InventoryWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /<InvoiceHistoryPanel/);
  assert.match(workspace, /availableLocations/);
  assert.match(workspace, /if \(Array\.isArray\(availableLocations\)\)/);
  assert.match(workspace, /loadSavedRun\(runId\)/);
  assert.match(workspace, /reviewTitleRef\.current\.focus/);
  assert.match(history, /\/api\/office\/inventory\/invoices\?\$\{params\}/);
  assert.match(history, /limit: String\(PAGE_SIZE\), page: String\(page\)/);
  assert.match(history, /new AbortController\(\)/);
  assert.match(history, /controller\.abort\(\)/);
  assert.match(history, /Search invoices/);
  assert.match(history, /Recent invoices/);
  assert.match(history, /Add inventory/);
  assert.match(history, /Print QRs/);
  assert.match(history, /className="invoice-history-name" data-invoice-run=\{invoice\.id\}/);
  assert.match(history, /function canOpenInvoice\(invoice\)/);
  assert.doesNotMatch(history, />Review<|>View</);
  assert.doesNotMatch(inventory, /\/api\/office\/inventory\/invoices/);
  assert.doesNotMatch(inventory, /Invoice history/);
});

test("invoice history keeps truthful terminal actions and reversed receipt copy", async () => {
  const [workspace, history] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(historyUrl, "utf8"),
  ]);
  assert.match(history, /\["reviewed", "needs_review", "added", "reversed"\]\.includes\(invoice\.inventoryStatus\)/);
  assert.match(history, /invoice\.inventoryStatus === "reviewed" \? <Button[\s\S]*?>Add inventory<\/Button>/);
  assert.match(workspace, /Reversed · local inventory adjusted/);
  assert.match(workspace, /Receipt reversed · Inventory not added/);
  assert.match(workspace, /receipt\?\.status === "posted"/);
});
