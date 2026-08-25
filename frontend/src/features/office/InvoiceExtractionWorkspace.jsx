import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, CheckCircle, File02, RefreshCw01, Trash01, UploadCloud02 } from "@untitledui/icons";
import { FormField, OptionalSection } from "../../components/forms/index.js";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import {
  confidenceState,
  addBlankInvoiceLine,
  INVOICE_HEADER_FIELDS,
  parseReviewNumber,
  removeInvoiceLine,
  updateInvoiceField,
  updateInvoiceLineField,
  validateInvoiceSelection,
} from "./invoice-extraction-model.js";
import "./invoice-extraction.css";

const ACCEPTED_TYPES = new Set(["image/png", "image/jpeg", "image/webp", "application/pdf"]);
const MAX_FILE_BYTES = 10 * 1024 * 1024;
const MAX_BATCH_FILES = 10;

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

function Confidence({ field }) {
  const state = confidenceState(field.confidence);
  return (
    <span className={`invoice-confidence is-${state.toLowerCase()}`} title={field.evidence}>
      {state === "Review" ? <AlertCircle /> : <CheckCircle />}
      {state} · {field.confidence}%
    </span>
  );
}

function Field({ fieldName, label, type, draft, onChange }) {
  const field = draft[fieldName];
  return (
    <label className={`invoice-field${field.confidence < 90 ? " needs-review" : ""}`}>
      <span>{label}</span>
      {type === "select" ? (
        <select value={field.value} onChange={(event) => onChange(fieldName, event.target.value)}>
          <option value="invoice">Invoice</option><option value="credit_memo">Credit memo</option><option value="unknown">Unknown</option>
        </select>
      ) : (
        <input
          type={type}
          step={type === "number" ? "0.01" : undefined}
          value={field.value ?? ""}
          onChange={(event) => onChange(fieldName, type === "number" ? parseReviewNumber(event.target.value) : event.target.value)}
        />
      )}
      <Confidence field={field} />
      <small>{field.evidence || "No visible evidence supplied."}</small>
    </label>
  );
}

export function InvoiceExtractionWorkspace() {
  const [locations, setLocations] = useState([]);
  const [locationId, setLocationId] = useState("");
  const [uploads, setUploads] = useState([]);
  const [batchRuns, setBatchRuns] = useState([]);
  const [batchIndex, setBatchIndex] = useState(0);
  const [vendorHint, setVendorHint] = useState("");
  const [run, setRun] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [approveLearning, setApproveLearning] = useState(false);
  const [previewUrl, setPreviewUrl] = useState("");
  const fileInputRef = useRef(null);
  const reviewKeyRef = useRef("");

  useEffect(() => {
    api("/api/office/template")
      .then((result) => {
        const available = (result.locations || []).map((entry) => entry.location).filter(Boolean);
        setLocations(available);
        setLocationId((current) => current || available[0]?.id || "");
      })
      .catch((nextError) => setError(nextError.message));
  }, []);

  useEffect(() => {
    const savedRunId = new URLSearchParams(window.location.search).get("invoiceRun");
    if (!savedRunId) return;
    setBusy("reload");
    api(`/api/office/invoice-extractions/${encodeURIComponent(savedRunId)}`)
      .then(({ run: savedRun }) => {
        if (!savedRun.draft) throw new Error(savedRun.status === "processing" ? "This extraction is still processing." : "This extraction has no reviewable draft.");
        setRun(savedRun);
        setDraft(savedRun.draft);
        setMessage(savedRun.sourceAvailable
          ? "Saved invoice draft and secure source restored."
          : "Saved invoice draft restored. Its source is no longer available.");
      })
      .catch((nextError) => setError(nextError.message))
      .finally(() => setBusy(""));
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

  const reviewCount = useMemo(() => {
    if (!draft) return 0;
    return [
      ...INVOICE_HEADER_FIELDS.map(([name]) => draft[name]),
      ...draft.lines.flatMap((line) => [line.partNumber, line.description, line.quantity, line.unitOfMeasure, line.unitPrice, line.lineTotal]),
    ].filter((field) => field.confidence < 90).length;
  }, [draft]);
  const displayedPreviewUrl = previewUrl || (run?.sourceAvailable
    ? `/api/office/invoice-extractions/${encodeURIComponent(run.id)}/source`
    : "");
  const selectedLocation = locations.find((location) => location.id === locationId) || null;
  const activeUploadId = batchRuns[batchIndex]?.uploadId;
  const activeFile = uploads.find((upload) => upload.id === activeUploadId)?.file || null;

  function chooseFiles(event) {
    const selection = validateInvoiceSelection(event.target.files, {
      acceptedTypes: ACCEPTED_TYPES,
      maxBytes: MAX_FILE_BYTES,
      maxFiles: MAX_BATCH_FILES,
    });
    setError("");
    setMessage("");
    if (selection.error) {
      event.target.value = "";
      setUploads([]);
      return setError(selection.error);
    }
    setUploads(selection.files.map((file) => ({
      id: crypto.randomUUID(),
      file,
      idempotencyKey: `extract-${crypto.randomUUID()}`,
    })));
  }

  function clearBatch() {
    if (fileInputRef.current) fileInputRef.current.value = "";
    setUploads([]);
    setBatchRuns([]);
    setBatchIndex(0);
    setRun(null);
    setDraft(null);
    setApproveLearning(false);
    setMessage("");
    setError("");
    reviewKeyRef.current = "";
    rememberRun();
  }

  async function waitForCompletedRun(initialRun) {
    let current = initialRun;
    for (let attempt = 0; attempt < 30 && current?.status === "processing"; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 1_000));
      current = (await api(`/api/office/invoice-extractions/${encodeURIComponent(current.id)}`)).run;
    }
    if (current?.status === "processing") throw new Error("Extraction is still running. Open the invoice again in a moment.");
    if (current?.status === "failed") throw new Error("The invoice could not be extracted. Try again.");
    return current;
  }

  function rememberRun(runId = "") {
    const url = new URL(window.location.href);
    url.searchParams.set("view", "invoices");
    if (runId) url.searchParams.set("invoiceRun", runId);
    else url.searchParams.delete("invoiceRun");
    window.history.replaceState({}, "", url);
  }

  async function extract(event) {
    event.preventDefault();
    if (!uploads.length || !locationId) return;
    setBusy("extract");
    setError("");
    setBatchRuns([]);
    setBatchIndex(0);
    const completed = [];
    let failed = null;
    for (let index = 0; index < uploads.length; index += 1) {
      const upload = uploads[index];
      setMessage(`Extracting ${index + 1} of ${uploads.length}: ${upload.file.name}`);
      try {
        const result = await api("/api/office/invoice-extractions", {
          method: "POST",
          timeoutMs: 70_000,
          body: JSON.stringify({
            locationId,
            fileName: upload.file.name,
            mimeType: upload.file.type,
            dataUrl: await readFileDataUrl(upload.file),
            vendorHint,
            idempotencyKey: upload.idempotencyKey,
          }),
        });
        completed.push({ uploadId: upload.id, run: await waitForCompletedRun(result.run) });
      } catch (nextError) {
        failed = { fileName: upload.file.name, message: nextError.message };
        break;
      }
    }
    setBatchRuns(completed);
    setBusy("");
    if (!completed.length) {
      setError(failed?.message || "The invoices could not be extracted. Try again.");
      setMessage("");
      return;
    }
    setRun(completed[0].run);
    setDraft(completed[0].run.draft);
    rememberRun(completed[0].run.id);
    setMessage(completed.length === 1
      ? "Draft extracted. Confirm the values before approval."
      : `${completed.length} drafts extracted. Review invoice 1 of ${completed.length}.`);
    if (failed) setError(`Stopped at ${failed.fileName}: ${failed.message} ${completed.length} completed draft${completed.length === 1 ? " is" : "s are"} ready to review.`);
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
      const updatedBatchRuns = batchRuns.map((entry, index) => index === batchIndex ? { ...entry, run: result.run } : entry);
      setBatchRuns(updatedBatchRuns);
      const nextEntry = updatedBatchRuns[batchIndex + 1];
      if (nextEntry) {
        const nextIndex = batchIndex + 1;
        setBatchIndex(nextIndex);
        setRun(nextEntry.run);
        setDraft(nextEntry.run.draft);
        setApproveLearning(false);
        reviewKeyRef.current = "";
        rememberRun(nextEntry.run.id);
        setMessage(`Invoice ${nextIndex} saved. Review invoice ${nextIndex + 1} of ${updatedBatchRuns.length}.`);
      } else {
        setRun(result.run);
        setDraft(result.run.draft);
        rememberRun(result.run.id);
        setMessage(approveLearning
          ? `Reviewed invoice saved with ${result.correctionCount} correction${result.correctionCount === 1 ? "" : "s"}. One encrypted training example is ready; inventory was not changed.`
          : `Reviewed invoice saved with ${result.correctionCount} correction${result.correctionCount === 1 ? "" : "s"}. It was excluded from model training; inventory was not changed.`);
      }
    } catch (nextError) {
      setError(nextError.message);
      setMessage("");
    } finally {
      setBusy("");
    }
  }

  function updateHeader(name, value) {
    reviewKeyRef.current = "";
    setDraft((current) => updateInvoiceField(current, name, value));
  }

  function updateLine(lineId, name, value, type = "text") {
    reviewKeyRef.current = "";
    setDraft((current) => updateInvoiceLineField(current, lineId, name, type === "number" ? parseReviewNumber(value) : value));
  }

  if (draft) {
    return (
      <section className="invoice-extraction-workspace" aria-labelledby="invoice-review-title">
        <header className="invoice-review-header">
          <div>
            <span className="invoice-draft-label">Draft · inventory unchanged</span>
            {batchRuns.length > 1 ? <span className="invoice-batch-position">Invoice {batchIndex + 1} of {batchRuns.length}</span> : null}
            <h2 id="invoice-review-title">Review {run.fileName}</h2>
            <p>{reviewCount ? `${reviewCount} values need attention.` : "No low-confidence values. Confirm before approval."}</p>
          </div>
          <Button type="button" onClick={clearBatch} disabled={Boolean(busy)}>Start another</Button>
        </header>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        {message ? <p className="invoice-status" role="status">{message}</p> : null}
        {draft.warnings.length ? <div className="invoice-warning" role="alert"><strong>Check totals and document quality</strong>{draft.warnings.map((warning) => <span key={warning}>{warning}</span>)}</div> : null}
        <div className={`invoice-review-layout${displayedPreviewUrl ? " has-preview" : ""}`}>
          {displayedPreviewUrl ? (
            <aside className="invoice-source-preview" aria-label="Uploaded invoice preview">
              <div><strong>Original invoice</strong><span>Compare every highlighted value</span></div>
              {(activeFile?.type || run.mimeType) === "application/pdf"
                ? <object data={displayedPreviewUrl} type="application/pdf"><a href={displayedPreviewUrl} target="_blank" rel="noreferrer">Open the uploaded PDF</a></object>
                : <img src={displayedPreviewUrl} alt="Uploaded invoice for comparison" />}
            </aside>
          ) : null}
          <div className="invoice-review-form">
            <div className="invoice-fields-grid">
              {INVOICE_HEADER_FIELDS.map(([name, label, type]) => <Field key={name} fieldName={name} label={label} type={type} draft={draft} onChange={updateHeader} />)}
            </div>
            <div className="invoice-lines-heading"><div><h3>Invoice lines</h3><span>{draft.lines.length} extracted</span></div><Button type="button" onClick={() => { reviewKeyRef.current = ""; setDraft((current) => addBlankInvoiceLine(current, `manual-${crypto.randomUUID()}`)); }}>Add missing line</Button></div>
            <div className="invoice-lines">
              {draft.lines.map((line, index) => (
                <fieldset className="invoice-line-card" key={line.id}>
                  <legend>Line {index + 1}</legend>
                  {["partNumber", "description", "quantity", "unitOfMeasure", "unitPrice", "lineTotal"].map((name) => {
                    const label = { partNumber: "Part number", description: "Description", quantity: "Quantity", unitOfMeasure: "Unit", unitPrice: "Unit price", lineTotal: "Line total" }[name];
                    const type = ["quantity", "unitPrice", "lineTotal"].includes(name) ? "number" : "text";
                    return <label key={name} className={line[name].confidence < 90 ? "needs-review" : ""}><span>{label}</span><input type={type} step={type === "number" ? "0.001" : undefined} value={line[name].value ?? ""} onChange={(event) => updateLine(line.id, name, event.target.value, type)} /><Confidence field={line[name]} /></label>;
                  })}
                  <Button type="button" icon={Trash01} className="invoice-remove-line" onClick={() => { reviewKeyRef.current = ""; setDraft((current) => removeInvoiceLine(current, line.id)); }}>Remove line</Button>
                </fieldset>
              ))}
            </div>
          </div>
        </div>
        <footer className="invoice-review-actions">
          <div>
            <label className="invoice-learning-choice"><input type="checkbox" checked={approveLearning} onChange={(event) => { reviewKeyRef.current = ""; setApproveLearning(event.target.checked); }} /><span>Save this reviewed invoice as training data for our future local extractor</span></label>
            <p>Approval saves the reviewed draft. It does not receive parts or change Odoo.</p>
          </div>
          <Button type="button" variant="primary" icon={busy === "review" ? LoadingRefreshIcon : CheckCircle} onClick={approve} disabled={Boolean(busy) || run.status === "reviewed"}>{run.status === "reviewed" ? "Reviewed" : "Approve reviewed draft"}</Button>
        </footer>
      </section>
    );
  }

  return (
    <section className="invoice-extraction-workspace invoice-upload-workspace" aria-labelledby="invoice-upload-title">
      <div className="invoice-upload-copy"><h2 id="invoice-upload-title">Upload invoice</h2><p>We’ll extract the details for review.</p></div>
      <form onSubmit={extract}>
        {locations.length > 1 ? (
          <label><span>Shop</span><select value={locationId} onChange={(event) => setLocationId(event.target.value)} required><option value="">Select shop</option>{locations.map((location) => <option value={location.id} key={location.id}>{location.name}</option>)}</select></label>
        ) : selectedLocation ? (
          <p className="invoice-upload-context"><span>Shop</span><strong>{selectedLocation.name}</strong></p>
        ) : (
          <p className="invoice-upload-context" role="status">Loading shop…</p>
        )}
        <input ref={fileInputRef} id="invoice-file" className="invoice-file-native" type="file" accept="image/png,image/jpeg,image/webp,application/pdf" onChange={chooseFiles} multiple required />
        <label className={`invoice-file-picker${uploads.length ? " has-file" : ""}`} htmlFor="invoice-file">
          <UploadCloud02 aria-hidden="true" />
          <span><strong>{uploads.length ? "Choose different invoices" : "Choose invoices"}</strong><small>Up to 10 PDFs or images · 10 MB each</small></span>
        </label>
        {uploads.length ? <div className="invoice-selected-files"><div><strong>{uploads.length} invoice{uploads.length === 1 ? "" : "s"} selected</strong><Button type="button" onClick={clearBatch}>Clear</Button></div><ul>{uploads.map((upload) => <li key={upload.id}><File02 /><span><strong>{upload.file.name}</strong><small>{(upload.file.size / 1024 / 1024).toFixed(2)} MB</small></span></li>)}</ul></div> : null}
        <OptionalSection className="invoice-upload-options" title="More options">
          <FormField label="Vendor name (optional)">
            <input value={vendorHint} onChange={(event) => setVendorHint(event.target.value)} maxLength={180} placeholder="Only if the invoice is unclear" />
          </FormField>
        </OptionalSection>
        {error ? <p className="ops-error" role="alert">{error}</p> : null}
        {message ? <p className="invoice-status" role="status">{message}</p> : null}
        {uploads.length ? <Button className="invoice-upload-submit" variant="primary" icon={busy === "extract" ? LoadingRefreshIcon : UploadCloud02} type="submit" disabled={!locationId || Boolean(busy)}>{busy === "extract" ? "Extracting…" : `Extract ${uploads.length} invoice${uploads.length === 1 ? "" : "s"}`}</Button> : null}
      </form>
      <p className="invoice-privacy-note">Encrypted · Training use requires your approval</p>
    </section>
  );
}
