import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";

test("inventory workspace is the single stock owner and delegates history to invoice intake", async () => {
  const workspace = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  const office = await readFile(new URL("../office/OfficeWorkspace.jsx", import.meta.url), "utf8");
  const admin = await readFile(new URL("../admin/workspace/AdminWorkspaceShell.jsx", import.meta.url), "utf8");
  assert.match(workspace, /\/api\/office\/inventory\/stock/);
  assert.match(workspace, /params\.set\("sort", stockSort\)/);
  assert.doesNotMatch(workspace, /filterAndSortStock\(items/);
  assert.match(workspace, /All locations/);
  assert.match(workspace, /aria-label="Refresh inventory"/);
  assert.match(workspace, /Filter stock by availability/);
  assert.match(workspace, /Sort inventory stock/);
  assert.match(workspace, /No matching stock/);
  assert.match(workspace, /Reset view/);
  assert.match(workspace, /aria-live="polite"/);
  assert.match(workspace, /<OperationalCollectionPage/);
  assert.match(workspace, /presentation=\{presentation\}/);
  assert.match(workspace, /<OperationalCollectionTabs/);
  assert.match(workspace, /<OperationalCollectionToolbar className="inventory-toolbar">/);
  assert.match(workspace, /<OperationalCollectionResultHeader className="inventory-results-line" aria-live="polite">/);
  assert.match(workspace, /<OperationalCollectionTable/);
  assert.match(workspace, /<OperationalCollectionRow/);
  assert.match(workspace, /<OperationalCollectionCell/);
  assert.match(workspace, /busy=\{refreshing\}/);
  assert.match(workspace, /Updating results/);
  assert.match(workspace, /stockLoaded/);
  assert.doesNotMatch(workspace, /\/api\/office\/inventory\/invoices/);
  assert.doesNotMatch(workspace, /Invoice history/);
  assert.doesNotMatch(workspace, /Inventory views/);
  assert.doesNotMatch(workspace, /inventory-workspace-header|inventory-workspace-heading|inventory-workspace-actions|inventory-stock-controls|inventory-stock-filters|inventory-stock-list|inventory-stock-head|inventory-stock-results/);
  assert.match(workspace, /stockStateLabel/);
  assert.match(workspace, />Invoice<\/Button>/);
  assert.doesNotMatch(workspace, /<span>Local inventory<\/span>/);
  assert.match(workspace, /aria-label="Upload invoices" title="Upload invoices" aria-haspopup="dialog"/);
  assert.match(workspace, /inventoryCountPanelPromise \|\|= import\("\.\/InventoryCountImportPanel\.jsx"\)[\s\S]*default: module\.InventoryCountImportPanel/);
  assert.match(workspace, /<Suspense fallback=/);
  assert.match(workspace, /invoiceWorkflowOpen \? \(\s*!workflowDetail \? <Button/);
  assert.match(workspace, /<InvoiceExtractionWorkspace embedded availableLocations=\{locations\} uploadOpen=\{invoiceUploadOpen\} onUploadOpenChange=\{setInvoiceUploadOpen\} onContextChange=\{updateWorkflowDetail\} \/>/);
  assert.match(workspace, /inventoryAction", "upload-invoice"/);
  assert.match(workspace, /<ContextBreadcrumbs/);
  assert.match(workspace, /workflowDetail\?\.label/);
  assert.match(workspace, /onClick: followWorkflowBreadcrumb/);
  assert.match(workspace, /onContextChange=\{updateWorkflowDetail\}/);
  assert.match(workspace, /href: inventoryUrl\(\)\.toString\(\)/);
  assert.match(workspace, /isPlainPrimaryActivation\(event\)/);
  assert.match(workspace, /event\.preventDefault\(\)/);
  assert.match(workspace, /document\.getElementById\(returnFocusId\)\?\.focus/);
  assert.doesNotMatch(workspace, />Back to inventory<\/Button>/);
  assert.match(office, /<InventoryWorkspace canApplyInventoryCount=\{false\} presentation="embedded" \/>/);
  assert.match(admin, /<InventoryWorkspace actorId=\{actor\?\.id\} canApplyInventoryCount=\{actor\?\.role === "admin"\} canReconcileAuthority=\{actor\?\.role === "admin"\} presentation="page" \/>/);
  assert.doesNotMatch(office, /<InvoiceExtractionWorkspace \/>/);
  assert.doesNotMatch(admin, />Invoices<\/button>/);
});

test("inventory stock opens the shared secondary part detail window", async () => {
  const workspace = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  const panel = await readFile(new URL("../../components/ui/SecondaryDetailPanel.jsx", import.meta.url), "utf8");
  const panelStyles = await readFile(new URL("../../components/ui/secondary-detail-panel.css", import.meta.url), "utf8");

  assert.match(workspace, /SecondaryDetailPanel/);
  assert.match(workspace, /aria-haspopup="dialog"/);
  assert.match(workspace, /setSelectedStockKey/);
  assert.match(workspace, /<SecondaryDetailSection title="Locations">/);
  assert.doesNotMatch(workspace, /Odoo reference/);
  assert.match(workspace, /Odoo · read-only/);
  assert.match(workspace, /Our inventory/);
  assert.match(workspace, /setSelectedLocationId/);
  assert.doesNotMatch(workspace, /Application inventory is separate from the read-only Odoo quantity reference/);
  assert.doesNotMatch(workspace, /These records belong in this part window/);
  assert.doesNotMatch(workspace, /aria-pressed=\{tab ===/);
  assert.match(panel, /ModalOverlay/);
  assert.match(panel, /isDismissable=\{dismissable\}/);
  assert.match(panel, /Heading slot="title"/);
  assert.match(panel, /Close details/);
  assert.match(panelStyles, /justify-content: flex-end/);
  assert.match(panelStyles, /prefers-reduced-motion: reduce/);
});

test("inventory selection identity stays stable when a display unit changes", async () => {
  const workspace = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /return `\$\{item\.companyId\}:\$\{item\.catalogPartId\}`/);
  assert.doesNotMatch(workspace, /return `\$\{item\.companyId\}:\$\{item\.catalogPartId\}:\$\{item\.uomCode\}`/);
});

test("part identity editing remains inside the part detail drawer", async () => {
  const [workspace, editor, model, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./PartIdentityEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("./part-identity-editor-model.js", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /<PartIdentityEditor/);
  assert.match(workspace, /id="inventory-edit-part"/);
  assert.match(workspace, /!partIdentityEditOpen && !partIdentityBusy/);
  assert.match(workspace, /partIdentityRefreshPending/);
  assert.match(workspace, /hasRefreshedPartIdentityVersion\(refreshedItem, partIdentityRefreshPending\)/);
  assert.match(workspace, /disabled=\{Boolean\(partIdentityRefreshPending\)\}/);
  assert.match(workspace, /dismissable=\{!partIdentityEditOpen\}/);
  assert.match(workspace, /onClose=\{partIdentityEditOpen \? closePartIdentityEditor : null\}/);
  assert.match(workspace, /closeDisabled=\{partIdentityBusy\}/);
  assert.match(workspace, /Discard part identity edits/);
  assert.match(workspace, /<SecondaryDetailSection\s+title="Part identity"/);
  assert.match(workspace, /Reference numbers/);
  assert.match(workspace, /<dt>Part name<\/dt>/);
  assert.match(workspace, /<dt>In Odoo<\/dt>/);
  assert.match(workspace, /In Odoo: \{item\.odooName/);
  assert.match(editor, /\/api\/office\/inventory\/parts\/\$\{encodeURIComponent\(part\.catalogPartId\)\}/);
  assert.match(editor, /method: "PATCH"/);
  assert.match(editor, /partIdentityPayload\(draft, part\.version\)/);
  assert.match(editor, /FormErrorSummary/);
  assert.match(editor, /ActionFooter stickyOnMobile/);
  assert.match(editor, /role="alert"/);
  assert.match(editor, /Reload details/);
  assert.match(editor, /partIdentityConflict\(error\)/);
  assert.match(editor, /conflict\.kind === "stale"/);
  assert.match(model, /INVENTORY_PART_STALE/);
  assert.match(model, /INVENTORY_PART_IDENTITY_CONFLICT/);
  assert.match(editor, />Add reference</);
  assert.match(editor, /Remove reference number \$\{index \+ 1\}/);
  assert.match(editor, /MAX_REFERENCE_NUMBERS/);
  assert.match(editor, /UnitOfMeasurePicker/);
  assert.match(editor, /allowedUomCodes/);
  assert.match(editor, /Choose an equivalent label; inventory quantities stay unchanged/);
  assert.match(editor, /inventory-part-editor-summary/);
  assert.match(editor, /label="Part name" hint=\{providerManaged/);
  assert.match(editor, /part\.odooName \|\| "Name not provided by Odoo"/);
  assert.match(editor, /Your Part name is saved only in this system/);
  assert.match(model, /uomCode/);
  assert.match(styles, /\.inventory-part-editor-reference-row/);
  assert.match(styles, /\.inventory-part-editor-grid/);
  assert.match(styles, /grid-template-columns: minmax\(0, 1fr\) 44px/);
  assert.match(styles, /\.inventory-part-editor-remove/);
  assert.match(styles, /@media \(max-width: 760px\)/);
  const panel = await readFile(new URL("../../components/ui/SecondaryDetailPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /onClose = null/);
  assert.match(panel, /closeDisabled = false/);
  assert.match(panel, /disabled=\{closeDisabled\}/);
  assert.match(panel, /onClose \? onClose\(\) : close\(\)/);
});

test("inventory availability filters use the shared collection template without legacy page geometry", async () => {
  const [workspace, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /Filter stock by availability/);
  assert.match(workspace, /No matching stock/);
  assert.match(workspace, /use Reset view above/);
  assert.match(workspace, /className=\{`inventory-stock-table\$\{refreshing \? " is-refreshing" : ""\}`\}/);
  assert.match(workspace, /<Pagination currentPage=\{stockPage\} pageCount=\{stockMeta\.pageCount\} setPage=\{setStockPage\} total=\{stockMeta\.total\} label="parts" loading=\{refreshing\} \/>/);
  assert.match(styles, /\.inventory-stock-table\.is-refreshing/);
  assert.doesNotMatch(styles, /\.inventory-workspace \{|\.inventory-workspace-header|\.inventory-workspace-heading|\.inventory-workspace-actions|\.inventory-stock-controls|\.inventory-stock-filters|\.inventory-stock-list|\.inventory-stock-head|\.inventory-stock-results|\.inventory-stock-row:hover|\.inventory-stock-row:focus-visible/);
  assert.match(styles, /\.inventory-results-progress/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("part location drilldown creates and prints serialized child QR labels", async () => {
  const panel = await readFile(new URL("./PartSerializationPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /Serialized units/);
  assert.match(panel, /Print all/);
  assert.match(panel, /Print QR/);
  assert.match(panel, /\/api\/office\/inventory\/units\/\$\{encodeURIComponent\(selectedUnitId\)\}/);
  assert.match(panel, /inventory-unit-timeline-title/);
  assert.match(panel, /backRef\.current\?\.focus\(\)/);
  assert.match(panel, /requestAnimationFrame.*data-unit-id/s);
  assert.match(panel, /Created.*selectedUnit\.createdBy/s);
  assert.match(panel, /selectedUnit\.labelBatch\.printUrl/);
  assert.match(panel, /Print batch/);
  assert.match(panel, /physically_present_at_location/);
  assert.match(panel, /crypto\.randomUUID\(\)/);
  assert.match(panel, /canCreateAtLocation/);
  assert.match(panel, /No serialized children yet/);
  assert.match(panel, /createOpen/);
  assert.match(panel, />Add units<\/Button>/);
  assert.match(panel, /aria-label="Close add units"/);
  assert.match(panel, /autoFocus type="number"/);
  assert.doesNotMatch(panel, /Add serialized physical units/);
  assert.doesNotMatch(panel, /Application inventory and Odoo reference are kept separate/);
});

test("inventory files use server pagination and accessible upload dialog", async () => {
  const [panel, sharedDialog, sharedStyles] = await Promise.all([
    readFile(new URL("./InventoryCountImportPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/ui/UploadDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/ui/upload-dialog.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /count-imports\?page=\$\{importPage\}&pageSize=10/);
  assert.match(panel, /pageCount: Number\(result\.pageCount\) \|\| 1/);
  assert.match(panel, /<UploadDialog title="Add inventory"/);
  assert.match(panel, /isDismissable=\{!uploading\}/);
  assert.match(panel, /<UploadDropzone inputId="inventory-count-file"/);
  assert.match(panel, /closeLabel="Close inventory upload"/);
  assert.match(sharedDialog, /<ModalOverlay/);
  assert.match(sharedDialog, /aria-labelledby=\{titleId\}/);
  assert.match(sharedDialog, /className="shared-upload-native-input"/);
  assert.match(sharedDialog, /aria-live="assertive"/);
  assert.match(sharedStyles, /\.shared-upload-dropzone/);
  assert.match(sharedStyles, /@media \(max-width:700px\)/);
  assert.match(panel, /<Pagination currentPage=\{importPage\}/);
  assert.match(panel, /label: stocktake\.sourceFileName \|\| "Inventory file"/);
  assert.match(panel, /onBack: showFileList/);
  assert.match(panel, /onContextChange\?\.\(null\)/);
  assert.doesNotMatch(panel, /Back to uploaded files/);
  assert.match(panel, /data-inventory-import=\{entry\.id\}/);
  assert.match(panel, /returnFocusImportIdRef/);
});

test("only the admin workspace enables applying physically counted inventory", async () => {
  const [workspace, panel, admin, office] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryCountImportPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../admin/workspace/AdminWorkspaceShell.jsx", import.meta.url), "utf8"),
    readFile(new URL("../office/OfficeWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(admin, /<InventoryWorkspace actorId=\{actor\?\.id\} canApplyInventoryCount=\{actor\?\.role === "admin"\} canReconcileAuthority=\{actor\?\.role === "admin"\} presentation="page" \/>/);
  assert.match(office, /<InventoryWorkspace canApplyInventoryCount=\{false\} presentation="embedded" \/>/);
  assert.match(workspace, /canApplyInventoryCount=\{canApplyInventoryCount\}/);
  assert.match(panel, /stocktake\.readyCount && canApplyInventoryCount/);
  assert.match(panel, /An administrator must confirm the physical count before adding inventory/);
  assert.match(panel, /\/apply/);
});

test("invoice approval uses local posting instead of the Odoo receipt action", async () => {
  const [workspace, inventory, history] = await Promise.all([
    readFile(new URL("../office/InvoiceExtractionWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("../office/InvoiceHistoryPanel.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /\/confirm-receipt/);
  assert.match(workspace, /confirmation: "all_received_undamaged"/);
  assert.match(workspace, /expectedVersion: run\.version/);
  assert.match(workspace, /receipt\.labelBatch\.printUrl/);
  assert.doesNotMatch(inventory, /invoice\.receipt\?\.labelBatch\?\.status/);
  assert.match(history, /invoice\.receipt\?\.labelBatch\?\.status/);
  assert.match(history, /Print QRs/);
  assert.match(workspace, /unit\.qrSvgUrl/);
  assert.match(workspace, /unit\.serialNumber/);
  assert.match(workspace, /receipt\.units\.slice\(0, 12\)/);
  assert.doesNotMatch(workspace, /\/post-inventory/);
  assert.doesNotMatch(workspace, /Receive in Odoo & create labels/);
});
