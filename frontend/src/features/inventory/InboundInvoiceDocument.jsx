import { useEffect, useState } from "react";
import { api } from "../../lib/api.js";
import { Button } from "../../components/ui/Button.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { invoiceDocumentChoices, invoiceDocumentState, invoiceField, invoiceNumber, invoiceQuantity, preferredInvoiceChoice } from "./inbound-invoice-document-model.js";
import "./purchase-order-document.css";
import "./inbound-invoice-document.css";

const lineColumns = [{ id: "part", label: "Part", isRowHeader: true }, { id: "quantity", label: "Qty" }, { id: "price", label: "Unit price" }, { id: "amount", label: "Amount" }];

export function InboundInvoiceDocument({ item, refreshKey = 0, onOpenInvoice, onUploadInvoice, uploadControl }) {
  const identity = `${item.locationId}:${item.id}:${item.selectedDelivery?.id || ""}`;
  const [evidence, setEvidence] = useState(null);
  const [selection, setSelection] = useState(null);
  const [extraction, setExtraction] = useState(null);
  const [reload, setReload] = useState(0);
  const [preparing, setPreparing] = useState(false);
  const [prepareError, setPrepareError] = useState("");
  const exactRunId = item.selectedDelivery?.invoiceRunId || "";
  useEffect(() => {
    const controller = new AbortController();
    let active = true;
    const direct = invoiceDocumentChoices(item);
    setEvidence((previous) => previous?.identity === identity ? previous : { identity, choices: direct, loading: !!item.poId, error: "" });
    if (item.poId) api(`/api/office/inventory/purchasing/${encodeURIComponent(item.poId)}/bills`, { signal: controller.signal })
      .then((result) => { if (active) setEvidence({ identity, choices: invoiceDocumentChoices(item, result), loading: false, error: "" }); })
      .catch((error) => { if (active && error?.name !== "AbortError") setEvidence((previous) => ({ identity, choices: previous?.identity === identity ? previous.choices : direct, loading: false, error: error.message || "Uploaded bills could not be loaded." })); });
    else setEvidence({ identity, choices: direct, loading: false, error: "" });
    return () => { active = false; controller.abort(); };
  }, [identity, item.poId, item.invoiceRunId, exactRunId, refreshKey, reload]);

  const currentEvidence = evidence?.identity === identity ? evidence : null;
  const choices = currentEvidence?.choices || [];
  const choice = preferredInvoiceChoice(choices, item, selection?.identity === identity ? selection.key : "");
  const runId = choice?.invoiceRunId || "";
  useEffect(() => {
    if (!runId) { setExtraction(null); return undefined; }
    const controller = new AbortController();
    let active = true;
    setExtraction((previous) => previous?.identity === identity && previous.id === runId ? previous : { identity, id: runId, run: null, loading: true, error: "" });
    api(`/api/office/invoice-extractions/${encodeURIComponent(runId)}`, { signal: controller.signal })
      .then((result) => { if (active) setExtraction({ identity, id: runId, run: result.run, loading: false, error: "" }); })
      .catch((error) => { if (active && error?.name !== "AbortError") setExtraction((previous) => ({ identity, id: runId, run: previous?.identity === identity && previous.id === runId ? previous.run : null, loading: false, error: error.message || "This invoice could not be loaded." })); });
    return () => { active = false; controller.abort(); };
  }, [identity, runId, refreshKey, reload]);

  const currentExtraction = extraction?.identity === identity && extraction.id === runId ? extraction : null;
  const run = currentExtraction?.run;
  const draft = run?.draft;
  const state = invoiceDocumentState(run);
  const documentTitle = invoiceField(draft?.documentType) === "credit_memo" ? "Supplier credit memo" : invoiceField(draft?.documentType) === "unknown" ? "Supplier document" : "Supplier invoice";
  const read = (key) => invoiceField(draft?.[key]);
  const sourceUrl = choice?.sourceUrl || (run?.sourceAvailable ? `/api/office/invoice-extractions/${encodeURIComponent(runId)}/source` : "");
  async function prepareBill() {
    if (!choice?.billId || preparing) return;
    const selectedIdentity = identity;
    setPreparing(true); setPrepareError("");
    try {
      await api(`/api/office/inventory/purchasing/${encodeURIComponent(item.poId)}/bills/${encodeURIComponent(choice.billId)}/extract`, { method: "POST", body: "{}" });
      setReload((value) => value + 1);
    } catch (error) { setPrepareError({ identity: selectedIdentity, message: error.message || "This bill could not be prepared for reading." }); }
    finally { setPreparing(false); }
  }
  const loading = !currentEvidence || currentEvidence.loading || (runId && (!currentExtraction || currentExtraction.loading));
  return <section className="inbound-invoice-document" aria-label="Uploaded supplier invoice">
    {uploadControl ? <div className="inbound-invoice-upload-control">{uploadControl}</div> : null}
    {choices.length > 1 ? <label className="inbound-invoice-choice"><span>Bill</span><Dropdown aria-label="Supplier bill" value={choice?.key || ""} onChange={(event) => { setSelection({ identity, key: event.target.value }); setPrepareError(""); }}>{choices.map((entry, index) => <option value={entry.key} key={entry.key}>{entry.fileName || `Bill ${index + 1}`}</option>)}</Dropdown></label> : null}
    {currentEvidence?.error ? <p role="alert" className="inbound-invoice-error">{currentEvidence.error} <Button onClick={() => setReload((value) => value + 1)}>Retry</Button></p> : null}
    {currentExtraction?.error ? <p role="alert" className="inbound-invoice-error">{currentExtraction.error} <Button onClick={() => setReload((value) => value + 1)}>Retry</Button></p> : null}
    <article className="purchase-order-document" aria-label={state === "ready" ? `Supplier invoice ${read("invoiceNumber") || "number not read"}` : "Supplier bill"}>
      <header className="purchase-order-document-header"><div><p className="purchase-order-document-kicker">{choice ? documentTitle : "Delivery"}</p><h3>{state === "ready" ? read("invoiceNumber") || "Number not read" : choice ? "Uploaded bill" : item.selectedDelivery?.reference || item.poNumber || "Delivery"}</h3></div>{run ? <span className={`inbound-invoice-state is-${state}`}>{state === "processing" ? "Reading bill" : state === "failed" ? "Could not read" : run.status === "reviewed" ? "Reviewed" : "Needs review"}</span> : null}</header>
      {choice ? <div className="inbound-invoice-source"><span>{run?.fileName || choice.fileName || "Uploaded invoice"}</span>{sourceUrl ? <a href={sourceUrl} target="_blank" rel="noreferrer">{choice.billId ? "Download bill" : "View original"}</a> : run && !run.sourceAvailable ? <span>Original file unavailable</span> : null}</div> : null}
      {loading ? <p role="status" className="inbound-invoice-message">Loading uploaded bill…</p>
        : state === "processing" ? <p role="status" className="inbound-invoice-message">Reading the uploaded bill. Its invoice details will appear here.</p>
        : state === "failed" ? <p role="status" className="inbound-invoice-message">The uploaded bill could not be read. Open the invoice to retry extraction.</p>
        : state === "ready" ? <>
          <dl className="purchase-order-document-facts"><div><dt>Supplier</dt><dd>{read("vendorName") || "Not read"}</dd></div><div><dt>Invoice date</dt><dd>{read("invoiceDate") || "Not read"}</dd></div><div><dt>PO on bill</dt><dd>{read("purchaseOrderNumber") || "Not read"}</dd></div><div><dt>Currency</dt><dd>{read("currency") || "Not read"}</dd></div></dl>
          <OperationalDataTable className="purchase-order-document-lines" ariaLabel="Supplier invoice line items" columns={lineColumns}>
            {draft.lines?.length ? draft.lines.map((line, index) => <OperationalDataRow id={line.id || `invoice-line-${index}`} key={line.id || index}>
              <OperationalDataCell label="Part"><strong>{invoiceField(line.partNumber) || "Part number not read"}</strong>{invoiceField(line.description) ? <span>{invoiceField(line.description)}</span> : null}</OperationalDataCell>
              <OperationalDataCell label="Qty">{invoiceQuantity(invoiceField(line.quantity))}<small>{invoiceField(line.unitOfMeasure) || "Unit not read"}</small></OperationalDataCell>
              <OperationalDataCell label="Unit price">{invoiceNumber(invoiceField(line.unitPrice))}</OperationalDataCell>
              <OperationalDataCell label="Amount">{invoiceNumber(invoiceField(line.lineTotal))}</OperationalDataCell>
            </OperationalDataRow>) : <OperationalDataRow id="no-invoice-lines"><OperationalDataCell label="Part" colSpan={4}>No invoice lines were read. Open the invoice to review.</OperationalDataCell></OperationalDataRow>}
          </OperationalDataTable>
          <dl className="inbound-invoice-totals"><div><dt>Subtotal</dt><dd>{invoiceNumber(read("subtotal"))}</dd></div><div><dt>Tax</dt><dd>{invoiceNumber(read("tax"))}</dd></div><div><dt>Shipping</dt><dd>{invoiceNumber(read("shipping"))}</dd></div><div className="inbound-invoice-grand-total"><dt>Invoice total<small>{read("currency") || "Currency not read"}</small></dt><dd>{invoiceNumber(read("total"))}</dd></div></dl>
          {draft.warnings?.length ? <details className="inbound-invoice-notes"><summary>{draft.warnings.length} extraction note{draft.warnings.length === 1 ? "" : "s"}</summary><ul>{draft.warnings.map((warning, index) => <li key={index}>{warning}</li>)}</ul></details> : null}
        </> : choice ? <div className="inbound-invoice-message"><p>{choice.billId ? "This bill is attached, but its invoice details have not been read yet." : "No invoice details are available yet."}</p>{choice.billId && !runId ? <Button onClick={prepareBill} disabled={preparing}>{preparing ? "Preparing bill…" : "Read uploaded bill"}</Button> : null}</div>
          : !currentEvidence?.error ? <div className="inbound-invoice-message"><p>No supplier bill is attached to this delivery.</p>{onUploadInvoice && !uploadControl ? <Button onClick={() => onUploadInvoice(item.locationId)}>Upload invoice</Button> : null}</div> : null}
      {prepareError?.identity === identity ? <p role="alert" className="inbound-invoice-error">{prepareError.message}</p> : null}
      {runId && !loading && onOpenInvoice ? <footer className="inbound-invoice-actions"><Button onClick={() => onOpenInvoice?.(runId, item.locationId)}>{run?.status === "reviewed" ? "Open invoice" : "Review invoice"}</Button></footer> : null}
    </article>
  </section>;
}
