import './inventory-tables.css';
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, FileCheck02, Package, SearchMd } from "@untitledui/icons";
import ExcelJS from "exceljs/dist/exceljs.min.js";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { Pagination } from "../../components/ui/Pagination.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { UploadDialog, UploadDropzone } from "../../components/ui/UploadDialog.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { api } from "../../lib/api.js";
import { StoragePositionPicker } from "./StoragePositionPicker.jsx";

const MAX_FILE_BYTES = 2_000_000;
const MAX_ROWS = 500;
const EXCEPTION_COLUMNS = [
  { id: "issue", label: "Issue" },
  { id: "sourcePart", label: "Spreadsheet part", isRowHeader: true },
  { id: "quantity", label: "Qty" },
  { id: "storage", label: "Destination" },
  { id: "masterPart", label: "Master part" },
  { id: "action", label: "Action" },
];
const FILE_COLUMNS = [
  { id: "file", label: "File", isRowHeader: true },
  { id: "location", label: "Location" },
  { id: "uploaded", label: "Uploaded" },
  { id: "status", label: "Status" },
  { id: "actions", label: "Actions" },
];

function cellValue(cell) {
  const value = cell?.value;
  if (value && typeof value === "object" && "result" in value) return value.result;
  return value ?? "";
}

function text(value) {
  return String(value ?? "").trim();
}

async function sha256Hex(buffer) {
  const digest = await window.crypto.subtle.digest("SHA-256", buffer);
  return [...new Uint8Array(digest)].map((value) => value.toString(16).padStart(2, "0")).join("");
}

function base64FromBuffer(buffer) {
  const bytes = new Uint8Array(buffer);
  let binary = "";
  for (let offset = 0; offset < bytes.length; offset += 0x8000) binary += String.fromCharCode(...bytes.subarray(offset, offset + 0x8000));
  return window.btoa(binary);
}

export async function readInventoryWorkbook(file) {
  if (!file || file.size > MAX_FILE_BYTES) throw new Error("Choose an XLSX file smaller than 2 MB.");
  if (!/\.xlsx$/i.test(file.name)) throw new Error("Choose the XLSX inventory workbook.");
  const buffer = await file.arrayBuffer();
  const Workbook = ExcelJS.Workbook || ExcelJS.default?.Workbook || ExcelJS.default || ExcelJS;
  const workbook = new Workbook();
  await workbook.xlsx.load(buffer);
  const sheet = workbook.getWorksheet("Parts Inventory") || workbook.worksheets[0];
  if (!sheet) throw new Error("The workbook has no worksheets.");
  const headers = ["Part #", "Part Name", "Category", "Fits / Description", "Bin / Shelf", "Opening Qty"];
  headers.forEach((expected, index) => {
    if (text(cellValue(sheet.getRow(3).getCell(index + 1))) !== expected) {
      throw new Error("Use the inventory workbook with the Parts Inventory columns on row 3.");
    }
  });
  const rows = [];
  const lastRow = Math.min(sheet.rowCount, 10_000);
  for (let sourceRow = 4; sourceRow <= lastRow; sourceRow += 1) {
    const row = sheet.getRow(sourceRow);
    const partNumber = text(cellValue(row.getCell(1)));
    if (!partNumber) continue;
    rows.push({
      sourceRow,
      partNumber,
      partName: text(cellValue(row.getCell(2))),
      description: text(cellValue(row.getCell(4))),
      binLocation: text(cellValue(row.getCell(5))),
      quantity: cellValue(row.getCell(6)),
      averageCost: cellValue(row.getCell(12)),
    });
    if (rows.length > MAX_ROWS) throw new Error(`Upload no more than ${MAX_ROWS} inventory rows at once.`);
  }
  if (!rows.length) throw new Error("No parts were found in the Parts Inventory sheet.");
  return { rows, sourceSha256: await sha256Hex(buffer), sourceContentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", sourceSizeBytes: buffer.byteLength, sourceFileBase64: base64FromBuffer(buffer) };
}

function statusText(status) {
  return {
    unmatched: "Choose and review master part",
    duplicate: "Duplicate row",
    invalid_quantity: "Fix quantity",
    position_required: "Choose destination",
    ready: "Ready",
    applied: "Added",
    ignored: "Ignored",
  }[status] || status;
}

function InventoryCountExceptionRow({ line, stocktake, onUpdated }) {
  const suggestedQuery = String(line.sourcePartNumber || line.sourcePartName || "").trim();
  const automaticSearchQuery = String(line.sourcePartName || line.sourceDescription || line.sourcePartNumber || "").trim();
  const [query, setQuery] = useState(suggestedQuery);
  const [useSpreadsheetSuggestions, setUseSpreadsheetSuggestions] = useState(true);
  const [selectedPart, setSelectedPart] = useState(() => line.catalogPartId ? {
    id: line.catalogPartId,
    partNumber: line.partNumber,
    description: line.description,
    trackingMode: line.trackingMode,
    decimalScale: line.decimalScale,
  } : null);
  const [quantity, setQuantity] = useState(line.quantity || "");
  const [targetPositionId, setTargetPositionId] = useState(line.targetPositionId || "");
  const [positions, setPositions] = useState([]);
  const [positionLoading, setPositionLoading] = useState(true);
  const [positionError, setPositionError] = useState("");
  const [positionReload, setPositionReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    let active = true;
    setPositionLoading(true);
    api(`/api/office/inventory/locations/${encodeURIComponent(stocktake.locationId)}/positions`)
      .then((result) => { if (active) { setPositions(result.positions || result.items || []); setPositionError(""); } })
      .catch((nextError) => { if (active) setPositionError(nextError.message || "Storage locations could not be loaded."); })
      .finally(() => { if (active) setPositionLoading(false); });
    return () => { active = false; };
  }, [stocktake.locationId, positionReload]);

  async function update(action) {
    setSaving(true);
    setError("");
    try {
      const body = action === "ignore"
        ? { action, expectedVersion: stocktake.version }
        : {
          action,
          expectedVersion: stocktake.version,
          catalogPartId: selectedPart.id,
          quantity: Number(quantity),
          binLocation: line.sourceBinLocation || "",
          targetPositionId,
        };
      const result = await api(`/api/office/inventory/count-imports/${stocktake.id}/lines/${line.id}`, {
        method: "PATCH",
        body: JSON.stringify(body),
      });
      onUpdated(result.import);
    } catch (nextError) {
      if (nextError?.code === "INVENTORY_COUNT_POSITION_INVALID") {
        setTargetPositionId("");
        setPositionReload((value) => value + 1);
      }
      setError(nextError.message);
    } finally {
      setSaving(false);
    }
  }

  const parsedQuantity = Number(quantity);
  const quantityScale = selectedPart?.trackingMode === "measured_bulk" ? Number(selectedPart.decimalScale || 0) : 0;
  const quantityFactor = 10 ** quantityScale;
  const validQuantity = Number.isFinite(parsedQuantity) && parsedQuantity > 0 && parsedQuantity <= 500
    && Math.abs(Math.round(parsedQuantity * quantityFactor) - parsedQuantity * quantityFactor) < 1e-8;
  const quantityStep = quantityScale ? String(1 / quantityFactor) : "1";
  const canMatch = Boolean(selectedPart?.trackingMode && validQuantity && targetPositionId && !positionLoading && !positionError);
  const partLabel = line.sourcePartNumber || `row ${line.sourceRow}`;

  return <OperationalDataRow id={line.id} className="inventory-count-table-row">
    <OperationalDataCell label="Issue" className="inventory-count-issue-cell">
      <span className={`inventory-state is-${line.matchStatus}`}>{statusText(line.matchStatus)}</span>
      <small>Row {line.sourceRow}</small>
    </OperationalDataCell>
    <OperationalDataCell label="Spreadsheet part" className="inventory-count-source-cell">
      <strong>{line.sourcePartNumber}</strong>
      <small>{line.sourcePartName || line.sourceDescription || "No spreadsheet description"}</small>
      {line.sourceBinLocation ? <small>Sheet bin: {line.sourceBinLocation}</small> : null}
    </OperationalDataCell>
    <OperationalDataCell label="Qty" className="inventory-count-quantity-cell">
      <label className="inventory-count-visually-hidden" htmlFor={`count-quantity-${line.id}`}>Quantity for {partLabel}</label>
      <input id={`count-quantity-${line.id}`} aria-invalid={!validQuantity} type="number" min="0.001" max="500" step={quantityStep} value={quantity} data-decimal-scale={quantityScale} onChange={(event) => setQuantity(event.target.value)} />
    </OperationalDataCell>
    <OperationalDataCell label="Destination" className="inventory-count-storage-cell">
      <StoragePositionPicker positions={positions} value={targetPositionId} onChange={setTargetPositionId} disabled={saving || positionLoading} required purpose="receipt" />
      {positionLoading ? <small role="status">Loading storage locations…</small> : null}
      {positionError ? <><small role="alert">{positionError}</small><Button type="button" onClick={() => setPositionReload((value) => value + 1)}>Try again</Button></> : null}
    </OperationalDataCell>
    <OperationalDataCell label="Master part" className="inventory-count-master-cell">
      <PartCatalogCombobox
        locationId={stocktake.locationId}
        purpose="master_match"
        value={query}
        onChange={(nextQuery) => { setQuery(nextQuery); setUseSpreadsheetSuggestions(false); setSelectedPart(null); }}
        onSelect={(part) => { setSelectedPart(part); setQuery(part.partNumber || part.description || ""); }}
        disabled={saving}
        label=""
        inputAriaLabel={`Choose master part for ${partLabel} from row ${line.sourceRow}`}
        placeholder="Choose a catalog part"
        catalogEndpoint="/api/office/inventory/catalog"
        resultLimit={12}
        popupAriaLabel={`Matching master parts for ${partLabel}`}
        suggestionQuery={useSpreadsheetSuggestions ? automaticSearchQuery : ""}
      />
      <small className="inventory-count-match-hint">Use an existing configured catalog part.</small>
      {error ? <p className="ops-error" role="alert" aria-live="assertive">{error}</p> : null}
    </OperationalDataCell>
    <OperationalDataCell label="Action" className="inventory-count-action-cell">
      <Button type="button" variant="primary" onClick={() => update("match")} disabled={saving || !canMatch}>{saving ? "Saving…" : "Ready"}</Button>
      <Button type="button" aria-label={`Ignore ${partLabel} from row ${line.sourceRow}`} onClick={() => update("ignore")} disabled={saving}>{saving ? "Saving…" : "Ignore"}</Button>
    </OperationalDataCell>
  </OperationalDataRow>;
}
export function InventoryCountImportPanel({ locations, initialImportId = "", uploadOpen = false, onUploadOpenChange, canApplyInventoryCount = false, onApplied, onContextChange }) {
  const fileInput = useRef(null);
  const [locationId, setLocationId] = useState(() => locations[0]?.id || "");
  const [stocktake, setStocktake] = useState(null);
  const [imports, setImports] = useState([]);
  const [importPage, setImportPage] = useState(1);
  const [importMeta, setImportMeta] = useState({ pageCount: 1, total: 0 });
  const [listLoading, setListLoading] = useState(!initialImportId);
  const [loading, setLoading] = useState(Boolean(initialImportId));
  const [uploading, setUploading] = useState(false);
  const [applying, setApplying] = useState(false);
  const [confirmed, setConfirmed] = useState(false);
  const [error, setError] = useState("");
  const [exceptionQuery, setExceptionQuery] = useState("");
  const [exceptionFilter, setExceptionFilter] = useState("all");
  const [exceptionPage, setExceptionPage] = useState(1);
  const returnFocusImportIdRef = useRef("");

  useEffect(() => {
    if (!locationId && locations[0]?.id) setLocationId(locations[0].id);
  }, [locationId, locations]);

  useEffect(() => {
    if (!initialImportId) return undefined;
    let active = true;
    setLoading(true);
    api(`/api/office/inventory/count-imports/${encodeURIComponent(initialImportId)}`)
      .then((result) => { if (active) setStocktake(result.import); })
      .catch((nextError) => { if (active) setError(nextError.message); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [initialImportId]);

  useEffect(() => {
    let active = true;
    setListLoading(true);
    api(`/api/office/inventory/count-imports?page=${importPage}&pageSize=10`)
      .then((result) => { if (active) { setImports(Array.isArray(result.imports) ? result.imports : []); setImportMeta({ pageCount: Number(result.pageCount) || 1, total: Number(result.total) || 0 }); } })
      .catch((nextError) => { if (active) setError(nextError.message); })
      .finally(() => { if (active) setListLoading(false); });
    return () => { active = false; };
  }, [importPage]);

  useEffect(() => {
    setConfirmed(false);
  }, [stocktake?.version]);

  useEffect(() => {
    onContextChange?.(stocktake ? {
      label: stocktake.sourceFileName || "Count sheet",
      onBack: showFileList,
    } : null);
  }, [onContextChange, stocktake?.id, stocktake?.sourceFileName]);

  useEffect(() => () => onContextChange?.(null), [onContextChange]);

  useEffect(() => {
    if (stocktake || listLoading || !returnFocusImportIdRef.current) return;
    const target = document.querySelector(`[data-inventory-import="${CSS.escape(returnFocusImportIdRef.current)}"]`);
    if (!target) return;
    target.focus({ preventScroll: true });
    returnFocusImportIdRef.current = "";
  }, [imports, listLoading, stocktake]);

  const exceptions = useMemo(() => stocktake?.lines.filter((line) => ["unmatched", "duplicate", "invalid_quantity", "position_required"].includes(line.matchStatus)) || [], [stocktake]);
  const filteredExceptions = useMemo(() => exceptions.filter((line) => {
    const sourceQuantity = String(line.sourceQuantity ?? "").trim();
    const matchesFilter = exceptionFilter === "all" || exceptionFilter === line.matchStatus || (exceptionFilter === "zero_or_blank" && (sourceQuantity === "" || Number(sourceQuantity) === 0));
    const needle = exceptionQuery.trim().toLocaleLowerCase();
    return matchesFilter && (!needle || [line.sourcePartNumber, line.sourcePartName, line.sourceDescription, line.binLocation, sourceQuantity, line.sourceRow].some((value) => String(value ?? "").toLocaleLowerCase().includes(needle)));
  }), [exceptionFilter, exceptionQuery, exceptions]);
  const exceptionPageCount = Math.max(1, Math.ceil(filteredExceptions.length / 12));
  const exceptionItems = filteredExceptions.slice((exceptionPage - 1) * 12, exceptionPage * 12);

  useEffect(() => setExceptionPage(1), [stocktake?.id, exceptionFilter, exceptionQuery]);
  useEffect(() => { if (exceptionPage > exceptionPageCount) setExceptionPage(exceptionPageCount); }, [exceptionPage, exceptionPageCount]);

  async function upload(file) {
    if (!locationId) {
      setError("Choose the inventory location first.");
      return;
    }
    setUploading(true);
    setError("");
    try {
      const parsed = await readInventoryWorkbook(file);
      const result = await api("/api/office/inventory/count-imports", {
        method: "POST",
        body: JSON.stringify({ locationId, sourceFileName: file.name, ...parsed }),
        timeoutMs: 30_000,
      });
      setStocktake(result.import);
      onUploadOpenChange?.(false);
      setImportPage(1);
      window.history.replaceState({}, "", (() => {
        const url = new URL(window.location.href);
        url.searchParams.set("countImport", result.import.id);
        url.searchParams.delete("inventoryAction");
        return url;
      })());
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setUploading(false);
      if (fileInput.current) fileInput.current.value = "";
    }
  }

  async function openImport(importId) {
    returnFocusImportIdRef.current = importId;
    setLoading(true); setError("");
    try {
      const result = await api(`/api/office/inventory/count-imports/${encodeURIComponent(importId)}`);
      setStocktake(result.import);
      const url = new URL(window.location.href); url.searchParams.set("countImport", importId); window.history.replaceState({}, "", url);
    } catch (nextError) { setError(nextError.message); } finally { setLoading(false); }
  }

  function showFileList() {
    setStocktake(null); setError("");
    onContextChange?.(null);
    const url = new URL(window.location.href); url.searchParams.delete("countImport"); window.history.replaceState({}, "", url);
  }

  async function applyReady() {
    setApplying(true);
    setError("");
    try {
      const result = await api(`/api/office/inventory/count-imports/${stocktake.id}/apply`, {
        method: "POST",
        body: JSON.stringify({ expectedVersion: stocktake.version, confirmation: "physically_counted" }),
      });
      setStocktake(result.import);
      setConfirmed(false);
      onApplied?.();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setApplying(false);
    }
  }

  const uploadDialog = <UploadDialog title="Import count sheet" closeLabel="Close count-sheet upload" isOpen={uploadOpen} onOpenChange={(open) => !uploading && onUploadOpenChange?.(open)} isDismissable={!uploading} closeDisabled={uploading} error={error}><label className="shared-upload-field" htmlFor="inventory-count-location"><span>Location</span><Dropdown id="inventory-count-location" value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Choose location</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</Dropdown></label><UploadDropzone inputId="inventory-count-file" inputRef={fileInput} accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" disabled={!locationId || uploading} onChange={(event) => upload(event.target.files?.[0])} onDrop={(event) => upload(event.dataTransfer.files?.[0])} text={uploading ? "Uploading…" : "Drop count sheet here or browse"} hint="XLSX · 2 MB maximum" /></UploadDialog>;

  if (loading) return <div className="inventory-empty"><Package /><strong>Loading inventory count</strong></div>;
  if (!stocktake) return <>{uploadDialog}{error && !uploadOpen ? <p className="ops-error" role="alert">{error}</p> : null}{listLoading ? <div className="inventory-empty"><Package /><strong>Loading uploaded count sheets</strong></div> : imports.length ? <><OperationalDataTable ariaLabel="Uploaded count sheets" columns={FILE_COLUMNS} className="inventory-file-table inventory-data-table">{imports.map((entry) => <OperationalDataRow id={entry.id} key={entry.id}><OperationalDataCell label="Count sheet"><span className="inventory-file-name"><FileCheck02 /><span><strong>{entry.sourceFileName}</strong><small>{entry.rowCount} count rows</small></span></span></OperationalDataCell><OperationalDataCell label="Location">{entry.locationName}</OperationalDataCell><OperationalDataCell label="Uploaded">{new Date(entry.createdAt).toLocaleString()}</OperationalDataCell><OperationalDataCell label="Status"><span className={`inventory-state is-${entry.status}`}>{entry.status}</span></OperationalDataCell><OperationalDataCell label="Actions"><div className="inventory-file-actions">{entry.downloadUrl ? <a href={entry.downloadUrl}>Download</a> : null}<Button type="button" data-inventory-import={entry.id} onClick={() => openImport(entry.id)}>Review</Button></div></OperationalDataCell></OperationalDataRow>)}</OperationalDataTable><Pagination currentPage={importPage} pageCount={importMeta.pageCount} setPage={setImportPage} total={importMeta.total} label="count sheets" loading={listLoading} /></> : <div className="inventory-empty"><FileCheck02 /><strong>No count sheets uploaded</strong><p>Choose Import count sheet to upload the first XLSX file.</p></div>}</>;

  return <>{uploadDialog}<section className="inventory-count-review">
    <header><div><FileCheck02 /><div><h3>{stocktake.sourceFileName}</h3><p>{stocktake.locationName} · Uploaded {new Date(stocktake.createdAt).toLocaleString()}</p></div></div><span className={`inventory-state is-${stocktake.status}`}>{stocktake.status}</span></header>
    <dl className="inventory-count-summary" aria-label="Inventory count progress">
      <div><dt>Ready</dt><dd>{stocktake.readyCount}</dd></div>
      <div><dt>Review</dt><dd>{stocktake.exceptionCount}</dd></div>
      <div><dt>Added</dt><dd>{stocktake.appliedCount}</dd></div>
      <div><dt>Total</dt><dd>{stocktake.rowCount}</dd></div>
    </dl>

    {stocktake.readyCount && canApplyInventoryCount ? <section className="inventory-count-apply">
      <div className="inventory-count-ready-copy"><CheckCircle /><div><strong>{stocktake.readyCount} matched</strong><p>Adds each reviewed row to its exact storage destination. Serialized parts also receive QR labels.</p></div></div>
      <fieldset className="inventory-count-confirmation"><legend className="inventory-count-visually-hidden">Physical count confirmation</legend><label className="inventory-count-attestation"><Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} /><span>Counted at {stocktake.locationName}</span></label></fieldset>
      <Button type="button" variant="primary" onClick={applyReady} disabled={!confirmed || applying}>{applying ? "Adding…" : `Add ${stocktake.readyCount} rows`}</Button>
    </section> : stocktake.readyCount ? <section className="inventory-count-admin-next-action"><strong>{stocktake.readyCount} matched rows are ready.</strong><p>An administrator must confirm the physical count before adding inventory.</p></section> : null}

    {stocktake.labelBatches.length ? <section className="inventory-count-labels"><h3>QR labels</h3><p>Print each batch and attach one label to each physical unit.</p><div>{stocktake.labelBatches.map((batch, index) => <a key={batch.id} href={batch.printUrl} target="_blank" rel="noreferrer">Print batch {index + 1} · {batch.itemCount} labels</a>)}</div></section> : null}

    {exceptions.length ? <section className="inventory-count-exceptions">
      <div className="inventory-count-section-heading"><div><AlertCircle /><div><h3>{exceptions.length} need review</h3><p>Choose the catalog part and exact storage destination, correct the quantity, or ignore the row.</p></div></div></div>
      <div className="inventory-count-review-toolbar"><label><SearchMd /><input aria-label="Search inventory review rows" value={exceptionQuery} onChange={(event) => setExceptionQuery(event.target.value)} placeholder="Search part, description, source bin, or row" /></label><Dropdown aria-label="Filter inventory review rows" value={exceptionFilter} onChange={(event) => setExceptionFilter(event.target.value)}><option value="all">All issues ({exceptions.length})</option><option value="zero_or_blank">Zero or blank quantity</option><option value="invalid_quantity">Quantity issues</option><option value="unmatched">Unmatched parts</option><option value="duplicate">Duplicates</option><option value="position_required">Destination needed</option></Dropdown></div>
      {filteredExceptions.length ? <><div className="inventory-count-filter-result"><strong>{filteredExceptions.length}</strong> matching rows</div><OperationalDataTable ariaLabel="Inventory count rows needing review" columns={EXCEPTION_COLUMNS} className="inventory-count-review-table inventory-data-frame">{exceptionItems.map((line) => <InventoryCountExceptionRow key={line.id} line={line} stocktake={stocktake} onUpdated={setStocktake} />)}</OperationalDataTable><Pagination currentPage={exceptionPage} pageCount={exceptionPageCount} setPage={setExceptionPage} total={filteredExceptions.length} label="rows" /></> : <div className="inventory-empty is-compact"><SearchMd /><strong>No matching review rows</strong><p>Change the search or issue filter.</p></div>}
    </section> : null}
    {error ? <p className="ops-error" role="alert" aria-live="assertive">{error}</p> : null}
  </section></>;
}
