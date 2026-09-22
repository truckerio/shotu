import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { CurrencySelector } from "../../components/forms/CurrencySelector.jsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle, File02, RefreshCw01, Trash01, UploadCloud02, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { UploadDialog, UploadDropzone } from "../../components/ui/UploadDialog.jsx";
import { api } from "../../lib/api.js";
import { InvoiceDocumentViewer } from "./InvoiceDocumentViewer.jsx";
import { InvoiceHistoryPanel } from "./InvoiceHistoryPanel.jsx";
import { PhysicalReceiptConfirmation } from "./PhysicalReceiptConfirmation.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { CreateInventoryPartDialog } from "../inventory/CreateInventoryPartDialog.jsx";
import {
  confidenceState,
  firstInvoiceLineId,
  invoiceDeliveryFullyReceived,
  invoiceFieldNeedsReview,
  invoiceLineNeedsReview,
  invoiceReviewErrorMessage,
  nextInvoiceLineIdAfterRemoval,
  nextReviewableBatchIndex,
  orderInvoiceLinesForReview,
  orderInvoiceReviewSections,
  addBlankInvoiceLine,
  INVOICE_HEADER_FIELDS,
  parseReviewNumber,
  removeInvoiceLine,
  shouldConfirmInvoiceReviewLeave,
  updateInvoiceField,
  updateInvoiceLineField,
  validateInvoiceSelection,
} from "./invoice-extraction-model.js";
import "./invoice-extraction.css";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 10;
const MAX_ENQUEUE_CONCURRENCY = 3;
const STATUS_DISMISS_MS = 1_500;
const COMPACT_REVIEW_QUERY = "(max-width: 900px)";
const INVOICE_DETAIL_FIELDS = new Set(["documentType", "vendorName", "vendorAccount", "invoiceNumber", "invoiceDate"]);
const TOTAL_FIELDS = new Set(["currency", "subtotal", "tax", "shipping", "total"]);

function readFileDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error("The invoice could not be read."));
    reader.onload = () => resolve(String(reader.result || ""));
    reader.readAsDataURL(file);
  });
}

function LoadingRefreshIcon(props) {
  return <RefreshCw01 {...props} className="loading-icon" />;
}

function queuedBatchMessage(fileName, batchSize) {
  return batchSize > 1
    ? `${fileName} is ready to review. Other invoices will continue extracting.`
    : `${fileName} is ready to review.`;
}

function reviewValue(field, fallback) {
  const value = String(field?.value ?? "").trim();
  return value || fallback;
}

function reviewAmount(field, currency = "") {
  if (field?.value === null || field?.value === undefined || field?.value === "") return "Total not extracted";
  const value = Number(field?.value);
  if (!Number.isFinite(value)) return "Total not extracted";
  return `${currency ? `${currency} ` : ""}${value.toFixed(2)}`;
}

function orderReviewFields(fields, draft) {
  return [...fields].sort((left, right) => Number(invoiceFieldNeedsReview(draft?.[right[0]], right[3])) - Number(invoiceFieldNeedsReview(draft?.[left[0]], left[3])));
}

function Confidence({ field, optional = false }) {
  const blankOptional = optional && !String(field.value ?? "").trim();
  if (blankOptional) return <span className="invoice-confidence is-optional" title={field.evidence}>Not provided</span>;
  const state = confidenceState(field.confidence);
  const confidence = Number(field.confidence);
  const level = confidence >= 90 ? "high" : confidence >= 70 ? "medium" : "low";
  return (
    <span className="invoice-confidence" title={field.evidence}>
      {state} · <span className={`invoice-confidence-value is-${level}`}>{field.confidence}%</span>
    </span>
  );
}

function Field({ fieldName, label, type, draft, onChange, options = {}, disabled = false }) {
  const field = draft[fieldName];
  const inputId = useId();
  const needsReview = invoiceFieldNeedsReview(field, options);
  return (
    <div className={`invoice-field${needsReview ? " needs-review" : ""}`}>
      <div className="invoice-field-heading">
        <label htmlFor={inputId}>{label}{options.optional ? <span>Optional</span> : null}</label>
        <div className="invoice-field-meta">
          <Confidence field={field} optional={options.optional} />
          <details className="invoice-field-evidence">
            <summary aria-label={`Show extraction evidence for ${label}`} title="Extraction evidence">i</summary>
            <small>{field.evidence || "No visible evidence supplied."}</small>
          </details>
        </div>
      </div>
      {type === "select" ? (
        <Dropdown id={inputId} value={field.value} onChange={(event) => onChange(fieldName, event.target.value)} disabled={disabled}>
          <option value="invoice">Invoice</option><option value="credit_memo">Credit memo</option><option value="unknown">Unknown</option>
        </Dropdown>
      ) : type === "currency" ? (
        <CurrencySelector id={inputId} value={field.value} onChange={(event) => onChange(fieldName, event.target.value)} disabled={disabled} />
      ) : (
        <input
          id={inputId}
          type={type}
          step={type === "number" ? "0.01" : undefined}
          value={field.value ?? ""}
          readOnly={disabled}
          onChange={(event) => onChange(fieldName, type === "number" ? parseReviewNumber(event.target.value) : event.target.value)}
        />
      )}
    </div>
  );
}

function ReviewSection({ sectionId, title, summary, issueCount = 0, status = "", readOnly = false, defaultOpen = false, children }) {
  const [open, setOpen] = useState(defaultOpen);
  const contentId = `${sectionId}-content`;
  useEffect(() => {
    if (status === "Pending" || issueCount > 0) setOpen(true);
  }, [issueCount, status]);
  return (
    <section className={`invoice-review-section${issueCount ? " has-issues" : ""}`} aria-labelledby={`${sectionId}-title`}>
      <button type="button" className="invoice-review-section-toggle" aria-expanded={open} aria-controls={contentId} onClick={() => setOpen((current) => !current)}>
        <span className="invoice-review-section-heading"><strong id={`${sectionId}-title`}>{title}</strong><small>{summary}</small></span>
        <span className={`invoice-review-section-status${issueCount ? " has-issues" : ""}`}>{status || (issueCount ? `${issueCount} issue${issueCount === 1 ? "" : "s"}` : "Ready")}</span>
        <span className="invoice-review-section-action">{open ? "Close" : readOnly ? "View" : "Edit"}</span>
      </button>
      <div id={contentId} className="invoice-review-section-content" hidden={!open}>{children}</div>
    </section>
  );
}

export function InvoiceExtractionWorkspace({ embedded = false, availableLocations, initialLocationId = "", uploadOpen: controlledUploadOpen, onUploadOpenChange, onContextChange }) {
  const [locations, setLocations] = useState(() => Array.isArray(availableLocations) ? availableLocations : []);
  const [locationId, setLocationId] = useState("");
  const [uploads, setUploads] = useState([]);
  const [batchRuns, setBatchRuns] = useState([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [run, setRun] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approveLearning, setApproveLearning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [receiptEpisode, setReceiptEpisode] = useState(0);
  const [purchaseOrderSuggestion, setPurchaseOrderSuggestion] = useState(null);
  const [purchaseOrderSuggestionLoading, setPurchaseOrderSuggestionLoading] = useState(false);
  const [purchaseOrderSuggestionError, setPurchaseOrderSuggestionError] = useState("");
  const [purchaseOrderSuggestionReload, setPurchaseOrderSuggestionReload] = useState(0);
  const [receiptPositions, setReceiptPositions] = useState([]);
  const [receiptPositionsLoading, setReceiptPositionsLoading] = useState(false);
  const [receiptPositionsError, setReceiptPositionsError] = useState("");
  const [receiptPositionsReload, setReceiptPositionsReload] = useState(0);
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyReturnFocusId, setHistoryReturnFocusId] = useState("");
  const [internalUploadOpen, setInternalUploadOpen] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [leaveReviewOpen, setLeaveReviewOpen] = useState(false);
  const [reextractOpen, setReextractOpen] = useState(false);
  const [catalogQueries, setCatalogQueries] = useState({});
  const [createPartLineId, setCreatePartLineId] = useState("");
  const [activeLineId, setActiveLineId] = useState("");
  const [reviewPane, setReviewPane] = useState("review");
  const [compactReview, setCompactReview] = useState(() => typeof window !== "undefined" && Boolean(window.matchMedia?.(COMPACT_REVIEW_QUERY).matches));
  const fileInputRef = useRef(null);
  const reviewTitleRef = useRef(null);
  const reviewKeyRef = useRef("");
  const activeRunRef = useRef(null);
  const batchRunsRef = useRef([]);
  const batchTokenRef = useRef("");
  const savedRunRequestRef = useRef({ id: "", controller: null });
  const purchaseOrderSuggestionRequestRef = useRef(null);
  const uploadOpen = controlledUploadOpen ?? internalUploadOpen;
  const receiptLocationId = run?.locationId || locationId;
  const receiptPositionIdentity = run?.id && receiptLocationId ? `${run.id}:${run.version}:${receiptLocationId}` : "";

  function setUploadOpen(open) {
    if (controlledUploadOpen === undefined) setInternalUploadOpen(open);
    onUploadOpenChange?.(open);
  }

  const reviewBreadcrumbLabel = String(draft?.invoiceNumber?.value || run?.fileName || "Invoice review").trim();

  useEffect(() => {
    onContextChange?.(draft ? {
      label: reviewBreadcrumbLabel,
      onBack: clearBatch,
    } : null);
  }, [Boolean(draft), busy, onContextChange, reviewBreadcrumbLabel, reviewDirty, run?.status]);

  useEffect(() => () => onContextChange?.(null), [onContextChange]);

  useEffect(() => {
    if (draft && uploadOpen) setUploadOpen(false);
  }, [Boolean(draft), uploadOpen]);

  useEffect(() => {
    if (Array.isArray(availableLocations)) {
      setLocations(availableLocations);
      setLocationId((current) => (
        availableLocations.some((location) => location.id === initialLocationId)
          ? initialLocationId
          : current || availableLocations[0]?.id || ""
      ));
      return undefined;
    }
    api("/api/office/template")
      .then((result) => {
        const available = (result.locations || []).map((entry) => entry.location).filter(Boolean);
        setLocations(available);
        setLocationId((current) => current || available[0]?.id || "");
      })
      .catch((nextError) => setError(nextError.message));
  }, [availableLocations, initialLocationId]);

  useEffect(() => {
    const savedRunId = new URLSearchParams(window.location.search).get("invoiceRun");
    if (!savedRunId) return;
    loadSavedRun(savedRunId, false);
  }, []);

  useEffect(() => {
    if (!draft || !reviewTitleRef.current) return;
    reviewTitleRef.current.focus({ preventScroll: true });
  }, [draft]);

  useEffect(() => {
    if (typeof window === "undefined" || !window.matchMedia) return undefined;
    const media = window.matchMedia(COMPACT_REVIEW_QUERY);
    const updateCompactReview = (event) => setCompactReview(event.matches);
    setCompactReview(media.matches);
    media.addEventListener?.("change", updateCompactReview);
    return () => media.removeEventListener?.("change", updateCompactReview);
  }, []);

  const draftLineKey = draft?.lines?.map((line) => line.id).join("|") || "";
  useEffect(() => {
    setActiveLineId((current) => draft?.lines?.some((line) => line.id === current) ? current : firstInvoiceLineId(draft?.lines));
  }, [draftLineKey, run?.id]);

  useEffect(() => () => {
    batchTokenRef.current = "";
    savedRunRequestRef.current.controller?.abort();
    savedRunRequestRef.current = { id: "", controller: null };
    purchaseOrderSuggestionRequestRef.current?.abort();
  }, []);

  useEffect(() => {
    purchaseOrderSuggestionRequestRef.current?.abort();
    setPurchaseOrderSuggestion(null);
    setPurchaseOrderSuggestionError("");
    if (!run?.id || run.status !== "reviewed") {
      setPurchaseOrderSuggestionLoading(false);
      return undefined;
    }
    const controller = new AbortController();
    purchaseOrderSuggestionRequestRef.current = controller;
    setPurchaseOrderSuggestionLoading(true);
    api(`/api/office/invoice-extractions/${encodeURIComponent(run.id)}/purchase-order-suggestions`, { signal: controller.signal })
      .then((result) => {
        if (controller.signal.aborted) return;
        if (!result || !["suggestions", "none", "ambiguous", "review_required"].includes(result.kind)) throw new Error("Purchase order review returned an unsupported result.");
        if (result.version !== undefined && Number(result.version) !== Number(run.version)) throw new Error("The invoice changed while purchase orders were checked. Retry with the current review.");
        setPurchaseOrderSuggestion(result);
      })
      .catch((nextError) => {
        if (!controller.signal.aborted) setPurchaseOrderSuggestionError(nextError.message || "Purchase order suggestions could not be loaded.");
      })
      .finally(() => {
        if (!controller.signal.aborted) setPurchaseOrderSuggestionLoading(false);
      });
    return () => controller.abort();
  }, [run?.id, run?.version, run?.status, receipt?.status, purchaseOrderSuggestionReload]);

  useEffect(() => {
    setReceiptPositions([]);
    setReceiptPositionsError("");
  }, [receiptPositionIdentity]);

  useEffect(() => {
    if (!receiptPositionIdentity || run?.status !== "reviewed") {
      setReceiptPositionsLoading(false);
      return undefined;
    }
    let active = true;
    setReceiptPositionsLoading(true);
    setReceiptPositionsError("");
    api(`/api/office/inventory/locations/${encodeURIComponent(receiptLocationId)}/positions`)
      .then((result) => {
        if (active) setReceiptPositions(result.positions || result.items || []);
      })
      .catch((nextError) => {
        if (active) setReceiptPositionsError(nextError.message || "Storage destinations could not be loaded.");
      })
      .finally(() => {
        if (active) setReceiptPositionsLoading(false);
      });
    return () => { active = false; };
  }, [receiptPositionIdentity, receiptPositionsReload, run?.status]);

  useEffect(() => {
    const activeUploadId = batchRuns[batchIndex]?.uploadId;
    const activeFile = uploads.find((upload) => upload.id === activeUploadId)?.file || null;
    if (!activeFile) {
      setPreviewUrl("");
      return undefined;
    }
    const nextUrl = URL.createObjectURL(activeFile);
    setPreviewUrl(nextUrl);
    return () => URL.revokeObjectURL(nextUrl);
  }, [batchIndex, batchRuns, uploads]);

  useEffect(() => {
    if (!message || busy) return undefined;
    const timer = window.setTimeout(() => setMessage(""), STATUS_DISMISS_MS);
    return () => window.clearTimeout(timer);
  }, [busy, message]);

  const reviewCount = useMemo(() => {
    if (!draft) return 0;
    return [
      ...INVOICE_HEADER_FIELDS.map(([name, , , options]) => ({ field: draft[name], options })),
      ...draft.lines.flatMap((line) => [line.partNumber, line.description, line.quantity, line.unitOfMeasure, line.unitPrice, line.lineTotal]),
    ].filter((candidate) => candidate?.field
      ? invoiceFieldNeedsReview(candidate.field, candidate.options)
      : Number(candidate?.confidence) < 90).length;
  }, [draft]);
  const invoiceDetailFields = useMemo(() => INVOICE_HEADER_FIELDS.filter(([name]) => INVOICE_DETAIL_FIELDS.has(name)), []);
  const totalFields = useMemo(() => INVOICE_HEADER_FIELDS.filter(([name]) => TOTAL_FIELDS.has(name)), []);
  const deliveryFields = useMemo(() => INVOICE_HEADER_FIELDS.filter(([name]) => name === "purchaseOrderNumber"), []);
  const orderedLines = useMemo(() => orderInvoiceLinesForReview(draft?.lines), [draft?.lines]);
  const invoiceDetailIssues = useMemo(() => invoiceDetailFields.filter(([name, , , options]) => invoiceFieldNeedsReview(draft?.[name], options)).length, [draft, invoiceDetailFields]);
  const totalsIssues = useMemo(() => totalFields.filter(([name, , , options]) => invoiceFieldNeedsReview(draft?.[name], options)).length, [draft, totalFields]);
  const deliveryIssues = useMemo(() => deliveryFields.filter(([name, , , options]) => invoiceFieldNeedsReview(draft?.[name], options)).length, [draft, deliveryFields]);
  const lineIssues = useMemo(() => (draft?.lines || []).filter((line) => invoiceLineNeedsReview(line)).length, [draft?.lines]);
  const batchProgress = useMemo(() => ({
    ready: batchRuns.filter((entry) => entry.run.draft && !entry.error).length,
    processing: batchRuns.filter((entry) => entry.run.status === "processing" && !entry.error).length,
    failed: batchRuns.filter((entry) => entry.error || entry.run.status === "failed").length,
  }), [batchRuns]);
  const displayedPreviewUrl = previewUrl || (run?.sourceAvailable
    ? `/api/office/invoice-extractions/${encodeURIComponent(run.id)}/source`
    : "");
  const selectedLocation = locations.find((location) => location.id === locationId) || null;
  const activeUploadId = batchRuns[batchIndex]?.uploadId;
  const activeFile = uploads.find((upload) => upload.id === activeUploadId)?.file || null;

  async function loadSavedRun(savedRunId, updateUrl = true) {
    savedRunRequestRef.current.controller?.abort();
    const requestId = crypto.randomUUID();
    const controller = new AbortController();
    savedRunRequestRef.current = { id: requestId, controller };
    setBusy("reload");
    setError("");
    try {
      const { run: savedRun } = await api(`/api/office/invoice-extractions/${encodeURIComponent(savedRunId)}`, {
        signal: controller.signal,
      });
      if (savedRunRequestRef.current.id !== requestId) return;
      if (!savedRun.draft) throw new Error(savedRun.status === "processing" ? "This extraction is still processing." : "This extraction has no reviewable draft.");
      setRun(savedRun);
      activeRunRef.current = savedRun;
      setDraft(savedRun.draft);
      setReviewDirty(false);
      setReceipt(savedRun.inventoryReceipt || null);
      setReceiptEpisode(0);
      setMessage(savedRun.sourceAvailable
        ? "Saved invoice draft and secure source restored."
        : "Saved invoice draft restored. Its source is no longer available.");
      if (updateUrl) rememberRun(savedRun.id);
    } catch (nextError) {
      if (savedRunRequestRef.current.id === requestId) setError(nextError.message);
    } finally {
      if (savedRunRequestRef.current.id === requestId) {
        savedRunRequestRef.current = { id: "", controller: null };
        setBusy("");
      }
    }
  }

  function openHistoryRun(runId) {
    setHistoryReturnFocusId(runId);
    loadSavedRun(runId);
  }

  function selectInvoiceFiles(files) {
    const selection = validateInvoiceSelection(files, {
      acceptedTypes: ACCEPTED_TYPES,
      maxBytes: MAX_FILE_BYTES,
      maxFiles: MAX_BATCH_FILES,
    });
    setError("");
    setMessage("");
    if (selection.error) {
      setUploads([]);
      setError(selection.error);
      return false;
    }
    setUploads(selection.files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      idempotencyKey: `extract-${crypto.randomUUID()}`,
    })));
    return true;
  }

  function chooseFiles(event) {
    if (!selectInvoiceFiles(event.target.files)) event.target.value = "";
  }

  function dropFiles(event) {
    event.preventDefault();
    if (busy === "extract") return;
    selectInvoiceFiles(event.dataTransfer.files);
  }

  function discardBatch() {
    batchTokenRef.current = crypto.randomUUID();
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploads([]);
    setBatchRuns([]);
    batchRunsRef.current = [];
    setBatchIndex(0);
    setRun(null);
    activeRunRef.current = null;
    setDraft(null);
    setBusy("");
    setApproveLearning(false);
    setMessage("");
    setError("");
    setReceipt(null);
    setReceiptEpisode(0);
    setReviewDirty(false);
    setLeaveReviewOpen(false);
    setReextractOpen(false);
    reviewKeyRef.current = "";
    rememberRun();
  }

  function clearBatch() {
    if (busy) return;
    if (shouldConfirmInvoiceReviewLeave({ dirty: reviewDirty, status: run?.status })) {
      setLeaveReviewOpen(true);
      return;
    }
    discardBatch();
  }

  async function waitForCompletedRun(initialRun, isCurrent = () => true) {
    let current = initialRun;
    for (let attempt = 0; attempt < 120 && current?.status === "processing"; attempt += 1) {
      if (!isCurrent()) return null;
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      if (!isCurrent()) return null;
      current = (await api(`/api/office/invoice-extractions/${encodeURIComponent(current.id)}`)).run;
    }
    if (current?.status === "processing") throw new Error("Extraction is still running. Open the invoice again in a moment.");
    if (current?.status === "failed") throw new Error("The invoice could not be extracted. Try again.");
    return current;
  }

  function rememberRun(runId = "") {
    const url = new URL(window.location.href);
    url.searchParams.set("view", embedded ? "inventory" : "invoices");
    if (embedded && url.searchParams.has("adminView")) url.searchParams.set("adminView", "inventory");
    if (runId) url.searchParams.set("invoiceRun", runId);
    else url.searchParams.delete("invoiceRun");
    if (embedded && !runId) url.searchParams.set("inventoryAction", "upload-invoice");
    else url.searchParams.delete("inventoryAction");
    window.history.replaceState({}, "", url);
  }

  function showBatchEntry(entry, index) {
    activeRunRef.current = entry.run;
    setBatchIndex(index);
    setRun(entry.run);
    setDraft(entry.run.draft);
    setReceipt(entry.run.inventoryReceipt || null);
    setReceiptEpisode(0);
    setApproveLearning(false);
    setReviewDirty(false);
    reviewKeyRef.current = "";
    rememberRun(entry.run.id);
  }

  function replaceBatchEntry(runId, transform) {
    const updated = batchRunsRef.current.map((entry) => entry.run.id === runId ? transform(entry) : entry);
    batchRunsRef.current = updated;
    setBatchRuns(updated);
  }

  async function enqueueUploadsInLanes(selectedUploads, token) {
    const results = new Array(selectedUploads.length);
    let cursor = 0;
    async function runLane() {
      while (cursor < selectedUploads.length && batchTokenRef.current === token) {
        const index = cursor;
        cursor += 1;
        const upload = selectedUploads[index];
        try {
          const result = await api("/api/office/invoice-extractions", {
            method: "POST",
            timeoutMs: 15_000,
            body: JSON.stringify({
              locationId,
              fileName: upload.file.name,
              mimeType: upload.file.type,
              dataUrl: await readFileDataUrl(upload.file),
              idempotencyKey: upload.idempotencyKey,
            }),
          });
          results[index] = { uploadId: upload.id, fileName: upload.file.name, run: result.run };
        } catch (nextError) {
          results[index] = { uploadId: upload.id, fileName: upload.file.name, error: nextError.message };
        }
      }
    }
    const laneCount = Math.min(MAX_ENQUEUE_CONCURRENCY, selectedUploads.length);
    await Promise.all(Array.from({ length: laneCount }, () => runLane()));
    return results.filter(Boolean);
  }

  function monitorBatchEntry(entry, token) {
    return waitForCompletedRun(entry.run, () => batchTokenRef.current === token)
      .then((completedRun) => {
        if (!completedRun || batchTokenRef.current !== token) return null;
        const completedEntry = { ...entry, run: completedRun, error: "" };
        const currentIndex = batchRunsRef.current.findIndex((candidate) => candidate.run.id === entry.run.id);
        replaceBatchEntry(entry.run.id, () => completedEntry);
        if (!activeRunRef.current || activeRunRef.current.status === "reviewed") {
          showBatchEntry(completedEntry, currentIndex);
          setBusy((current) => current === "extract" ? "" : current);
          setMessage(queuedBatchMessage(entry.fileName, batchRunsRef.current.length));
        }
        return completedEntry;
      })
      .catch((nextError) => {
        if (batchTokenRef.current !== token) return null;
        replaceBatchEntry(entry.run.id, (current) => ({ ...current, error: nextError.message }));
        return null;
      });
  }

  async function extract(event) {
    event.preventDefault();
    if (!uploads.length || !locationId) return;
    setBusy("extract");
    setError("");
    setBatchRuns([]);
    batchRunsRef.current = [];
    setBatchIndex(0);
    setRun(null);
    activeRunRef.current = null;
    setDraft(null);
    setReviewDirty(false);
    setReceipt(null);
    setReceiptEpisode(0);
    const token = crypto.randomUUID();
    batchTokenRef.current = token;
    setMessage(`Queueing ${uploads.length} invoice${uploads.length === 1 ? "" : "s"}…`);
    const queuedResults = await enqueueUploadsInLanes(uploads, token);
    if (batchTokenRef.current !== token) return;
    const queued = queuedResults.filter((entry) => entry.run);
    const uploadFailures = queuedResults.filter((entry) => entry.error);
    setBatchRuns(queued);
    batchRunsRef.current = queued;
    if (!queued.length) {
      setBusy("");
      setError(uploadFailures.map((entry) => `${entry.fileName}: ${entry.error}`).join(" ") || "The invoices could not be queued. Try again.");
      setMessage("");
      return;
    }
    if (uploadFailures.length) {
      setError(`${uploadFailures.length} invoice${uploadFailures.length === 1 ? "" : "s"} could not be queued. The remaining invoices will continue.`);
    }
    setMessage(`${queued.length} invoice${queued.length === 1 ? " is" : "s are"} extracting. Review will open as soon as the first draft is ready.`);
    const monitors = queued.map((entry) => monitorBatchEntry(entry, token));
    Promise.all(monitors).then((results) => {
      if (batchTokenRef.current !== token) return;
      setBusy((current) => current === "extract" ? "" : current);
      const readyCount = results.filter(Boolean).length;
      const extractionFailures = queued.length - readyCount;
      if (!readyCount) {
        setError("None of the queued invoices could be extracted. Try the invoices again.");
        setMessage("");
      } else if (extractionFailures) {
        setError(`${extractionFailures} queued invoice${extractionFailures === 1 ? "" : "s"} could not be extracted. ${readyCount} ${readyCount === 1 ? "draft is" : "drafts are"} available.`);
      } else {
        setMessage(`All ${readyCount} invoice draft${readyCount === 1 ? " is" : "s are"} ready.`);
      }
    });
  }

  async function approve() {
    setBusy("review");
    setError("");
    setMessage("Saving reviewed invoice…");
    try {
      const result = await api(`/api/office/invoice-extractions/${encodeURIComponent(run.id)}/review`, {
        method: "POST",
        body: JSON.stringify({
          expectedVersion: run.version,
          idempotencyKey: reviewKeyRef.current || (reviewKeyRef.current = `review-${crypto.randomUUID()}`),
          reviewedDraft: draft,
          confirmNoLineItems: draft.lines.length === 0,
          approveLearning,
        }),
      });
      const updatedBatchRuns = batchRunsRef.current.map((entry) => entry.run.id === run.id ? { ...entry, run: result.run } : entry);
      setBatchRuns(updatedBatchRuns);
      batchRunsRef.current = updatedBatchRuns;
      activeRunRef.current = result.run;
      setReviewDirty(false);
      const nextIndex = nextReviewableBatchIndex(updatedBatchRuns, batchIndex);
      if (nextIndex >= 0) {
        const nextEntry = updatedBatchRuns[nextIndex];
        showBatchEntry(nextEntry, nextIndex);
        setMessage(`Invoice ${batchIndex + 1} saved. Review invoice ${nextIndex + 1} of ${updatedBatchRuns.length}.`);
      } else {
        setRun(result.run);
        setDraft(result.run.draft);
        rememberRun(result.run.id);
        setMessage(approveLearning
          ? `Reviewed invoice saved with ${result.correctionCount} correction${result.correctionCount === 1 ? "" : "s"}. Your approved example can guide future OpenAI extraction; inventory was not changed.`
          : `Reviewed invoice saved with ${result.correctionCount} correction${result.correctionCount === 1 ? "" : "s"}. It was excluded from learning; inventory was not changed.`);
      }
    } catch (nextError) {
      setError(invoiceReviewErrorMessage(nextError));
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function reextract() {
    if (!run?.id || busy) return;
    setReextractOpen(false);
    setBusy("reextract");
    setError("");
    setMessage("Re-extracting invoice from the original file…");
    try {
      const result = await api(`/api/office/invoice-extractions/${encodeURIComponent(run.id)}/reextract`, {
        method: "POST",
        body: JSON.stringify({ idempotencyKey: `reextract-${crypto.randomUUID()}` }),
      });
      const completedRun = await waitForCompletedRun(result.run);
      const entry = { uploadId: "", fileName: completedRun.fileName, run: completedRun };
      setUploads([]);
      setBatchRuns([entry]);
      batchRunsRef.current = [entry];
      showBatchEntry(entry, 0);
      setMessage("New extraction ready. The previous invoice record remains in history.");
    } catch (nextError) {
      setError(nextError.message);
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  async function confirmPhysicalReceipt(posting = {}) {
    setBusy("receive");
    setError("");
    setMessage("Adding reviewed parts to local inventory…");
    const commandStorageKey = `invoice-receipt-command:${run.id}`;
    let idempotencyKey = localStorage.getItem(commandStorageKey);
    if (!idempotencyKey) {
      idempotencyKey = crypto.randomUUID();
      localStorage.setItem(commandStorageKey, idempotencyKey);
    }
    try {
      const result = await api(`/api/office/invoice-extractions/${encodeURIComponent(run.id)}/confirm-receipt`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey,
          expectedVersion: run.version,
          postingRoute: posting.postingRoute,
          allocationPlan: posting.allocationPlan || [],
          noPurchaseOrderReason: posting.noPurchaseOrderReason || "",
          receiptLines: posting.receiptLines || [],
        }),
      });
      localStorage.removeItem(commandStorageKey);
      setReceipt(result.receipt);
      setReceiptEpisode((current) => current + 1);
      setPurchaseOrderSuggestionReload((value) => value + 1);
      setMessage(`${result.receipt.lineCount} part line${result.receipt.lineCount === 1 ? "" : "s"} added to ${result.receipt.locationName}.`);
    } catch (nextError) {
      if (nextError?.code === "INVENTORY_RECEIPT_POSITION_INVALID") setReceiptPositionsReload((value) => value + 1);
      setError(nextError.message);
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  const invoiceFullyReceived = invoiceDeliveryFullyReceived({ receipt, suggestion: purchaseOrderSuggestion });

  function updateHeader(name, value) {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setDraft((current) => updateInvoiceField(current, name, value));
  }

  function updateLine(lineId, name, value, type = "text") {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setDraft((current) => {
      const next = updateInvoiceLineField(current, lineId, name, type === "number" ? parseReviewNumber(value) : value);
      if (!["partNumber", "unitOfMeasure"].includes(name)) return next;
      return { ...next, lines: next.lines.map((line) => line.id === lineId ? (({ catalogPartId: _removed, ...rest }) => rest)(line) : line) };
    });
  }

  function useCatalogPart(lineId, part) {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setCatalogQueries((current) => ({ ...current, [lineId]: part.partNumber }));
    setDraft((current) => {
      let next = updateInvoiceLineField(current, lineId, "partNumber", part.partNumber);
      next = updateInvoiceLineField(next, lineId, "description", part.description || "");
      next = updateInvoiceLineField(next, lineId, "unitOfMeasure", part.uomCode || "ea");
      return { ...next, lines: next.lines.map((line) => line.id === lineId ? { ...line, catalogPartId: part.id } : line) };
    });
    setMessage(`${part.partNumber} matched to this invoice line. Inventory is unchanged.`);
  }

  function addInvoiceLine() {
    const lineId = `manual-${crypto.randomUUID()}`;
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setDraft((current) => addBlankInvoiceLine(current, lineId));
    setActiveLineId(lineId);
  }

  function removeInvoiceReviewLine(lineId) {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setActiveLineId(nextInvoiceLineIdAfterRemoval(draft.lines, lineId));
    setDraft((current) => removeInvoiceLine(current, lineId));
  }

  function activateReviewPane(nextPane, event) {
    setReviewPane(nextPane);
    if (event?.type === "keydown") window.requestAnimationFrame(() => document.getElementById(`invoice-${nextPane}-tab`)?.focus());
  }

  function handleReviewPaneKeyDown(event) {
    if (!["ArrowLeft", "ArrowRight", "Home", "End"].includes(event.key)) return;
    event.preventDefault();
    activateReviewPane(event.key === "ArrowLeft" || event.key === "Home" ? "document" : "review", event);
  }

  const uploadDialog = (
    <UploadDialog
      title="Upload invoices"
      closeLabel="Close invoice upload"
      isOpen={uploadOpen && !draft}
      isDismissable={busy !== "extract"}
      closeDisabled={busy === "extract"}
      onOpenChange={(open) => { if (busy !== "extract") setUploadOpen(open); }}
      error={error}
      status={message}
      actions={uploads.length ? <Button form="invoice-upload-form" variant="primary" icon={busy === "extract" ? LoadingRefreshIcon : UploadCloud02} type="submit" disabled={!locationId || Boolean(busy)}>{busy === "extract" ? "Extracting…" : `Extract ${uploads.length} invoice${uploads.length === 1 ? "" : "s"}`}</Button> : null}
      footer={<p>Encrypted · Training use requires your approval</p>}
    >
          <form id="invoice-upload-form" onSubmit={extract}>
            <label className="shared-upload-field" htmlFor="invoice-upload-location"><span>Shop</span><Dropdown id="invoice-upload-location" value={locationId} onChange={(event) => setLocationId(event.target.value)} required disabled={!locations.length}><option value="">{selectedLocation ? "Select shop" : "Loading shop…"}</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</Dropdown></label>
            <UploadDropzone inputId="invoice-file" inputRef={fileInputRef} accept="image/png,image/jpeg,image/webp,application/pdf" onChange={chooseFiles} onDrop={dropFiles} multiple disabled={busy === "extract"} text={uploads.length ? "Choose different invoices" : "Drop files here or browse"} hint="PDF or image · 10 MB each" />
            {uploads.length ? <div className="invoice-selected-files"><div><strong>{uploads.length} invoice{uploads.length === 1 ? "" : "s"} selected</strong><Button type="button" onClick={clearBatch} disabled={busy === "extract"}>Clear</Button></div><ul>{uploads.map((upload) => <li key={upload.id}><File02 /><span><strong>{upload.file.name}</strong><small>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</small></span></li>)}</ul></div> : null}
          </form>
    </UploadDialog>
  );

  const leaveReviewDialog = (
    <ModalOverlay className="invoice-upload-overlay" isOpen={leaveReviewOpen} isDismissable onOpenChange={(open) => !open && setLeaveReviewOpen(false)}>
      <Modal className="invoice-upload-modal">
        <Dialog className="invoice-upload-dialog invoice-review-leave-dialog" aria-labelledby="invoice-review-leave-title">
          <div className="invoice-upload-dialog-heading">
            <div><Heading slot="title" id="invoice-review-leave-title">Discard invoice changes?</Heading><p>Your unsaved corrections will be lost.</p></div>
            <button type="button" aria-label="Keep editing" onClick={() => setLeaveReviewOpen(false)}><XClose aria-hidden="true" /></button>
          </div>
          <div className="invoice-upload-dialog-actions">
            <Button type="button" onClick={() => setLeaveReviewOpen(false)}>Keep editing</Button>
            <Button type="button" variant="danger" onClick={discardBatch}>Discard changes</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  const reextractDialog = (
    <ModalOverlay className="invoice-upload-overlay" isOpen={reextractOpen} isDismissable={!busy} onOpenChange={(open) => { if (!busy) setReextractOpen(open); }}>
      <Modal className="invoice-upload-modal">
        <Dialog className="invoice-upload-dialog invoice-review-leave-dialog" aria-labelledby="invoice-reextract-title">
          <div className="invoice-upload-dialog-heading">
            <div><Heading slot="title" id="invoice-reextract-title">Re-extract this invoice?</Heading><p>A new draft will be created from the original file. The current invoice stays in history and inventory will not change.</p></div>
            <button type="button" aria-label="Close re-extraction confirmation" onClick={() => setReextractOpen(false)} disabled={Boolean(busy)}><XClose aria-hidden="true" /></button>
          </div>
          {reviewDirty ? <p className="invoice-reextract-warning" role="alert">Unsaved edits are not copied into the new extraction.</p> : null}
          <div className="invoice-upload-dialog-actions">
            <Button type="button" onClick={() => setReextractOpen(false)}>Keep current extraction</Button>
            <Button type="button" variant="primary" icon={RefreshCw01} onClick={reextract}>Re-extract invoice</Button>
          </div>
        </Dialog>
      </Modal>
    </ModalOverlay>
  );

  if (draft) {
    const deliveryComplete = invoiceFullyReceived;
    const deliveryReversed = receipt?.status === "reversed";
    const deliveryPending = run.status === "reviewed" && !deliveryComplete && !deliveryReversed;
    const partialReceiptPosted = receipt?.status === "posted" && deliveryPending;
    const reviewSections = orderInvoiceReviewSections([
      { id: "details", unresolved: invoiceDetailIssues > 0 },
      { id: "items", unresolved: lineIssues > 0 },
      { id: "totals", unresolved: totalsIssues > 0 },
      { id: "delivery", unresolved: deliveryPending || deliveryIssues > 0 },
    ]);
    return (
      <>{uploadDialog}{leaveReviewDialog}{reextractDialog}<section className="invoice-extraction-workspace" aria-labelledby="invoice-review-title">
        <header className="invoice-review-header">
          <div>
            <span className="invoice-draft-label">{receipt?.status === "posted" ? "Added · local inventory updated" : receipt?.status === "reversed" ? "Reversed · local inventory adjusted" : "Draft · inventory unchanged"}</span>
            {batchRuns.length > 1 ? <span className="invoice-batch-position">Invoice {batchIndex + 1} of {batchRuns.length} · {batchProgress.ready} ready{batchProgress.processing ? ` · ${batchProgress.processing} extracting` : ""}{batchProgress.failed ? ` · ${batchProgress.failed} failed` : ""}</span> : null}
            <h2 ref={reviewTitleRef} tabIndex={-1} id="invoice-review-title">Review {run.fileName}</h2>
            <p>{reviewCount ? `${reviewCount} values need attention.` : "No low-confidence values. Confirm before approval."}</p>
          </div>
          {run.sourceAvailable ? <Button type="button" icon={busy === "reextract" ? LoadingRefreshIcon : RefreshCw01} onClick={() => setReextractOpen(true)} disabled={Boolean(busy) || receipt?.status === "posted"} title={receipt?.status === "posted" ? "Reverse the posted receipt before re-extracting" : "Create a new extraction from the original file"}>{busy === "reextract" ? "Re-extracting…" : "Re-extract"}</Button> : null}
        </header>
        <div className="invoice-review-switch" role="tablist" aria-label="Invoice review view" onKeyDown={handleReviewPaneKeyDown}>
          <button id="invoice-document-tab" type="button" role="tab" aria-selected={reviewPane === "document"} aria-controls="invoice-document-panel" tabIndex={reviewPane === "document" ? 0 : -1} onClick={() => activateReviewPane("document")}>Document</button>
          <button id="invoice-review-tab" type="button" role="tab" aria-selected={reviewPane === "review"} aria-controls="invoice-review-panel" tabIndex={reviewPane === "review" ? 0 : -1} onClick={() => activateReviewPane("review")}>Review{reviewCount ? ` · ${reviewCount}` : ""}</button>
        </div>
        <div className="invoice-review-layout">
          <div id="invoice-document-panel" className="invoice-review-panel invoice-source-panel" role="tabpanel" aria-labelledby="invoice-document-tab" hidden={compactReview && reviewPane !== "document"}>
            <InvoiceDocumentViewer sourceUrl={displayedPreviewUrl} mimeType={activeFile?.type || run.mimeType} fileName={run.fileName} />
          </div>
          <div id="invoice-review-panel" className="invoice-review-panel invoice-review-form invoice-review-rail" role="tabpanel" aria-labelledby="invoice-review-tab" hidden={compactReview && reviewPane !== "review"}>
            {error ? <p className="ops-error" role="alert">{error}</p> : null}
            {message ? <p className="invoice-status" role="status">{message}</p> : null}
            {receipt?.status === "posted" ? (
              <section className="inventory-label-result" aria-labelledby="inventory-label-title">
                <div className="inventory-label-heading">
                  <div><span>Local receipt</span><h3 id="inventory-label-title">Inventory added at {receipt.locationName}</h3></div>
                  {receipt.labelBatch?.printUrl && receipt.units?.length ? <Button type="button" onClick={() => window.open(receipt.labelBatch.printUrl, "_blank", "noopener,noreferrer")}>Print {receipt.labelBatch.itemCount} serialized label{receipt.labelBatch.itemCount === 1 ? "" : "s"}</Button> : null}
                </div>
                <p>{receipt.lineCount} part line{receipt.lineCount === 1 ? "" : "s"} posted. Quantities remain in each line’s unit. {deliveryComplete ? "All invoice quantities are received." : "Remaining quantities can be received in another episode."}</p>
                {receipt.units?.length ? <div className="inventory-label-grid">
                  {receipt.units.slice(0, 12).map((unit) => <article className="inventory-unit-label" key={unit.id}>
                    <img src={unit.qrSvgUrl} alt={`QR code for serial ${unit.serialNumber}`} />
                    <div><strong>{unit.partNumber}</strong><span>{unit.description || "Inventory part"}</span><code>{unit.serialNumber}</code></div>
                  </article>)}
                </div> : null}
                {receipt.units?.length > 12 ? <p>Showing 12 of {receipt.units.length} labels. Open the printable batch for the complete set.</p> : null}
                {receipt.labelsUnavailable ? <p className="ops-error" role="alert">{receipt.labelsUnavailable}</p> : null}
              </section>
            ) : receipt?.status === "reversed" ? <p className="invoice-reversed-status" role="status">This receipt was reversed. Its QR batch remains historical and inventory is no longer marked as added.</p> : null}
            {draft.warnings.length ? (
              <details className="invoice-review-notes">
                <summary>{draft.warnings.length} extraction note{draft.warnings.length === 1 ? "" : "s"}</summary>
                <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
              </details>
            ) : null}
            {reviewSections.map((section) => {
              if (section.id === "details") return <ReviewSection key={`${run.id}-${section.id}`} sectionId="invoice-details" title="Invoice details" summary={`${reviewValue(draft.vendorName, "Vendor not extracted")} · ${reviewValue(draft.invoiceNumber, "No invoice number")}`} issueCount={invoiceDetailIssues} readOnly={run.status === "reviewed"} defaultOpen={invoiceDetailIssues > 0}>
                <div className="invoice-fields-grid">{orderReviewFields(invoiceDetailFields, draft).map(([name, label, type, options]) => <Field key={name} fieldName={name} label={label} type={type} options={options} draft={draft} onChange={updateHeader} disabled={run.status === "reviewed"} />)}</div>
              </ReviewSection>;
              if (section.id === "items") return <ReviewSection key={`${run.id}-${section.id}`} sectionId="invoice-items" title="Items" summary={`${draft.lines.length} line${draft.lines.length === 1 ? "" : "s"}${lineIssues ? ` · ${lineIssues} need attention` : " · Ready"}`} issueCount={lineIssues} readOnly={run.status === "reviewed"} defaultOpen={lineIssues > 0}>
                <div className="invoice-lines-heading"><span>Unresolved lines appear first</span>{run.status !== "reviewed" ? <Button type="button" onClick={addInvoiceLine}>Add missing line</Button> : null}</div>
                <div className="invoice-lines">{orderedLines.map((line) => {
                  const lineNumber = draft.lines.findIndex((candidate) => candidate.id === line.id) + 1;
                  const active = activeLineId === line.id;
                  const needsReview = invoiceLineNeedsReview(line);
                  return <article className={`invoice-line-row${active ? " is-active" : ""}${needsReview ? " has-issues" : ""}`} key={line.id}>
                    <button type="button" className="invoice-line-summary" aria-expanded={active} aria-controls={`invoice-line-editor-${line.id}`} onClick={() => setActiveLineId(active ? "" : line.id)}><span><strong>Line {lineNumber} · {reviewValue(line.partNumber, "No part number")}</strong><small>{reviewValue(line.description, "No description")}</small></span><span className="invoice-line-quantity">{line.quantity.value ?? "—"} {reviewValue(line.unitOfMeasure, "")}</span><span className="invoice-line-total">{reviewAmount(line.lineTotal, reviewValue(draft.currency, ""))}</span><span className={`invoice-line-state${needsReview ? " has-issues" : ""}`}>{needsReview ? "Review" : "Ready"}</span><span className="invoice-line-edit">{active ? "Close" : run.status === "reviewed" ? "View" : "Edit"}</span></button>
                    {active ? <fieldset id={`invoice-line-editor-${line.id}`} className="invoice-line-card"><legend>Line {lineNumber} editor</legend>{run.status !== "reviewed" ? <div className="invoice-line-catalog-tools"><PartCatalogCombobox locationId={run.locationId || locationId} purpose="master_match" value={catalogQueries[line.id] ?? String(line.partNumber.value || "")} onChange={(value) => setCatalogQueries((current) => ({ ...current, [line.id]: value }))} onSelect={(part) => useCatalogPart(line.id, part)} label="Inventory part" inputAriaLabel={`Find inventory part for invoice line ${lineNumber}`} placeholder="Find existing inventory part" catalogEndpoint="/api/office/inventory/catalog" resultLimit={12} popupAriaLabel={`Inventory parts for invoice line ${lineNumber}`} /><Button type="button" onClick={() => setCreatePartLineId(line.id)}>Create new part</Button><small>Choose an existing part or create one. Review save and inventory receipt remain separate.</small></div> : null}{["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"].map((name) => { const label = { partNumber: "Part number", description: "Description", quantity: "Quantity", unitOfMeasure: "Unit", unitPrice: "Unit price", lineTotal: "Line total" }[name]; const type = ["quantity", "unitPrice", "lineTotal"].includes(name) ? "number" : "text"; return <label key={name} className={line[name].confidence < 90 ? "needs-review" : ""}><span>{label}</span><input type={type} step={type === "number" ? "0.001" : undefined} value={line[name].value ?? ""} readOnly={run.status === "reviewed"} onChange={(event) => updateLine(line.id, name, event.target.value, type)} /><Confidence field={line[name]} /></label>; })}{run.status !== "reviewed" ? <Button type="button" icon={Trash01} className="invoice-remove-line" onClick={() => removeInvoiceReviewLine(line.id)}>Remove line</Button> : null}</fieldset> : null}
                  </article>;
                })}</div>
              </ReviewSection>;
              if (section.id === "totals") return <ReviewSection key={`${run.id}-${section.id}`} sectionId="invoice-totals" title="Totals" summary={reviewAmount(draft.total, reviewValue(draft.currency, ""))} issueCount={totalsIssues} readOnly={run.status === "reviewed"} defaultOpen={totalsIssues > 0}><div className="invoice-fields-grid">{orderReviewFields(totalFields, draft).map(([name, label, type, options]) => <Field key={name} fieldName={name} label={label} type={type} options={options} draft={draft} onChange={updateHeader} disabled={run.status === "reviewed"} />)}</div></ReviewSection>;
              return <ReviewSection key={`${run.id}-${section.id}`} sectionId="invoice-delivery" title="Delivery" summary={partialReceiptPosted ? "Partial receipt posted · receive remaining quantities" : deliveryPending ? "Confirm received quantities and purchase order route" : deliveryComplete ? "Inventory receipt completed" : deliveryReversed ? "Receipt reversed · inventory not added" : reviewValue(draft.purchaseOrderNumber, "No purchase order")} issueCount={deliveryIssues} status={deliveryPending ? "Pending" : deliveryComplete ? "Complete" : deliveryReversed ? "Reversed" : ""} readOnly={run.status === "reviewed"} defaultOpen={deliveryPending || deliveryIssues > 0}>
                <div className="invoice-fields-grid">{deliveryFields.map(([name, label, type, options]) => <Field key={name} fieldName={name} label={label} type={type} options={options} draft={draft} onChange={updateHeader} disabled={run.status === "reviewed"} />)}</div>
                {deliveryPending ? <PhysicalReceiptConfirmation receiptEpisode={receiptEpisode} busy={busy === "receive"} disabled={Boolean(busy) && busy !== "receive"} runId={run.id} runVersion={run.version} draft={draft} suggestion={purchaseOrderSuggestion} suggestionLoading={purchaseOrderSuggestionLoading} suggestionError={purchaseOrderSuggestionError} onRetrySuggestions={() => setPurchaseOrderSuggestionReload((value) => value + 1)} positions={receiptPositions} positionLoading={receiptPositionsLoading} positionError={receiptPositionsError} onRetryPositions={() => setReceiptPositionsReload((value) => value + 1)} onConfirm={confirmPhysicalReceipt} /> : deliveryComplete ? <p className="invoice-review-complete">All invoice quantities received</p> : deliveryReversed ? <p className="invoice-review-reversed">Receipt reversed · Inventory not added</p> : null}
              </ReviewSection>;
            })}
            {createPartLineId ? (() => {
              const sourceLine = draft.lines.find((line) => line.id === createPartLineId);
              return sourceLine ? <CreateInventoryPartDialog
                locationId={run.locationId || locationId}
                defaults={{ partNumber: sourceLine.partNumber.value, description: sourceLine.description.value, uomCode: sourceLine.unitOfMeasure.value }}
                onClose={() => setCreatePartLineId("")}
                onCreated={(part) => useCatalogPart(sourceLine.id, part)}
              /> : null;
            })() : null}
            {run.status !== "reviewed" ? <footer className="invoice-review-actions">
              <>
                  <details className="invoice-learning-option">
                    <summary>Learning preference</summary>
                    <label className="invoice-learning-choice"><Checkbox checked={approveLearning} onChange={(event) => { reviewKeyRef.current = ""; setReviewDirty(true); setApproveLearning(event.target.checked); }} /><span>Use my corrections to improve future invoice extraction</span></label>
                  </details>
                  <div className="invoice-review-primary">
                    <span>Saves review only · Inventory stays unchanged</span>
                    <Button type="button" variant="primary" icon={busy === "review" ? LoadingRefreshIcon : CheckCircle} onClick={approve} disabled={Boolean(busy)}>Approve review</Button>
                  </div>
              </>
            </footer> : null}
          </div>
        </div>
      </section></>
    );
  }

  return (
    <div className="invoice-intake-home">
      {uploadDialog}
      <InvoiceHistoryPanel
        query={historyQuery}
        onQueryChange={setHistoryQuery}
        status={historyStatus}
        onStatusChange={setHistoryStatus}
        page={historyPage}
        onPageChange={setHistoryPage}
        onOpen={openHistoryRun}
        returnFocusId={historyReturnFocusId}
      />
    </div>
  );
}
