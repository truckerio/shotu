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
  assert.match(workspace, /<IconButton className="inventory-refresh-button" icon=\{RefreshCw01\} label="Refresh inventory"/);
  assert.match(workspace, /Filter stock by availability/);
  assert.match(workspace, /Sort inventory stock/);
  assert.match(workspace, /<option value="low_stock_first">Low stock first<\/option>/);
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
  assert.match(workspace, />Upload invoice<\/Button>/);
  assert.doesNotMatch(workspace, /id="inventory-invoice-action"/);
  assert.doesNotMatch(workspace, /<span>Local inventory<\/span>/);
  assert.match(workspace, /<IconButton className="inventory-invoice-upload-button" icon=\{UploadCloud02\} label="Upload invoices" aria-haspopup="dialog"/);
  assert.match(workspace, /inventoryCountPanelPromise \|\|= import\("\.\/InventoryCountImportPanel\.jsx"\)[\s\S]*default: module\.InventoryCountImportPanel/);
  assert.match(workspace, /<Suspense fallback=/);
  assert.match(workspace, /invoiceWorkflowOpen \? \(\s*!workflowDetail \? <IconButton/);
  assert.match(workspace, /const \[invoiceRunId, setInvoiceRunId\] = useState\(\(\) => initialParams\.get\("invoiceRun"\) \|\| ""\)/);
  assert.match(workspace, /setInvoiceRunId\(invoiceRun\)/);
  assert.match(workspace, /<InvoiceExtractionWorkspace embedded availableLocations=\{locations\} initialLocationId=\{locations\.some\(\(location\) => location\.id === locationId\) \? locationId : ""\} initialRunId=\{invoiceRunId\} uploadOpen=\{invoiceUploadOpen\} onUploadOpenChange=\{setInvoiceUploadOpen\} onContextChange=\{updateWorkflowDetail\} \/>/);
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
  assert.match(office, /<InventoryWorkspace actorId=\{actor\?\.id\} canApplyInventoryCount=\{false\} presentation="embedded" \/>/);
  assert.match(admin, /<InventoryWorkspace actorId=\{actor\?\.id\} canApplyInventoryCount=\{actor\?\.role === "admin"\} canReconcileAuthority=\{actor\?\.role === "admin"\} presentation="page" \/>/);
  assert.doesNotMatch(office, /<InvoiceExtractionWorkspace \/>/);
  assert.doesNotMatch(admin, />Invoices<\/button>/);
});

test("Inbound owns the global arrival and invoice entry points while Purchasing keeps contextual supplier intake", async () => {
  const [workspace, purchases, needsOrdering] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryPurchases.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryNeedsOrdering.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(purchases, /label:'Needs ordering'/);
  assert.match(purchases, /label:'Purchase orders'/);
  assert.doesNotMatch(purchases, /label:'Expected deliveries'/);
  assert.doesNotMatch(purchases, /InventoryPurchaseRequests|New request|Approval waiting/);
  assert.match(purchases, /onInvoice\?\.\(locationId\)/);
  assert.match(needsOrdering, /onInvoice\?\.\(locationId\)/);
  assert.match(needsOrdering, />Add supplier invoice<\/Button>/);
  assert.match(needsOrdering, />Create order<\/Button>/);
  assert.doesNotMatch(needsOrdering, /Add to PO|Create PO from selected/);
  assert.match(purchases, /demandDraftId=\{demandDraft\?\.key\|\|''\}/);
  assert.match(purchases, /onDemandOrderFinished=\{finishDemandOrder\}/);
  assert.match(purchases, /storageKey\}:demand:\$\{demandDraftId\}/);
  assert.match(purchases, /localStorage\.removeItem\(draftStorageKey\)/);
  assert.match(purchases, /inventory-purchase-demand-handoff:/);
  assert.match(purchases, /localStorage\.getItem\(demandHandoffKey\)/);
  assert.match(purchases, /localStorage\.removeItem\(demandHandoffKey\)/);
  assert.match(workspace, /onInvoice=\{\(requestedLocationId\)=>openInvoiceWorkflow\("", requestedLocationId\)\}/);
  assert.match(workspace, /setLocationId\(requestedLocationId\)/);
  assert.match(workspace, /<InventoryInboundWorkspace/);
  assert.match(workspace, /onReceivePurchaseOrder=\{\(poId\) => \{ setInboundReceiptOrderId\(poId\); setInventorySection\('purchases'\); \}\}/);
  assert.match(workspace, /onAddInventory=\{\(requestedLocationId\) => setReceivingPart\(\{ receiptLocationId: requestedLocationId \}\)\}/);
});

test("Inbound is a server-backed list and detail handoff workspace", async () => {
  const inbound = await readFile(new URL("./InventoryInboundWorkspace.jsx", import.meta.url), "utf8");
  assert.match(inbound, /api\(inboundRequestUrl\(\{ view, locationId, query, page \}\)\)/);
  assert.match(inbound, /ariaLabel="Inbound views"/);
  assert.match(inbound, /aria-label="Inbound shop"/);
  assert.match(inbound, /aria-label="Search inbound work"/);
  assert.match(inbound, /role="alert"/);
  assert.match(inbound, />Retry<\/Button>/);
  assert.match(inbound, /<SecondaryDetailPanel/);
  assert.match(inbound, /onReceivePurchaseOrder\?\.\(item\.poId, item\.locationId\)/);
  assert.match(inbound, /onAddInventory\?\.\(item\.locationId\)/);
  assert.match(inbound, /onUploadInvoice\?\.\(item\.locationId\)/);
});

test("Inventory Tasks is one actor-aware queue that routes work to canonical owners", async () => {
  const [workspace, queue, model, styles, stockTasks, custody, locationStock] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryTaskQueue.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-task-queue-model.js", import.meta.url), "utf8"),
    readFile(new URL("./inventory-task-queue.css", import.meta.url), "utf8"),
    readFile(new URL("./InventoryStockTasks.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryCustodyWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationStockWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /<InventoryTaskQueue locations=\{locations\} onOpenTask=\{openTaskOwner\}/);
  assert.match(workspace, /<IconButton icon=\{ArrowLeft\} label="Back to My work" onClick=\{closeTaskOwner\} \/>/);
  assert.doesNotMatch(workspace, /<Button type="button" onClick=\{closeTaskOwner\}>Back to My work<\/Button>/);
  assert.doesNotMatch(workspace, /ariaLabel="Inventory tasks" activeId=\{taskSection\}/);
  assert.match(workspace, /task\.sourceType === "damage_inspection"/);
  assert.match(workspace, /task\.sourceType === "transfer_receipt"/);
  assert.match(workspace, /openStockTransfer/);
  assert.match(workspace, /setTaskSection\('transfer'\)/);
  assert.match(workspace, /task\.sourceType === "removed_part_custody"/);
  assert.match(workspace, /\["position_recount", "position_count_review"\]\.includes\(task\.sourceType\)/);
  assert.match(workspace, /task\.sourceType === "invoice_po_decision"/);
  assert.match(workspace, /task\.sourceType === "missing_invoice"/);
  assert.match(workspace, /task\.sourceType === "receipt_exception"/);
  assert.match(workspace, /initialReceiptId=\{inboundSource\.receiptId\} initialDeliveryId=\{inboundSource\.deliveryId\}/);
  assert.match(workspace, /initialTaskId=\{taskWorkflow\.task\?\.sourceId \|\| ""\}/);
  assert.match(workspace, /initialCaseId=\{taskWorkflow\.task\.sourceId\}/);
  assert.match(workspace, /initialPositionId=\{stockLocationInitialPosition\}/);
  for (const parameter of ["taskId", "reuseCaseId", "positionId", "receiptId", "deliveryId"]) assert.match(workspace, new RegExp(`"${parameter}"`));
  assert.match(queue, /api\("\/api\/office\/inventory\/task-queue\/assignments"/);
  assert.match(queue, /inventoryTaskQueueUrl\(\{ view, locationId, sourceType, search, page \}\)/);
  assert.match(queue, /inventoryTaskDetailUrl\(locator\)/);
  assert.match(queue, /ariaLabel="Inventory task views"/);
  assert.match(queue, /ariaLabel="Inventory task queue"/);
  assert.match(queue, /item\.statusLabel/);
  assert.match(queue, /item\.nextAction/);
  assert.match(queue, /item\.blocker/);
  assert.match(queue, /taskOwnerLabel\(item\)/);
  assert.match(queue, /taskAgeLabel\(item\.ageSeconds\)/);
  assert.match(queue, />Claim task<\/Button>/);
  assert.match(queue, />Return to team<\/Button>/);
  assert.match(queue, /isRecoverableTaskError\(next\)/);
  assert.match(queue, /taskSelectionFromSearch/);
  assert.match(queue, /taskSelectionUrl\(task\)/);
  assert.match(queue, /isPlainPrimaryActivation\(event\)/);
  assert.match(model, /view = "my_work"/);
  assert.match(model, /sourceVersion: task\.sourceVersion/);
  assert.match(model, /expectedAssignmentVersion: task\.assignmentVersion/);
  assert.doesNotMatch(queue, /replaceAll\("_"/);
  assert.match(styles, /min-height: 44px/);
  assert.match(styles, /@media \(max-width: 480px\)/);
  assert.match(stockTasks, /initialTaskId=""/);
  assert.match(stockTasks, /\/api\/office\/inventory\/stock-tasks\/\$\{encodeURIComponent\(initialTaskId\)\}/);
  assert.match(stockTasks, /new URLSearchParams\(\{locationId,kind\}\)/);
  assert.match(stockTasks, /setSelected\(result\.task\)/);
  assert.match(stockTasks, /initialTaskError/);
  assert.doesNotMatch(stockTasks, /data\.items\.find\(item=>item\.id===initialTaskId\)/);
  assert.match(custody, /initialCaseId = ""/);
  assert.match(custody, /\/api\/inventory-reuse\/cases\/\$\{encodeURIComponent\(initialCaseId\)\}/);
  assert.match(custody, /openCase\(result\.case\)/);
  assert.match(custody, /initialCaseError/);
  assert.doesNotMatch(custody, /queue\.items\.find\(\(item\) => item\.id === initialCaseId\)/);
  assert.match(locationStock, /initialPositionId = ""/);
  assert.match(locationStock, /setSelectedPositionId\(initialPositionId\)/);
});

test("inventory sections own their page titles and actions instead of a persistent shell header", async () => {
  const [workspace, locationsWorkspace, locationStock, styles, locationStyles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationStockWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
    readFile(new URL("./inventory-locations-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.doesNotMatch(workspace, /Parts inventory|Owned by this system and organized by shop/);
  assert.match(workspace, /inventory-workspace[^`]*is-section-root/);
  assert.match(workspace, /<OperationalCollectionSectionHeader ariaLabel="Other inventory sections" activeId=\{inventorySection\}/);
  assert.match(workspace, /actions=\{sectionActions\}/);
  assert.match(workspace, /headingLevel=\{presentation === "embedded" \? 2 : 1\}/);
  assert.match(workspace, /inventorySection === "stock" \? stockActions : inventorySection === "inbound" \? inboundActions : inventorySection === "tasks" \? taskActions : null/);
  assert.doesNotMatch(workspace, /InventoryLocationsWorkspace|Storage layout/);
  assert.match(workspace, /function openStockByLocation\(shopId = ""\)/);
  assert.match(workspace, /setStockMode\("location"\);/);
  assert.match(workspace, /onOpenLocations=\{openStockByLocation\}[\s\S]*onImportCount=\{openCountWorkflow\}/);
  assert.doesNotMatch(workspace, /className="inventory-shop-select"/);
  assert.match(locationsWorkspace, /!activeLocationId \? <div className="inventory-shop-list" aria-label="Locations">/);
  assert.match(locationsWorkspace, /onClick=\{\(\) => openShop\(entryId\)\}/);
  assert.match(locationsWorkspace, /<IconButton icon=\{ArrowLeft\} label="Back to all locations" onClick=\{closeShop\} \/>/);
  assert.match(locationsWorkspace, />\s*Add location\s*<\/Button>/);
  assert.doesNotMatch(locationsWorkspace, /Add top-level/);
  assert.match(locationsWorkspace, />\s*Add sublocation\s*<\/Button>/);
  assert.match(locationsWorkspace, /canContainSublocations\(selected\.kind\)/);
  assert.match(locationsWorkspace, /aria-label="Sublocations"/);
  assert.match(locationsWorkspace, /visibleLocationTree\(loadedLocations, expandedPositionIds, query\)/);
  assert.match(locationsWorkspace, /className="inventory-location-tree-items" role="tree"/);
  assert.match(locationsWorkspace, /role="treeitem"/);
  assert.match(locationsWorkspace, /aria-selected=\{locationId\(location\) === locationId\(selected\)\}/);
  assert.match(locationsWorkspace, /aria-expanded=\{hasChildren \? isExpanded : undefined\}/);
  assert.match(locationsWorkspace, /togglePosition\(locationId\(location\)\)/);
  assert.match(locationsWorkspace, /className="inventory-location-breadcrumb" aria-label="Location path"/);
  assert.match(locationsWorkspace, /\.\.\.positionStorageDefaults\(event\.target\.value\)/);
  assert.match(locationsWorkspace, /aria-label=\{editor\.parentId \? "Sublocation type" : "Location type"\}/);
  assert.match(locationsWorkspace, /\{editor \|\| selected \? <section className="inventory-location-detail"/);
  assert.match(locationsWorkspace, /inventory-location-layout\$\{editor \|\| selected \? " has-detail" : ""\}/);
  assert.match(locationsWorkspace, /label="Back to location hierarchy" onClick=\{closePositionDetail\}/);
  assert.match(locationStyles, /\.inventory-location-layout \{[\s\S]*?grid-template-columns: minmax\(0, 1fr\);/);
  assert.match(locationStyles, /\.inventory-location-layout\.has-detail \{[\s\S]*?grid-template-columns: minmax\(280px, \.78fr\) minmax\(0, 1\.22fr\);/);
  assert.match(locationStyles, /\.inventory-location-tree-row \{[\s\S]*?--location-depth/);
  assert.match(locationsWorkspace, /depth > 0 \? " is-child"/);
  assert.match(locationStock, /depth > 0 \? " is-child"/);
  assert.match(locationStyles, /\.inventory-location-tree-row\.is-child[\s\S]*?background: #f8faff/);
  assert.match(locationStyles, /\.inventory-location-tree-row\.is-deep-child[\s\S]*?background: #f4f7fc/);
  assert.match(locationStyles, /\.inventory-location-breadcrumb ol \{/);
  assert.match(locationStyles, /@media \(max-width: 700px\)[\s\S]*?\.inventory-location-layout\.has-detail \.inventory-location-tree \{ display: none; \}/);
  assert.match(locationsWorkspace, /const activeLocationId = shopId;/);
  assert.doesNotMatch(locationsWorkspace, /aria-label="Shop location"/);
  assert.match(styles, /\.inventory-workspace\.is-section-root > \.page-header \{ display: none; \}/);
  assert.match(styles, /\.inventory-workspace\.is-section-root > \.operational-collection-page-body \{ margin-top: 0; \}/);
});

test("stock has peer part and location modes with contextual physical counts", async () => {
  const [workspace, locationsWorkspace, locationStock] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationsWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationStockWorkspace.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /const \[stockMode, setStockMode\] = useState\(\(\) => initialParams\.get\("stockMode"\) === "location" \? "location" : "part"\)/);
  assert.match(workspace, /ariaLabel="Inventory stock view"/);
  assert.match(workspace, /label: "By part"/);
  assert.match(workspace, /label: "By location"/);
  assert.match(workspace, /<InventoryLocationStockWorkspace locations=\{locations\} initialShopId=\{stockLocationInitialShop\} initialPositionId=\{stockLocationInitialPosition\}[\s\S]*canApplyInventoryCount=\{canApplyInventoryCount\}[\s\S]*onOpenPart=\{openLocationPart\}[\s\S]*onAddStock=/);
  assert.doesNotMatch(workspace, /inventory-count-action|Storage layout|InventoryLocationsWorkspace/);
  assert.match(locationsWorkspace, /<h2 id="inventory-locations-title">Storage layout<\/h2>/);
  assert.doesNotMatch(locationsWorkspace, /PositionCountPanel/);
  assert.match(locationStock, /\/api\/office\/inventory\/locations\/\$\{encodeURIComponent\(shopId\)\}\/positions\/\$\{encodeURIComponent\(selectedPositionId\)\}\/stock\?scope=\$\{scope\}/);
  assert.match(locationStock, /<option value="direct">This location only<\/option>/);
  assert.match(locationStock, /<option value="subtree">This location and sublocations<\/option>/);
  assert.match(locationStock, /item\.placements/);
  assert.match(locationStock, /compactPlacementPath\(placement/);
  assert.match(locationStock, /inventory-location-stock-placements/);
  assert.match(locationStock, /function arrivalTarget\(position, positionId\)/);
  assert.match(locationStock, /position\.systemKey === "receiving"/);
  assert.match(locationStock, /position\.systemKey != null \|\| position\.usage !== "storage" \|\| position\.isPickable !== true/);
  assert.match(locationStock, /inventory-location-layout inventory-location-stock-layout\$\{selected \? " has-detail" : ""\}/);
  assert.match(locationStock, /<PositionCountPanel key=\{`\$\{shopId\}:\$\{selectedPositionId\}`\} location=\{\{ id: shopId \}\} position=\{selected\}[\s\S]*canApplyInventoryCount=\{canApplyInventoryCount\}/);
  assert.match(locationStock, /selectedIsCountableLeaf \? <PositionCountPanel/);
  assert.match(locationStock, /selectedHasChildren = Boolean\(selected && positions\.some/);
  assert.match(locationStock, /key=\{`\$\{shopId\}:\$\{selectedPositionId\}`\}/);
  const countPanel = await readFile(new URL("./PositionCountPanel.jsx", import.meta.url), "utf8");
  assert.match(countPanel, /const activeStorageKey = useRef\(storageKey\)/);
  assert.match(countPanel, /isActiveStorageKey\(requestKey\)/);
  assert.match(countPanel, /countMatchesPosition\(result\.count\)/);
  assert.match(countPanel, /\/identities/);
  assert.match(countPanel, /inputMode: serialInputMode/);
  assert.match(countPanel, /alreadyObserved/);
  assert.match(countPanel, /INVENTORY_POSITION_SERIAL_WRONG_POSITION/);
  assert.match(countPanel, /System snapshot<\/small>/);
  assert.match(countPanel, /Counted<\/small>/);
  assert.match(countPanel, /Difference<\/small>/);
  assert.match(countPanel, /\/submit/);
  assert.match(countPanel, />Finish count<\/Button>/);
  assert.match(countPanel, /<IconButton icon=\{ArrowLeft\} label="Back to location stock" onClick=\{\(\) => setExpanded\(false\)\} disabled=\{busy\} \/>/);
  assert.doesNotMatch(countPanel, />Back<\/Button>/);
  assert.match(countPanel, /status === "applied" && applyReason\.startsWith\("Physical count verified"\).*"Verified"/);
  assert.doesNotMatch(countPanel, /Apply reason/);
  assert.match(locationStock, /onModeChange=\{setCountMode\}/);
  assert.doesNotMatch(locationStock, /countIntent|Choose a shelf or bin to count/);
  assert.match(locationStock, /initialShopId && initialShopId !== shopId/);
  assert.doesNotMatch(locationStock, /autoStart/);
  assert.doesNotMatch(countPanel, /autoStart/);
  assert.match(countPanel, /\{count \? "Resume count" : "Physical count"\}/);
  assert.match(countPanel, /count\.createdBy\?\.name/);
  assert.match(countPanel, /count\.applyReason/);
  assert.match(locationStock, /handleTreeKey/);
  assert.match(locationStock, /event\.key === "ArrowRight"/);
  assert.match(locationStock, /role="treeitem"/);
  const locationStyles = await readFile(new URL("./inventory-locations-workspace.css", import.meta.url), "utf8");
  assert.match(locationStyles, /\.inventory-location-stock-detail \{[^}]*grid-template-rows: repeat\(4, auto\);[^}]*align-content: start;/);
});

test("stock starts unified add stock and keeps location count handoffs", async () => {
  const [workspace, dialog] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./AddInventoryStockDialog.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, />Add stock<\/Button>/);
  assert.doesNotMatch(workspace, /id="inventory-physical-count-action"/);
  assert.doesNotMatch(workspace, /const stockActions = <[^;]*>Starting inventory<\/Button>/s);
  assert.match(workspace, />Record arrival<\/Button>/);
  assert.match(workspace, /function openStockByLocation\(shopId = ""\)[\s\S]*setStockMode\("location"\)[\s\S]*stockMode: "location"/);
  assert.doesNotMatch(workspace, /openPhysicalCountByLocation|physicalCountMode|countIntent/);
  assert.match(workspace, /onOpenLocations=\{openStockByLocation\}/);
  assert.match(workspace, /const taskActions = !taskWorkflow \? <Button[^>]*onClick=\{openPhysicalCountTasks\}>Physical counts<\/Button>/);
  assert.match(workspace, /function openPhysicalCountTasks\(\)[\s\S]*setTaskSection\("count"\)[\s\S]*taskOwner: "count"/);
  assert.match(workspace, /owner === "count" && !initialParams\.get\("taskId"\)/);
  assert.match(workspace, /countWorkflowOpen \? "Starting inventory"/);
  assert.match(workspace, /onAddStock=\{\(\{ part, shopId, positionId, positionPath \}\) => setReceivingPart/);
  assert.match(workspace, /receiptPositionPath: positionPath, lockReceiptLocation: true/);
  assert.match(workspace, /onOpenStartingInventory=\{\(shopId\) => \{ if \(shopId\) setLocationId\(shopId\); openCountWorkflow\(\); \}\}/);
  assert.match(dialog, /PartCatalogCombobox locationId=\{shopId\} purpose="master_match" catalogEndpoint="\/api\/office\/inventory\/catalog"/);
  assert.match(dialog, /initialPositionId = ""/);
  assert.match(dialog, /lockLocation = false/);
  assert.match(dialog, /contextualLocationLocked \? <div className="add-inventory-fixed-destination"/);
  assert.match(dialog, /targetLocked=\{contextualLocationLocked\}/);
  assert.match(workspace, /lockLocation=\{Boolean\(receivingPart\.lockReceiptLocation\)\}/);
  assert.doesNotMatch(dialog, /value="physical_count"|Open stock by location|Import count sheet/);
  assert.match(dialog, /ReceiptLinesEditor mode="direct-arrival"/);
  assert.match(dialog, /positions=\{positions\}/);
});

test("Purchases posts one tracking-aware partial receipt instead of marking a whole PO received first", async () => {
  const purchases = await readFile(new URL("./InventoryPurchases.jsx", import.meta.url), "utf8");
  assert.match(purchases, /ReceiptLinesEditor/);
  assert.match(purchases, /\/api\/office\/inventory\/purchasing\/\$\{encodeURIComponent\(receiptOrder\.id\)\}\/receipts/);
  assert.match(purchases, /receiptLinePayload\(receiptLines\)/);
  assert.match(purchases, />Receive items<\/Button>/);
  assert.match(purchases, /Post received items/);
  assert.doesNotMatch(purchases, /all_ordered_goods_received/);
  assert.doesNotMatch(purchases, /Have all outstanding parts/);
});

test("purchase-order receiving loads exact destinations and preserves them in the shared receipt payload", async () => {
  const purchases = await readFile(new URL("./InventoryPurchases.jsx", import.meta.url), "utf8");
  assert.match(purchases, /const receiptPositionIdentity=receiptOrder&&locationId\?`\$\{receiptOrder\.id\}:\$\{receiptOrder\.version\}:\$\{locationId\}`:''/);
  assert.match(purchases, /setReceiptPositions\(\[\]\);setReceiptPositionsError\(''\)/);
  assert.match(purchases, /\/api\/office\/inventory\/locations\/\$\{encodeURIComponent\(locationId\)\}\/positions/);
  assert.match(purchases, /setReceiptPositionsReload\(value=>value\+1\)/);
  assert.match(purchases, /runId=\{receiptOrder\.id\} runVersion=\{receiptOrder\.version\} positions=\{receiptPositions\} positionLoading=\{receiptPositionsLoading\} positionError=\{receiptPositionsError\}/);
  assert.match(purchases, /receiptLinePayload\(receiptLines\)\.map\(\(\{invoiceLineIndex:_invoiceLineIndex,\.\.\.line\}\)=>line\)/);
  assert.doesNotMatch(purchases, /targetPositionId:_targetPositionId/);
  assert.match(purchases, /receiptKeyRef\.current=crypto\.randomUUID\(\);setError\(''\);setReceiptOrder\(order\)/);
  assert.match(purchases, /catch\(e\)\{if\(e\?\.code==='INVENTORY_RECEIPT_POSITION_INVALID'\)setReceiptPositionsReload\(value=>value\+1\);setError\(e\.message\|\|'The receipt could not be posted\.'\);\}finally/);
  assert.equal(purchases.includes('{error?<p role="alert" className="ops-error">{error}</p>:null}<ReceiptLinesEditor'), true);
});

test("purchase-order invalid target reloads eligible positions and keeps the error visible", async () => {
  const purchases = await readFile(new URL("./InventoryPurchases.jsx", import.meta.url), "utf8");
  assert.match(purchases, /e\?\.code==='INVENTORY_RECEIPT_POSITION_INVALID'/);
  assert.match(purchases, /setReceiptPositionsReload\(value=>value\+1\)/);
  assert.match(purchases, /setError\(e\.message\|\|'The receipt could not be posted\.'\)/);
});

test("direct receipt reloads stale destinations while retaining its recoverable draft", async () => {
  const dialog = await readFile(new URL("./AddInventoryStockDialog.jsx", import.meta.url), "utf8");
  assert.match(dialog, /nextError\?\.code === "INVENTORY_RECEIPT_POSITION_INVALID"\) setPositionReload\(\(value\) => value \+ 1\)/);
  assert.match(dialog, /setError\(directReceiptErrorMessage\(nextError\)\)/);
  assert.match(dialog, /persist\(\{ \.\.\.draft, attempt: null \}\)/);
  assert.match(dialog, /positions=\{positions\} positionLoading=\{positionLoading\} positionError=\{positionError\}/);
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
  assert.match(workspace, /Selling · \{partHeaderPrice\.scopeKey === partHeaderPriceScopeKey/);
  assert.doesNotMatch(workspace, /Our inventory available|Our inventory 0/);
  assert.match(workspace, /setSelectedLocationId/);
  assert.match(workspace, /aria-label="Part detail pages"/);
  for (const label of ["Stock", "Prices", "Audit log", "Details"]) assert.match(workspace, new RegExp(`label: "${label}"`));
  assert.match(workspace, /aria-current=\{partDetailPage === page\.id \? "page" : undefined\}/);
  assert.match(workspace, /partDetailPage === "stock"/);
  assert.match(workspace, /partDetailPage === "prices"/);
  assert.match(workspace, /partDetailPage === "activity"/);
  assert.match(workspace, /partDetailPage === "details"/);
  assert.match(workspace, /<PartLocationSettings part=\{selectedItem\} location=\{location\}/);
  assert.doesNotMatch(workspace, /title="Tracking and stock rules"/);
  assert.doesNotMatch(workspace, /Application inventory is separate from the read-only Odoo quantity reference/);
  assert.doesNotMatch(workspace, /These records belong in this part window/);
  assert.doesNotMatch(workspace, /aria-pressed=\{tab ===/);
  assert.match(panel, /<ModalFrame/);
  assert.match(panel, /isDismissable=\{dismissable\}/);
  assert.match(panel, /Heading slot="title"/);
  assert.match(panel, /Close details/);
  assert.match(panelStyles, /justify-content: flex-end/);
  assert.match(panelStyles, /prefers-reduced-motion: reduce/);
});

test("stock rows communicate availability in the quantity column without status chips", async () => {
  const [workspace, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /className=\{`inventory-available-cell is-\$\{state\}`\}/);
  assert.match(workspace, /state === "out" \? <><strong>Out of stock<\/strong>/);
  assert.match(workspace, /state === "reserved" \? <><strong>\{quantity\(item\.quantityAvailable\)\} \{item\.uomCode\} available<\/strong>/);
  assert.match(workspace, /\{quantity\(item\.quantityReserved\)\} \{item\.uomCode\} reserved/);
  assert.match(workspace, /className="inventory-availability-low">Low stock<\/span>/);
  assert.doesNotMatch(workspace, /inventory-stock-state|Minimum reached/);
  assert.match(styles, /\.inventory-available-cell\.is-reserved > strong/);
  assert.match(styles, /\.inventory-available-cell\.is-out > strong/);
  assert.match(styles, /\.inventory-availability-low/);
  assert.doesNotMatch(styles, /\.inventory-stock-state/);
});

test("part header shows the effective selling price without a stock-status badge", async () => {
  const [workspace, model, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./part-commercial-model.js", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /\/commercial\?\$\{params\}/);
  assert.match(workspace, /params\.set\("locationId", selectedLocation\.locationId\)/);
  assert.match(workspace, /effectiveSellingPrice\(commercial, Boolean\(selectedLocation\?\.locationId\)\)/);
  assert.match(workspace, /view\.label === "Unknown" \? "—" : view\.label/);
  assert.match(workspace, /const scopeKey = partHeaderPriceScopeKey/);
  assert.match(workspace, /return \(\) => \{ active = false; \}/);
  assert.match(workspace, /className="inventory-part-header-price"/);
  assert.doesNotMatch(workspace, /className=\{`inventory-detail-status/);
  assert.match(model, /export function effectiveSellingPrice/);
  assert.match(styles, /\.inventory-part-header-price/);
});

test("part detail makes each selected location commercial while defaults and shelving stay secondary", async () => {
  const [workspace, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /part=\{selectedItem\} location=\{selectedLocation\}/);
  assert.match(workspace, /selectedLocation\?\.locationId \|\| "company-defaults"/);
  assert.match(workspace, /location=\{selectedLocation \|\| undefined\}/);
  assert.doesNotMatch(workspace, /secondary=\{!selectedLocation\}/);
  assert.match(workspace, /selectedLocation && shelvingOpen \? <>/);
  assert.match(workspace, /<IconButton icon=\{ArrowLeft\} label="Back to all locations" onClick=\{\(\) => setSelectedLocationId\(""\)\} \/>/);
  assert.match(workspace, /<div className="inventory-part-detail-toolbar">[\s\S]*?<IconButton icon=\{ArrowLeft\} label="Back to all locations"[\s\S]*?<PartLocationSettings part=\{selectedItem\} location=\{selectedLocation\}[\s\S]*?<\/div>/);
  assert.match(workspace, /inventory-part-detail-toolbar-context[\s\S]*?Back to all locations[\s\S]*?selectedLocation\.locationName/);
  assert.doesNotMatch(workspace, /inventory-part-location-actions/);
  assert.doesNotMatch(workspace, /<IconButton icon=\{Rows03\} label="Open shelves and bins"/);
  assert.match(workspace, /onOpenShelves=\{\(\) => setShelvingOpen\(true\)\}/);
  assert.match(styles, /\.inventory-part-detail-toolbar \{[^}]*justify-content: space-between/);
});

test("part detail pages keep the daily stock facts visible and secondary records compact", async () => {
  const [workspace, activity, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./StockMovementHistory.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);

  for (const label of ["On hand", "Our reserved", "Available"]) assert.match(workspace, new RegExp(`<span>${label}<\\/span>`));
  assert.match(workspace, /const stockedLocations =/);
  assert.match(workspace, /const otherLocations =/);
  assert.match(workspace, />Other locations <span>\{otherLocations\.length\}<\/span>/);
  assert.match(workspace, /Number\(selectedItem\.odooQuantityOnHand \|\| 0\) > 0/);
  assert.match(activity, /inventory-stock-activity-list/);
  assert.match(activity, /<time dateTime=\{item\.occurredAt\}>/);
  assert.match(activity, /href=\{workorderHref\(item\.workorderId\)\}/);
  assert.match(activity, /item\.assetUnitNo \|\| "Unit not recorded"/);
  assert.match(activity, /item\.workorderSerial/);
  assert.match(activity, /item\.repairOrder/);
  assert.match(activity, /href=\{receiptHref\(item\.receiptId\)\}>Open receipt<\/a>/);
  assert.match(activity, /inventorySection: "inbound", receiptId/);
  assert.doesNotMatch(activity, /<code>\{item\.receiptId\}<\/code>/);
  assert.match(activity, />Refresh<\/Button>/);
  assert.match(styles, /\.inventory-stock-activity-list/);
  assert.match(styles, /\.inventory-detail-other-locations/);
});

test("stock by location opens part detail with its shop and exact storage context", async () => {
  const [workspace, locationStock, positions, receipt] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./InventoryLocationStockWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./PartPositionsPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("./AddInventoryStockDialog.jsx", import.meta.url), "utf8"),
  ]);
  assert.match(locationStock, /onOpenPart/);
  assert.match(locationStock, /aria-label=\{`Open details for \$\{item\.partNumber/);
  assert.match(locationStock, /shopId,[\s\S]*positionId: selectedPositionId,[\s\S]*positionPath: locationPathLabel\(selected, positions\)/);
  assert.match(workspace, /async function openLocationPart/);
  assert.match(workspace, /locationId: shopId/);
  assert.match(workspace, /setSelectedPositionContext\(\{ shopId, positionId: canStore \? positionId : "", positionPath \}\)/);
  assert.match(workspace, /setSelectedLocationId\(selectedPositionContext\?\.shopId \|\| ""\)/);
  assert.match(workspace, /initialSourcePositionId=\{selectedPositionContext\?\.positionId \|\| ""\}/);
  assert.match(workspace, /receiptPositionId: selectedPositionContext\?\.positionId \|\| ""/);
  assert.match(positions, /initialSourcePositionId = ""/);
  assert.match(workspace, /<IconButton icon=\{ArrowLeft\} label="Back to location" onClick=\{\(\) => setShelvingOpen\(false\)\} \/>/);
  assert.match(positions, /<IconButton[\s\S]*icon=\{RefreshCw01\}[\s\S]*label="Refresh shelf positions"/);
  assert.doesNotMatch(positions, /Actual stock is shown by position/);
  assert.doesNotMatch(positions, /Can store and pick/);
  assert.match(receipt, /targetPositionId: targetPositionId \|\| part\.receiptPositionId \|\| ""/);
});

test("location transfer, damage, and stock rules live behind each location actions menu while tracking stays in Details", async () => {
  const [workspace, settings, editor, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./PartLocationSettings.jsx", import.meta.url), "utf8"),
    readFile(new URL("./PartIdentityEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /inventory-detail-location-row/);
  assert.match(settings, /<AriaButton[^>]*aria-label=\{`Actions for \$\{location\.locationName\}`\}/);
  assert.match(settings, /<DotsVertical aria-hidden="true"/);
  assert.match(settings, /<MenuItem[^>]*onAction=\{onOpenShelves\}[^>]*textValue="Shelves and bins"/);
  assert.match(settings, /<MenuItem[^>]*onAction=\{\(\) => onTransfer\?\.\(location\.locationId\)\}[^>]*textValue="Transfer stock"/);
  assert.match(settings, /<MenuItem[^>]*onAction=\{\(\) => onDamage\?\.\(location\.locationId\)\}[^>]*textValue="Mark stock damaged"/);
  assert.match(settings, /<MenuItem[^>]*onAction=\{showSettings\}[^>]*textValue="Stock settings"/);
  assert.match(workspace, /onTransfer=\{\(sourceLocationId\) => openStockTransfer\(selectedItem, sourceLocationId\)\}/);
  assert.match(workspace, /onDamage=\{\(sourceLocationId\) => openStockDamage\(selectedItem, sourceLocationId\)\}/);
  assert.match(workspace, /setTaskLocationId\(sourceLocationId\)/);
  assert.doesNotMatch(workspace, /<Button[^>]*>Mark stock damaged<\/Button>/);
  assert.match(workspace, /setTaskLocationId\(sourceLocationId\)/);
  assert.doesNotMatch(workspace, /setTaskLocationId\(locations\.some\(l=>l\.id===locationId\)\?locationId:""\);setTaskSection\('transfer'\)/);
  assert.doesNotMatch(settings, />Settings<\/Button>/);
  assert.doesNotMatch(workspace, /<PartSerializationPanel[\s\S]*?onBack=/);
  assert.doesNotMatch(settings, />Tracking<\/h3>/);
  assert.match(settings, />Stock rule<\/h3>/);
  assert.match(settings, /locationId: location\.locationId/);
  assert.match(settings, /expectedVersion: location\.policyVersion \?\? null/);
  assert.match(settings, /"Save stock rule"/);
  assert.match(editor, /id="inventory-tracking-mode"/);
  assert.match(editor, /value="quantity"/);
  assert.match(editor, /value="serialized"/);
  assert.match(editor, /value="measured_bulk"/);
  assert.match(editor, /label="Tracking"/);
  assert.match(workspace, /<section className="inventory-part-identity" aria-label="Part details">/);
  assert.doesNotMatch(workspace, /<dt>Tracking<\/dt>/);
  assert.doesNotMatch(workspace, /<dt>Part name<\/dt>/);
  assert.doesNotMatch(workspace, /<dt>Mapping<\/dt>/);
  assert.doesNotMatch(workspace, /Odoo name and identifiers are read-only/);
  assert.match(styles, /\.inventory-location-settings-overlay/);
  assert.match(styles, /\.inventory-location-actions-popover/);
  assert.match(styles, /\.inventory-location-actions-item[^\n]*min-height: 44px/);
  assert.match(styles, /@media \(max-width: 640px\)[\s\S]*\.inventory-location-settings-modal/);
});

test("inventory selection identity stays stable when a display unit changes", async () => {
  const workspace = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  assert.match(workspace, /return `\$\{item\.companyId\}:\$\{item\.catalogPartId\}`/);
  assert.doesNotMatch(workspace, /return `\$\{item\.companyId\}:\$\{item\.catalogPartId\}:\$\{item\.uomCode\}`/);
});

test("count review matches an existing master part and exact destination", async () => {
  const panel = await readFile(new URL("./InventoryCountImportPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /<PartCatalogCombobox/);
  assert.match(panel, /purpose="master_match"/);
  assert.match(panel, /onSelect=\{\(part\) => \{ setSelectedPart\(part\)/);
  assert.match(panel, /<StoragePositionPicker positions=\{positions\} value=\{targetPositionId\}/);
  assert.match(panel, /catalogPartId: selectedPart\.id/);
  assert.match(panel, /targetPositionId,/);
});

test("part details are a direct compact form with protected provider ownership", async () => {
  const [workspace, editor, model, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./PartIdentityEditor.jsx", import.meta.url), "utf8"),
    readFile(new URL("./part-identity-editor-model.js", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);

  assert.match(workspace, /<PartIdentityEditor/);
  assert.doesNotMatch(workspace, /id="inventory-edit-part"/);
  assert.doesNotMatch(workspace, /partIdentityEditOpen/);
  assert.match(workspace, /!partIdentityBusy && !partIdentityDirty/);
  assert.match(workspace, /partIdentityRefreshPending/);
  assert.match(workspace, /hasRefreshedPartIdentityVersion\(refreshedItem, partIdentityRefreshPending\)/);
  assert.match(workspace, /dismissable=\{!partIdentityBusy && !partIdentityDirty\}/);
  assert.match(workspace, /closeDisabled=\{partIdentityBusy \|\| partIdentityDirty\}/);
  assert.match(workspace, /Reset changes before closing/);
  assert.match(workspace, /<section className="inventory-part-identity" aria-label="Part details">/);
  assert.match(workspace, /inventory-part-detail-navigation/);
  assert.match(workspace, /inventory-part-detail-primary-action[\s\S]*>Add stock<\/Button>/);
  assert.doesNotMatch(workspace, /<SecondaryDetailSection title="Inventory"/);
  assert.doesNotMatch(workspace, /<SecondaryDetailSection title="Stock activity"/);
  assert.doesNotMatch(workspace, /<dl className="inventory-detail-facts">/);
  const inventoryTable = workspace.slice(workspace.indexOf('ariaLabel="Inventory parts"'), workspace.indexOf("<SecondaryDetailPanel"));
  assert.doesNotMatch(inventoryTable, /In Odoo:/);
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
  assert.match(editor, /label="Part name" error=\{errors\.description\}/);
  assert.match(editor, /label="Tracking" error=\{errors\.trackingMode\}/);
  assert.match(editor, /const dirty = JSON\.stringify\(draftPayload\) !== JSON\.stringify\(savedPayload\)/);
  assert.match(editor, /disabled=\{busy \|\| !dirty\}>Reset<\/Button>/);
  assert.match(editor, /disabled=\{busy \|\| !dirty\}>\{busy \? "Saving" : "Save"\}<\/Button>/);
  assert.doesNotMatch(editor, /inventory-part-editor-summary/);
  assert.doesNotMatch(editor, /Name not provided by Odoo/);
  assert.doesNotMatch(editor, /Your Part name is saved only in this system/);
  assert.doesNotMatch(editor, /How do you track this part\?/);
  assert.doesNotMatch(editor, /Quantity is best for interchangeable parts/);
  assert.doesNotMatch(editor, /Cross-reference, OEM, or supplier numbers/);
  assert.doesNotMatch(editor, /defaultOpen=/);
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
  assert.match(workspace, /className=\{`inventory-stock-table inventory-data-table\$\{refreshing \? " is-refreshing" : ""\}`\}/);
  assert.match(workspace, /<Pagination currentPage=\{stockPage\} pageCount=\{stockMeta\.pageCount\} setPage=\{setStockPage\} total=\{stockMeta\.total\} label="parts" loading=\{refreshing\} \/>/);
  assert.match(styles, /\.inventory-stock-table\.is-refreshing/);
  assert.doesNotMatch(styles, /\.inventory-workspace \{|\.inventory-workspace-header|\.inventory-workspace-heading|\.inventory-workspace-actions|\.inventory-stock-controls|\.inventory-stock-filters|\.inventory-stock-list|\.inventory-stock-head|\.inventory-stock-results|\.inventory-stock-row:hover|\.inventory-stock-row:focus-visible/);
  assert.match(styles, /\.inventory-results-progress/);
  assert.match(styles, /prefers-reduced-motion: reduce/);
});

test("phone Inventory returns collection tables to the shared card layout while count review stays dense", async () => {
  const [inventoryTables, collectionStyles] = await Promise.all([
    readFile(new URL("./inventory-tables.css", import.meta.url), "utf8"),
    readFile(new URL("../../components/operations/operational-collection-page.css", import.meta.url), "utf8"),
  ]);
  assert.match(inventoryTables, /@media \(min-width: 761px\)\s*\{[\s\S]*?\.inventory-data-table\.operational-collection-table/);
  assert.match(inventoryTables, /\.inventory-data-frame\.inventory-count-review-table \{ overflow-x: auto; \}/);
  assert.match(collectionStyles, /@media \(max-width: 700px\)[\s\S]*?\.operational-collection-row \{[\s\S]*?border-radius: 10px;/);
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
  assert.match(panel, /Condition evidence \(required\)/);
  assert.match(panel, /setCustodyRefreshVersion\(\(version\) => version \+ 1\)/);
  assert.equal((panel.match(/className="inventory-serial-list"/g) || []).length, 1);
  assert.match(panel, /const visibleUnits = companyId && !custodyUnits\.error/);
  assert.match(panel, /Filter exact units by state/);
  assert.match(panel, /unitState: custodyUnitState/);
  assert.match(panel, /\["available", "Available"\]/);
  assert.match(panel, /\["in_stock", "In stock"\]/);
  assert.match(panel, /No serialized units match these filters/);
  assert.match(panel, /setCustodyUnitState\(""\)/);
  assert.match(panel, /inventory-unit-condition/);
  assert.match(panel, /if \(unit\?\.custodyHolderLabel\) return unit\.custodyHolderLabel/);
  assert.match(panel, /crypto\.randomUUID\(\)/);
  assert.match(panel, /canCreateAtLocation/);
  assert.match(panel, /No serialized children yet/);
  assert.match(panel, /createOpen/);
  assert.match(panel, /onAddStock \? onAddStock\(\) : setCreateOpen\(true\)/);
  assert.match(panel, /onAddStock \? "Add stock" : "Add units"/);
  assert.match(panel, /<IconButton[\s\S]*label="Close add units"/);
  assert.match(panel, /autoFocus\s+type="number"/);
  assert.doesNotMatch(panel, /Add serialized physical units/);
  assert.doesNotMatch(panel, /Application inventory and Odoo reference are kept separate/);
});

test("stock holder corrections preserve one saved operation until its outcome is known", async () => {
  const panel = await readFile(new URL("./PartSerializationPanel.jsx", import.meta.url), "utf8");
  assert.match(panel, /inventory-bin-correction:\$\{actorId\}:\$\{companyId\}/);
  assert.match(panel, /const request = pendingCorrection \|\|/);
  assert.match(panel, /INVENTORY_REUSE_OPERATION_NOT_FOUND/);
  assert.match(panel, /setCorrectionRetryAllowed\(true\)/);
  assert.match(panel, />\s*Retry saved correction\s*</);
  assert.match(panel, /Boolean\(pendingCorrection\)/);
  assert.match(panel, /custodyLegacyAvailable === true/);
  assert.match(panel, /details\.receiptEvidence/);
});

test("count sheets use server pagination and accessible upload dialog", async () => {
  const [panel, sharedDialog, sharedStyles] = await Promise.all([
    readFile(new URL("./InventoryCountImportPanel.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/ui/UploadDialog.jsx", import.meta.url), "utf8"),
    readFile(new URL("../../components/ui/upload-dialog.css", import.meta.url), "utf8"),
  ]);
  assert.match(panel, /count-imports\?page=\$\{importPage\}&pageSize=10/);
  assert.match(panel, /pageCount: Number\(result\.pageCount\) \|\| 1/);
  assert.match(panel, /<UploadDialog title="Import count sheet"/);
  assert.match(panel, /isDismissable=\{!uploading\}/);
  assert.match(panel, /<UploadDropzone inputId="inventory-count-file"/);
  assert.match(panel, /closeLabel="Close count-sheet upload"/);
  assert.match(sharedDialog, /<ModalFrame/);
  assert.match(sharedDialog, /ariaLabelledBy=\{titleId\}/);
  assert.match(sharedDialog, /className="shared-upload-native-input"/);
  assert.match(sharedDialog, /aria-live="assertive"/);
  assert.match(sharedStyles, /\.shared-upload-dropzone/);
  assert.match(sharedStyles, /@media \(max-width:700px\)/);
  assert.match(panel, /<Pagination currentPage=\{importPage\}/);
  assert.match(panel, /label: stocktake\.sourceFileName \|\| "Count sheet"/);
  assert.match(panel, /ariaLabel="Uploaded count sheets"/);
  assert.match(panel, /No count sheets uploaded/);
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
  assert.match(office, /<InventoryWorkspace actorId=\{actor\?\.id\} canApplyInventoryCount=\{false\} presentation="embedded" \/>/);
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
  assert.match(workspace, /receiptLines: posting\.receiptLines \|\| \[\]/);
  assert.doesNotMatch(workspace, /confirmation: "all_received_undamaged"/);
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

test("unmatched inventory count rows cannot fabricate a master part inline", async () => {
  const panel = await readFile(new URL("./InventoryCountImportPanel.jsx", import.meta.url), "utf8");
  assert.doesNotMatch(panel, /CreateInventoryPartDialog/);
  assert.doesNotMatch(panel, /ReviewInventoryCountPartDialog/);
  assert.doesNotMatch(panel, />Create this part<\/Button>/);
  assert.match(panel, /Choose a catalog part/);
});

test("the main inventory page can create a zero-stock local catalog part", async () => {
  const source = await readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8");
  assert.match(source, />New part<\/Button>/);
  assert.match(source, /<CreateInventoryPartDialog[\s\S]*locations=\{locations\}/);
  assert.match(source, /setQuery\(part\.partNumber\)/);
});

test("part location history is tracking-aware and hands off to a visibly scoped audit log", async () => {
  const [workspace, history, styles] = await Promise.all([
    readFile(new URL("./InventoryWorkspace.jsx", import.meta.url), "utf8"),
    readFile(new URL("./StockMovementHistory.jsx", import.meta.url), "utf8"),
    readFile(new URL("./inventory-workspace.css", import.meta.url), "utf8"),
  ]);
  assert.match(workspace, /\{ id: "activity", label: "Audit log" \}/);
  assert.match(workspace, /selectedItem\.trackingMode === "quantity" \|\| selectedItem\.trackingMode === "measured_bulk"/);
  assert.match(workspace, />Used on Workorders</);
  assert.match(workspace, /locationId=\{selectedLocation\.locationId\} view="workorder"/);
  assert.match(workspace, />View full audit log<\/Button>/);
  assert.match(workspace, /<PartSerializationPanel[\s\S]*?showAddAction=\{false\}[\s\S]*?View full audit log/);
  assert.match(workspace, /Filtered to this shop/);
  assert.match(workspace, /All locations · Company-wide history/);
  assert.match(workspace, />Show all locations<\/Button>/);
  assert.match(history, /params\.set\("view", view\)/);
  assert.match(history, /emptyMessage = "No stock activity\."/);
  assert.match(styles, /\.inventory-part-location-summary \{ display: grid; gap: 18px; \}/);
  assert.match(styles, /\.inventory-shop-usage > header, \.inventory-audit-log-heading/);
});
