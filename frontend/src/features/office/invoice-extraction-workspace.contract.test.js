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
  assert.match(officeSource, /return \["drafts", "inventory", "units"\]\.includes\(requested\) \? requested : ""/);
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
  assert.match(source, /initialRunId = ""/);
  assert.match(source, /if \(!initialRunId\) return/);
  assert.match(source, /loadSavedRun\(initialRunId, false\)/);
  assert.match(source, /\[initialRunId\]/);
  assert.doesNotMatch(source, /new URLSearchParams\(window\.location\.search\)\.get\("invoiceRun"\)/);
  assert.match(source, /savedRunRequestRef\.current\.controller\?\.abort\(\)/);
  assert.match(source, /const requestId = crypto\.randomUUID\(\)/);
  assert.match(source, /signal: controller\.signal/);
  assert.match(source, /if \(savedRunRequestRef\.current\.id !== requestId\) return/);
  assert.match(source, /if \(savedRunRequestRef\.current\.id === requestId\)/);
});

test("desktop review rail keeps natural row height so long invoices have a real scroll range", async () => {
  const styles = await readFile(new URL("./invoice-extraction.css", import.meta.url), "utf8");
  assert.match(styles, /\.inventory-workspace\.is-invoice-workflow > \.operational-collection-page-body \{ min-height:calc\(100dvh - 52px\); \}/);
  assert.match(styles, /\.invoice-review-rail \{[^}]*align-content:start;[^}]*grid-auto-rows:max-content;[^}]*overflow-y:auto;/);
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
  const [source, sharedDialog, sharedStyles] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(new URL("../../components/ui/UploadDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/ui/upload-dialog.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /import \{ Dialog, Heading, Modal, ModalOverlay \} from "react-aria-components"/);
  assert.match(source, /import \{ Button \} from "\.\.\/\.\.\/components\/ui\/Button\.jsx"/);
  assert.match(source, /import \{ UploadDialog, UploadDropzone \} from "\.\.\/\.\.\/components\/ui\/UploadDialog\.jsx"/);
  assert.match(source, /uploadOpen: controlledUploadOpen, onUploadOpenChange/);
  assert.match(source, /const uploadOpen = controlledUploadOpen \?\? internalUploadOpen/);
  assert.match(source, /onUploadOpenChange\?\.\(open\)/);
  assert.doesNotMatch(source, /invoice-upload-launcher/);
  const uploadDialogSource = source.slice(source.indexOf("const uploadDialog"), source.indexOf("const leaveReviewDialog"));
  assert.match(source, /<UploadDialog[\s\S]*?title="Upload invoices"/);
  assert.match(source, /closeLabel="Close invoice upload"/);
  assert.doesNotMatch(uploadDialogSource, />Cancel<\/Button>/);
  assert.doesNotMatch(sharedDialog, />Cancel<\/Button>/);
  assert.match(source, /<UploadDropzone[\s\S]*?onChange=\{chooseFiles\} onDrop=\{dropFiles\} multiple disabled=\{busy === "extract"\}/);
  assert.doesNotMatch(source, /<UploadDropzone[^>]*required/);
  assert.match(source, /PDF or image · 10 MB each/);
  assert.match(source, /const MAX_ENQUEUE_CONCURRENCY = 3/);
  assert.match(source, /enqueueUploadsInLanes\(uploads, token\)/);
  assert.match(source, /idempotencyKey: upload\.idempotencyKey/);
  assert.match(source, /Invoice \{batchIndex \+ 1\} of \{batchRuns\.length\} · \{batchProgress\.ready\} ready/);
  assert.match(source, /isDismissable=\{busy !== "extract"\}/);
  assert.match(source, /Encrypted · Training use requires your approval/);
  assert.match(sharedDialog, /<ModalFrame[\s\S]*dialogClassName="shared-upload-dialog"/);
  assert.match(sharedDialog, /<UploadCloud02 aria-hidden="true"/);
  assert.match(sharedStyles, /border:1\.5px dashed #b2ccff/);
  assert.match(sharedStyles, /border-radius:24px/);
  assert.doesNotMatch(source, /More options/);
  assert.doesNotMatch(source, /vendorHint|Vendor name \(optional\)/);
  assert.doesNotMatch(source, /Extract a parts invoice/);
});

test("embedded invoice intake starts in the shop selected by Purchases", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /initialLocationId = ""/);
  assert.match(source, /availableLocations\.some\(\(location\) => location\.id === initialLocationId\)/);
  assert.match(source, /\? initialLocationId/);
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

test("invoice review groups compact evidence fields into meaningful disclosure sections", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(new URL("./invoice-extraction.css", import.meta.url), "utf8");
  assert.match(source, /className="invoice-field-heading"/);
  assert.match(source, /<Confidence field=\{field\} optional=\{options\.optional\} \/>/);
  assert.match(source, /<details className="invoice-field-evidence">/);
  for (const title of ["Invoice details", "Items", "Totals", "Delivery"]) assert.match(source, new RegExp(`title="${title}"`));
  assert.match(source, /className="invoice-review-section-action">\{open \? "Close" : readOnly \? "View" : "Edit"\}/);
  assert.match(source, /import \{ CurrencySelector \}/);
  assert.match(source, /type === "currency"/);
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

test("invoice review composes a mounted source canvas before the independently scrolling rail", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(new URL("./invoice-extraction.css", import.meta.url), "utf8");
  assert.match(source, /import \{ InvoiceDocumentViewer \}/);
  assert.match(source, /<div className="invoice-review-layout">[\s\S]*className="invoice-review-panel invoice-source-panel"[\s\S]*<InvoiceDocumentViewer[\s\S]*className="invoice-review-panel invoice-review-form invoice-review-rail"/);
  assert.match(source, /hidden=\{compactReview && reviewPane !== "document"\}/);
  assert.match(source, /hidden=\{compactReview && reviewPane !== "review"\}/);
  assert.match(styles, /\.invoice-review-layout\s*\{[^}]*block-size:max\(560px,calc\(100dvh - 230px\)\)[^}]*overflow:hidden;/);
  assert.match(styles, /\.invoice-review-rail\s*\{[^}]*overflow-y:auto;/);
  assert.match(styles, /@media \(max-width:900px\)[\s\S]*\.invoice-review-rail\s*\{[^}]*overflow:visible;/);
  assert.doesNotMatch(source, /displayedPreviewUrl \? \(/);
});

test("tablet and phone keep both review panels mounted behind an accessible switch", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const styles = await readFile(new URL("./invoice-extraction.css", import.meta.url), "utf8");
  assert.match(source, /className="invoice-review-switch" role="tablist" aria-label="Invoice review view"/);
  assert.match(source, /role="tab" aria-selected=\{reviewPane === "document"\} aria-controls="invoice-document-panel"/);
  assert.match(source, /role="tab" aria-selected=\{reviewPane === "review"\} aria-controls="invoice-review-panel"/);
  assert.match(source, /COMPACT_REVIEW_QUERY = "\(max-width: 900px\)"/);
  assert.match(source, /media\.addEventListener\?\.\("change", updateCompactReview\)/);
  assert.match(styles, /\.invoice-review-switch button\s*\{[^}]*min-height:44px;/);
});

test("invoice items put unresolved rows first and render only the selected line editor", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const orderedLines = useMemo\(\(\) => orderInvoiceLinesForReview\(draft\?\.lines\)/);
  assert.match(source, /const \[activeLineId, setActiveLineId\] = useState\(""\)/);
  assert.match(source, /aria-expanded=\{active\} aria-controls=\{`invoice-line-editor-\$\{line\.id\}`\}/);
  assert.match(source, /\{active \? <fieldset id=\{`invoice-line-editor-\$\{line\.id\}`\}/);
  assert.match(source, /nextInvoiceLineIdAfterRemoval\(draft\.lines, lineId\)/);
  assert.match(source, /Unresolved lines appear first/);
  assert.match(source, /defaultOpen=\{lineIssues > 0\}/);
});

test("unresolved disclosures lead DOM and keyboard order while completed sections start collapsed", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const reviewSections = orderInvoiceReviewSections\(\[/);
  assert.match(source, /\{ id: "details", unresolved: invoiceDetailIssues > 0 \}/);
  assert.match(source, /\{ id: "delivery", unresolved: deliveryPending \|\| deliveryIssues > 0 \}/);
  assert.match(source, /\{reviewSections\.map\(\(section\) => \{/);
  assert.match(source, /defaultOpen=\{invoiceDetailIssues > 0\}/);
  assert.match(source, /defaultOpen=\{totalsIssues > 0\}/);
});

test("resolving the final issue preserves the open editor until the operator closes it", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /if \(status === "Pending" \|\| issueCount > 0\) setOpen\(true\)/);
  assert.doesNotMatch(source, /!issueCount\) setOpen\(false\)/);
  assert.match(source, /key=\{`\$\{run\.id\}-\$\{section\.id\}`\}/);
});

test("Delivery owns pending physical receipt and resets it only after successful receipt episodes", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  const deliveryStart = source.indexOf('sectionId="invoice-delivery"');
  const footerStart = source.indexOf('{run.status !== "reviewed" ? <footer', deliveryStart);
  const deliverySource = source.slice(deliveryStart, footerStart);
  assert.match(source, /const \[receiptEpisode, setReceiptEpisode\] = useState\(0\)/);
  assert.match(source, /setReceipt\(result\.receipt\);[\s\S]*setReceiptEpisode\(\(current\) => current \+ 1\)/);
  assert.match(deliverySource, /status=\{deliveryPending \? "Pending" : deliveryComplete \? "Complete" : deliveryReversed \? "Reversed" : ""\}/);
  assert.match(deliverySource, /defaultOpen=\{deliveryPending \|\| deliveryIssues > 0\}/);
  assert.match(deliverySource, /<PhysicalReceiptConfirmation receiptEpisode=\{receiptEpisode\}/);
  assert.doesNotMatch(source.slice(footerStart), /<PhysicalReceiptConfirmation/);
  assert.match(source, /setReceiptEpisode\(0\)/);
});

test("a posted partial receipt keeps Delivery pending for the next receiving episode", async () => {
  const source = await readFile(workspaceUrl, "utf8");
  assert.match(source, /const invoiceFullyReceived = invoiceDeliveryFullyReceived\(\{ receipt, suggestion: purchaseOrderSuggestion \}\)/);
  assert.match(source, /const deliveryComplete = invoiceFullyReceived;/);
  assert.doesNotMatch(source, /deliveryComplete = receipt\?\.status === "posted"/);
  assert.match(source, /const partialReceiptPosted = receipt\?\.status === "posted" && deliveryPending;/);
  assert.match(source, /Partial receipt posted · receive remaining quantities/);
  assert.match(source, /Remaining quantities can be received in another episode\./);
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
  assert.match(confirmation, /ReceiptLinesEditor/);
  assert.match(confirmation, /Post received items/);
  assert.match(confirmation, /Inventory unchanged/);
  assert.match(confirmation, /Leave all lines at zero/);
  assert.match(confirmation, /quantities and delivery exceptions below match what physically arrived/);
  assert.match(confirmation, /quantities and delivery exceptions entered below accurately describe this delivery/);
  assert.doesNotMatch(confirmation, /these entered quantities are physically present/);
  assert.match(confirmation, /disabled=\{busy \|\| disabled \|\| !attested \|\| !ready/);
  assert.doesNotMatch(confirmation, /api\(/);
});

test("invoice receipt retries stale exact positions without replacing its receipt command", async () => {
  const workspace = await readFile(workspaceUrl, "utf8");
  assert.match(workspace, /const commandStorageKey = `invoice-receipt-command:\$\{run\.id\}`/);
  assert.match(workspace, /let idempotencyKey = localStorage\.getItem\(commandStorageKey\)/);
  assert.match(workspace, /if \(nextError\?\.code === "INVENTORY_RECEIPT_POSITION_INVALID"\) setReceiptPositionsReload\(\(value\) => value \+ 1\)/);
  assert.match(workspace, /setError\(nextError\.message\)/);
  assert.match(workspace, /localStorage\.removeItem\(commandStorageKey\);\n      setReceipt\(result\.receipt\)/);
});

test("no-PO receipt posting strips purchase line identity from receipt lines", async () => {
  const confirmation = await readFile(confirmationUrl, "utf8");
  assert.match(confirmation, /posting\.postingRoute === "no_purchase_order"/);
  assert.match(confirmation, /purchaseLineId: _purchaseLineId/);
  assert.match(confirmation, /receiptLines: receiptLinesForPosting/);
});

test("invoice receiving loads shop destinations and sends the selected target on the existing receipt command", async () => {
  const [workspace, confirmation] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(confirmationUrl, "utf8"),
  ]);
  assert.match(workspace, /const receiptLocationId = run\?\.locationId \|\| locationId/);
  assert.match(workspace, /const receiptPositionIdentity = run\?\.id && receiptLocationId \? `\$\{run\.id\}:\$\{run\.version\}:\$\{receiptLocationId\}` : ""/);
  assert.match(workspace, /setReceiptPositions\(\[\]\);[\s\S]*setReceiptPositionsError\(""\);[\s\S]*\[receiptPositionIdentity\]/);
  assert.match(workspace, /\/api\/office\/inventory\/locations\/\$\{encodeURIComponent\(receiptLocationId\)\}\/positions/);
  assert.match(workspace, /onRetryPositions=\{\(\) => setReceiptPositionsReload\(\(value\) => value \+ 1\)\}/);
  assert.match(workspace, /positions=\{receiptPositions\} positionLoading=\{receiptPositionsLoading\} positionError=\{receiptPositionsError\}/);
  assert.match(workspace, /receiptLines: posting\.receiptLines \|\| \[\]/);
  assert.match(confirmation, /positions=\{positions\} positionLoading=\{positionLoading\} positionError=\{positionError\}/);
  assert.match(confirmation, /onClick=\{onRetryPositions\}/);
});

test("reviewed invoices require an explicit exact PO or truthful no-PO posting route", async () => {
  const [workspace, confirmation] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(confirmationUrl, "utf8"),
  ]);
  assert.match(workspace, /\/purchase-order-suggestions/);
  assert.match(workspace, /\["suggestions", "none", "ambiguous", "review_required"\]/);
  assert.match(workspace, /run\?\.id, run\?\.version, run\?\.status/);
  assert.match(workspace, /postingRoute: posting\.postingRoute/);
  assert.match(workspace, /allocationPlan: posting\.allocationPlan \|\| \[\]/);
  assert.match(workspace, /noPurchaseOrderReason: posting\.noPurchaseOrderReason \|\| ""/);
  assert.match(workspace, /invoice-receipt-command:\$\{run\.id\}/);
  assert.match(workspace, /localStorage\.removeItem\(commandStorageKey\)/);
  assert.match(confirmation, />Use this PO<\/Button>/);
  assert.match(confirmation, />No purchase order<\/Button>/);
  assert.match(confirmation, /selection\.postingRoute === "no_purchase_order" \? <label/);
  assert.match(confirmation, /purchaseOrderNumber \? `Reason for receiving without \$\{purchaseOrderNumber\}` : "Reason for receiving without a purchase order"/);
  assert.match(confirmation, /id=\{`\$\{checkboxId\}-no-po-reason`\} required maxLength=\{500\}/);
  assert.match(confirmation, /initialInvoicePostingSelection\(suggestion, draft\)/);
  assert.match(confirmation, /\[runId, runVersion, suggestion\]/);
});

test("PO suggestion loading, ambiguity and errors stay explicit and retryable", async () => {
  const confirmation = await readFile(confirmationUrl, "utf8");
  assert.match(confirmation, /Checking exact purchase order matches/);
  assert.match(confirmation, /More than one exact PO line/);
  assert.match(confirmation, /No exact purchase order matches/);
  assert.match(confirmation, /has no exact eligible line allocation/);
  assert.match(confirmation, /onClick=\{onRetrySuggestions\}/);
  assert.match(confirmation, /role="alert">\{suggestionError\}/);
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

test("invoice lines can match or create local catalog identity before review", async () => {
  const [source, dialog, styles] = await Promise.all([
    readFile(workspaceUrl, "utf8"),
    readFile(new URL("../inventory/CreateInventoryPartDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../inventory/create-inventory-part-dialog.css", import.meta.url), "utf8"),
  ]);
  assert.match(source, /<PartCatalogCombobox[\s\S]*catalogEndpoint="\/api\/office\/inventory\/catalog"/);
  assert.match(source, />Create new part<\/Button>/);
  assert.match(source, /Inventory is unchanged/);
  assert.match(source, /updateInvoiceLineField\(current, lineId, "partNumber", part\.partNumber\)/);
  assert.match(source, /updateInvoiceLineField\(next, lineId, "unitOfMeasure", part\.uomCode \|\| "ea"\)/);
  assert.match(source, /catalogPartId: part\.id/);
  assert.match(source, /\["partNumber", "unitOfMeasure"\][\s\S]*catalogPartId: _removed/);
  assert.match(dialog, /<ModalFrame[\s\S]*ariaLabelledBy=\{titleId\}[\s\S]*ariaDescribedBy=\{descriptionId\}/);
  assert.match(dialog, /No quantity or Odoo record will be created/);
  assert.match(dialog, /Odoo or supplier number/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*min-height: 44px/);
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
