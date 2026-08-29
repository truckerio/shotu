import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { useEffect, useId, useMemo, useRef, useState } from "react";
import { CheckCircle, File02, Plus, RefreshCw01, Trash01, UploadCloud02, XClose } from "@untitledui/icons";
import { Dialog, Heading, Modal, ModalOverlay } from "react-aria-components";
import { OptionalSection } from "../../components/forms/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import { InvoiceDocumentViewer } from "./InvoiceDocumentViewer.jsx";
import { InvoiceHistoryPanel } from "./InvoiceHistoryPanel.jsx";
import { PhysicalReceiptConfirmation } from "./PhysicalReceiptConfirmation.jsx";
import {
  confidenceState,
  invoiceFieldNeedsReview,
  invoiceReviewErrorMessage,
  nextReviewableBatchIndex,
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

export function InvoiceExtractionWorkspace({ embedded = false, availableLocations, uploadOpen: controlledUploadOpen, onUploadOpenChange, onContextChange }) {
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
  const [historyQuery, setHistoryQuery] = useState("");
  const [historyStatus, setHistoryStatus] = useState("");
  const [historyPage, setHistoryPage] = useState(1);
  const [historyReturnFocusId, setHistoryReturnFocusId] = useState("");
  const [internalUploadOpen, setInternalUploadOpen] = useState(false);
  const [reviewDirty, setReviewDirty] = useState(false);
  const [leaveReviewOpen, setLeaveReviewOpen] = useState(false);
  const fileInputRef = useRef(null);
  const reviewTitleRef = useRef(null);
  const reviewKeyRef = useRef("");
  const activeRunRef = useRef(null);
  const batchRunsRef = useRef([]);
  const batchTokenRef = useRef("");
  const savedRunRequestRef = useRef({ id: "", controller: null });
  const uploadOpen = controlledUploadOpen ?? internalUploadOpen;

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
      setLocationId((current) => current || availableLocations[0]?.id || "");
      return undefined;
    }
    api("/api/office/template")
      .then((result) => {
        const available = (result.locations || []).map((entry) => entry.location).filter(Boolean);
        setLocations(available);
        setLocationId((current) => current || available[0]?.id || "");
      })
      .catch((nextError) => setError(nextError.message));
  }, [availableLocations]);

  useEffect(() => {
    const savedRunId = new URLSearchParams(window.location.search).get("invoiceRun");
    if (!savedRunId) return;
    loadSavedRun(savedRunId, false);
  }, []);

  useEffect(() => {
    if (!draft || !reviewTitleRef.current) return;
    reviewTitleRef.current.focus({ preventScroll: true });
  }, [draft]);

  useEffect(() => () => {
    batchTokenRef.current = "";
    savedRunRequestRef.current.controller?.abort();
    savedRunRequestRef.current = { id: "", controller: null };
  }, []);

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
    setReviewDirty(false);
    setLeaveReviewOpen(false);
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

  async function confirmPhysicalReceipt() {
    setBusy("receive");
    setError("");
    setMessage("Adding reviewed parts to local inventory…");
    try {
      const result = await api(`/api/office/invoice-extractions/${encodeURIComponent(run.id)}/confirm-receipt`, {
        method: "POST",
        body: JSON.stringify({
          idempotencyKey: `local-inventory-${run.id}`,
          expectedVersion: run.version,
          confirmation: "all_received_undamaged",
        }),
      });
      setReceipt(result.receipt);
      setMessage(`${result.receipt.lineCount} part line${result.receipt.lineCount === 1 ? "" : "s"} added to ${result.receipt.locationName}.`);
    } catch (nextError) {
      setError(nextError.message);
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  function updateHeader(name, value) {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setDraft((current) => updateInvoiceField(current, name, value));
  }

  function updateLine(lineId, name, value, type = "text") {
    reviewKeyRef.current = "";
    setReviewDirty(true);
    setDraft((current) => updateInvoiceLineField(current, lineId, name, type === "number" ? parseReviewNumber(value) : value));
  }

  const uploadDialog = (
    <ModalOverlay className="invoice-upload-overlay" isOpen={uploadOpen && !draft} isDismissable={busy !== "extract"} onOpenChange={(open) => { if (busy !== "extract") setUploadOpen(open); }}>
      <Modal className="invoice-upload-modal">
        <Dialog className="invoice-upload-dialog" aria-labelledby="invoice-upload-title">
          <div className="invoice-upload-dialog-heading">
            <div><Heading slot="title" id="invoice-upload-title">Upload invoices</Heading><p>Add files for extraction and review.</p></div>
            <button type="button" aria-label="Close invoice upload" onClick={() => setUploadOpen(false)} disabled={busy === "extract"}><XClose aria-hidden="true" /></button>
          </div>
          <form onSubmit={extract}>
            {locations.length > 1 ? (
              <label><span>Shop</span><Dropdown value={locationId} onChange={(event) => setLocationId(event.target.value)} required><option value="">Select shop</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</Dropdown></label>
            ) : selectedLocation ? (
              <p className="invoice-upload-context"><span>Shop</span><strong>{selectedLocation.name}</strong></p>
            ) : (
              <p className="invoice-upload-context" role="status">Loading shop…</p>
            )}
            <input ref={fileInputRef} id="invoice-file" className="invoice-file-native" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={chooseFiles} multiple required disabled={busy === "extract"} />
            <label className={`invoice-file-picker${uploads.length ? " has-file" : ""}`} htmlFor="invoice-file" onDragOver={(event) => event.preventDefault()} onDrop={dropFiles}>
              <span className="invoice-file-picker-icon"><Plus aria-hidden="true" /></span>
              <span><strong>{uploads.length ? "Choose different invoices" : "Drop or click to upload"}</strong><small>PDF or image · 10 MB each</small></span>
              <span className="invoice-file-picker-action">Browse</span>
            </label>
            {uploads.length ? <div className="invoice-selected-files"><div><strong>{uploads.length} invoice{uploads.length === 1 ? "" : "s"} selected</strong><Button type="button" onClick={clearBatch} disabled={busy === "extract"}>Clear</Button></div><ul>{uploads.map((upload) => <li key={upload.id}><File02 /><span><strong>{upload.file.name}</strong><small>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</small></span></li>)}</ul></div> : null}
            {error ? <p className="ops-error" role="alert">{error}</p> : null}
            {message ? <p className="invoice-status" role="status">{message}</p> : null}
            {uploads.length ? <div className="invoice-upload-dialog-actions">
              <Button variant="primary" icon={busy === "extract" ? LoadingRefreshIcon : UploadCloud02} type="submit" disabled={!locationId || Boolean(busy)}>{busy === "extract" ? "Extracting…" : `Extract ${uploads.length} invoice${uploads.length === 1 ? "" : "s"}`}</Button>
            </div> : null}
          </form>
          <p className="invoice-privacy-note">Encrypted · Training use requires your approval</p>
        </Dialog>
      </Modal>
    </ModalOverlay>
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

  if (draft) {
    return (
      <>{uploadDialog}{leaveReviewDialog}<section className="invoice-extraction-workspace" aria-labelledby="invoice-review-title">
        <header className="invoice-review-header">
          <div>
            <span className="invoice-draft-label">{receipt?.status === "posted" ? "Added · local inventory updated" : receipt?.status === "reversed" ? "Reversed · local inventory adjusted" : "Draft · inventory unchanged"}</span>
            {batchRuns.length > 1 ? <span className="invoice-batch-position">Invoice {batchIndex + 1} of {batchRuns.length} · {batchProgress.ready} ready{batchProgress.processing ? ` · ${batchProgress.processing} extracting` : ""}{batchProgress.failed ? ` · ${batchProgress.failed} failed` : ""}</span> : null}
            <h2 ref={reviewTitleRef} tabIndex={-1} id="invoice-review-title">Review {run.fileName}</h2>
            <p>{reviewCount ? `${reviewCount} values need attention.` : "No low-confidence values. Confirm before approval."}</p>
          </div>
        </header>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        {message ? <p className="invoice-status" role="status">{message}</p> : null}
        {receipt?.status === "posted" ? (
          <section className="inventory-label-result" aria-labelledby="inventory-label-title">
            <div className="inventory-label-heading">
              <div><span>Local receipt</span><h3 id="inventory-label-title">Inventory added at {receipt.locationName}</h3></div>
              {receipt.labelBatch?.printUrl ? <Button type="button" onClick={() => window.open(receipt.labelBatch.printUrl, "_blank", "noopener,noreferrer")}>Open {receipt.labelBatch.itemCount} printable label{receipt.labelBatch.itemCount === 1 ? "" : "s"}</Button> : null}
            </div>
            <p>{receipt.lineCount} part line{receipt.lineCount === 1 ? "" : "s"} posted. Quantities remain in each line’s unit. This invoice cannot be posted twice.</p>
            {receipt.units?.length ? <div className="inventory-label-grid">
              {receipt.units.slice(0, 12).map((unit) => <article className="inventory-unit-label" key={unit.id}>
                <img src={unit.qrSvgUrl} alt={`QR code for serial ${unit.serialNumber}`} />
                <div><strong>{unit.partNumber}</strong><span>{unit.description || "Inventory part"}</span><code>{unit.serialNumber}</code></div>
              </article>)}
            </div> : null}
            {receipt.units?.length > 12 ? <p>Showing 12 of {receipt.units.length} labels. Open the printable batch for the complete set.</p> : null}
            {receipt.labelsUnavailable ? <p className="ops-error" role="alert">{receipt.labelsUnavailable}</p> : null}
            {Array.isArray(receipt.units) && !receipt.units.length && !receipt.labelsUnavailable ? <p>No individual labels were created. Measured quantities stay as aggregate inventory.</p> : null}
          </section>
        ) : receipt?.status === "reversed" ? <p className="invoice-reversed-status" role="status">This receipt was reversed. Its QR batch remains historical and inventory is no longer marked as added.</p> : null}
        {draft.warnings.length ? (
          <details className="invoice-review-notes">
            <summary>{draft.warnings.length} extraction note{draft.warnings.length === 1 ? "" : "s"}</summary>
            <ul>{draft.warnings.map((warning) => <li key={warning}>{warning}</li>)}</ul>
          </details>
        ) : null}
        <div className="invoice-review-layout">
          <InvoiceDocumentViewer sourceUrl={displayedPreviewUrl} mimeType={activeFile?.type || run.mimeType} fileName={run.fileName} />
          <div className="invoice-review-form">
            <div className="invoice-fields-grid">
              {INVOICE_HEADER_FIELDS.filter(([, , , options]) => !options?.secondary).map(([name, label, type, options]) => <Field key={name} fieldName={name} label={label} type={type} options={options} draft={draft} onChange={updateHeader} disabled={run.status === "reviewed"} />)}
            </div>
            <OptionalSection className="invoice-optional-review" title="Additional details" description="PO number only if your company gave one to the seller.">
              <div className="invoice-fields-grid invoice-secondary-fields">
                {INVOICE_HEADER_FIELDS.filter(([, , , options]) => options?.secondary).map(([name, label, type, options]) => <Field key={name} fieldName={name} label={label} type={type} options={options} draft={draft} onChange={updateHeader} disabled={run.status === "reviewed"} />)}
              </div>
            </OptionalSection>
            <div className="invoice-lines-heading"><div><h3>Invoice lines</h3><span>{draft.lines.length} extracted</span></div>{run.status !== "reviewed" ? <Button type="button" onClick={() => { reviewKeyRef.current = ""; setReviewDirty(true); setDraft((current) => addBlankInvoiceLine(current, `manual-${crypto.randomUUID()}`)); }}>Add missing line</Button> : null}</div>
            <div className="invoice-lines">
              {draft.lines.map((line, index) => (
                <fieldset className="invoice-line-card" key={line.id}>
                  <legend>Line {index + 1}</legend>
                  {["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"].map((name) => {
                    const label = { partNumber: "Part number", description: "Description", quantity: "Quantity", unitOfMeasure: "Unit", unitPrice: "Unit price", lineTotal: "Line total" }[name];
                    const type = ["quantity", "unitPrice", "lineTotal"].includes(name) ? "number" : "text";
                    return <label key={name} className={line[name].confidence < 90 ? "needs-review" : ""}><span>{label}</span><input type={type} step={type === "number" ? "0.001" : undefined} value={line[name].value ?? ""} readOnly={run.status === "reviewed"} onChange={(event) => updateLine(line.id, name, event.target.value, type)} /><Confidence field={line[name]} /></label>;
                  })}
                  {run.status !== "reviewed" ? <Button type="button" icon={Trash01} className="invoice-remove-line" onClick={() => { reviewKeyRef.current = ""; setReviewDirty(true); setDraft((current) => removeInvoiceLine(current, line.id)); }}>Remove line</Button> : null}
                </fieldset>
              ))}
            </div>
          </div>
        </div>
        <footer className={`invoice-review-actions${run.status === "reviewed" ? " is-receiving" : ""}`}>
          {run.status === "reviewed" ? (
            receipt?.status === "posted"
              ? <p className="invoice-review-complete">Delivery confirmed · Inventory added</p>
              : receipt?.status === "reversed"
                ? <p className="invoice-review-reversed">Receipt reversed · Inventory not added</p>
              : <PhysicalReceiptConfirmation busy={busy === "receive"} disabled={Boolean(busy) && busy !== "receive"} onConfirm={confirmPhysicalReceipt} />
          ) : (
            <>
              <details className="invoice-learning-option">
                <summary>Learning preference</summary>
                <label className="invoice-learning-choice"><input type="checkbox" checked={approveLearning} onChange={(event) => { reviewKeyRef.current = ""; setReviewDirty(true); setApproveLearning(event.target.checked); }} /><span>Use my corrections to improve future invoice extraction</span></label>
              </details>
              <div className="invoice-review-primary">
                <span>Saves review only · Inventory stays unchanged</span>
                <Button type="button" variant="primary" icon={busy === "review" ? LoadingRefreshIcon : CheckCircle} onClick={approve} disabled={Boolean(busy)}>Approve review</Button>
              </div>
            </>
          )}
        </footer>
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
