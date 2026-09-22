import { useEffect, useId, useRef, useState } from "react";
import { Package } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { extractedPurchaseOrderNumber, initialInvoicePostingSelection, invoicePostingPayload, invoicePostingSelectionReady, suggestedAllocationPlan } from "./invoice-extraction-model.js";
import { ReceiptLinesEditor } from "./ReceiptLinesEditor.jsx";
import { receiptLinePayload } from "./receipt-lines-model.js";
import "./physical-receipt-confirmation.css";

function suggestionMessage(suggestion) {
  if (suggestion?.kind === "review_required") return "Save the invoice review before choosing how this delivery posts.";
  if (suggestion?.kind === "ambiguous") return `More than one exact PO line can receive invoice line ${Number(suggestion.invoiceLineIndex) + 1}. Receive without a PO or correct the reviewed invoice.`;
  if (suggestion?.kind === "none" && suggestion.reason === "no_exact_match") return "No exact purchase order matches this PO number and vendor.";
  if (suggestion?.kind === "none" && suggestion.reason === "no_line_match") return `The PO was found, but invoice line ${Number(suggestion.invoiceLineIndex) + 1} has no exact eligible line allocation.`;
  if (suggestion?.kind === "none" && suggestion.reason === "no_purchase_order") return "No purchase order number is recorded on this invoice.";
  return "Choose how this reviewed invoice should add inventory.";
}

export function PhysicalReceiptConfirmation({ busy = false, disabled = false, runId = "", runVersion = 0, receiptEpisode = 0, draft, suggestion = null, suggestionLoading = false, suggestionError = "", onRetrySuggestions, positions = [], positionLoading = false, positionError = "", onRetryPositions, onConfirm }) {
  const checkboxId = useId();
  const receiptRunKeyRef = useRef("");
  const [attested, setAttested] = useState(false);
  const [mismatch, setMismatch] = useState(false);
  const [receiptLines, setReceiptLines] = useState([]);
  const [receiptLinesReady, setReceiptLinesReady] = useState(false);
  const [selection, setSelection] = useState(() => initialInvoicePostingSelection(suggestion, draft));
  const purchaseOrderNumber = extractedPurchaseOrderNumber(draft);
  const allocationPlan = suggestedAllocationPlan(suggestion);
  const purchaseOrder = suggestion?.kind === "suggestions" ? suggestion.candidates?.[0]?.candidate : null;
  const ready = invoicePostingSelectionReady(selection, suggestion, draft);

  function resetForReceiptIdentity() {
    const receiptRunKey = `${runId}:${runVersion}:${receiptEpisode}`;
    if (receiptRunKeyRef.current === receiptRunKey) return;
    receiptRunKeyRef.current = receiptRunKey;
    setSelection(initialInvoicePostingSelection(suggestion, draft));
    setAttested(false);
    setMismatch(false);
    setReceiptLines([]);
    setReceiptLinesReady(false);
  }

  useEffect(resetForReceiptIdentity, [runId, runVersion, suggestion]);
  useEffect(resetForReceiptIdentity, [receiptEpisode]);

  useEffect(() => {
    setSelection((current) => {
      const initial = initialInvoicePostingSelection(suggestion, draft);
      if (!current.postingRoute && initial.postingRoute) return initial;
      if (current.postingRoute === "purchase_order" && suggestion?.kind !== "suggestions") return initial;
      if (current.postingRoute === "purchase_order") return { ...current, allocationPlan };
      return current;
    });
  }, [suggestion, draft]);

  function selectPurchaseOrder() {
    setSelection({ postingRoute: "purchase_order", allocationPlan, noPurchaseOrderReason: "" });
    setAttested(false);
  }

  function selectNoPurchaseOrder() {
    setSelection({ postingRoute: "no_purchase_order", allocationPlan: [], noPurchaseOrderReason: "" });
    setAttested(false);
  }

  function postReceipt() {
    const lines = receiptLinePayload(receiptLines);
    const posting = invoicePostingPayload(selection);
    const receiptLinesForPosting = posting.postingRoute === "no_purchase_order"
      ? lines.map(({ purchaseLineId: _purchaseLineId, ...line }) => line)
      : lines;
    if (posting.postingRoute === "purchase_order") {
      posting.allocationPlan = lines
        .filter((line) => line.acceptedQuantity > 0)
        .map((line) => ({
          invoiceLineIndex: line.invoiceLineIndex,
          purchaseLineId: line.purchaseLineId,
          quantity: line.acceptedQuantity,
        }));
    }
    onConfirm({ ...posting, receiptLines: receiptLinesForPosting });
  }

  return (
    <section className="physical-receipt-confirmation" aria-labelledby={`${checkboxId}-title`}>
      <div className="physical-receipt-copy">
        <h3 id={`${checkboxId}-title`}>Confirm delivery</h3>
        <p>Confirm the quantities and delivery exceptions below match what physically arrived.</p>
      </div>
      <section className="invoice-po-review" aria-labelledby={`${checkboxId}-po-title`}>
        <div className="invoice-po-review-heading">
          <div><h4 id={`${checkboxId}-po-title`}>Purchase order</h4><p>{suggestionMessage(suggestion)}</p></div>
          {suggestionError ? <Button type="button" onClick={onRetrySuggestions} disabled={busy || disabled || suggestionLoading}>Retry</Button> : null}
        </div>
        {suggestionLoading ? <p role="status">Checking exact purchase order matches…</p> : null}
        {suggestionError ? <p className="physical-receipt-note" role="alert">{suggestionError}</p> : null}
        {!suggestionLoading && !suggestionError && suggestion?.kind === "suggestions" ? <div className="invoice-po-suggestion">
          <div><strong>{purchaseOrder?.number || suggestion.purchaseOrderNumber}</strong><span>{purchaseOrder?.supplier_name || "Matched vendor"}</span></div>
          <ul>{suggestion.candidates.map((entry) => <li key={`${entry.invoiceLineIndex}:${entry.purchaseLineId}`}><span>Invoice line {Number(entry.invoiceLineIndex) + 1} · {entry.candidate?.part_number || "Part"}</span><strong>{entry.quantity} {entry.candidate?.uom_code || ""}</strong></li>)}</ul>
          <Button type="button" className={`invoice-po-route-choice${selection.postingRoute === "purchase_order" ? " is-selected" : ""}`} aria-pressed={selection.postingRoute === "purchase_order"} onClick={selectPurchaseOrder} disabled={busy || disabled}>Use this PO</Button>
        </div> : null}
        {!suggestionLoading && !suggestionError && suggestion && suggestion.kind !== "review_required" ? <div className="invoice-no-po-route">
          <Button type="button" className={`invoice-po-route-choice${selection.postingRoute === "no_purchase_order" ? " is-selected" : ""}`} aria-pressed={selection.postingRoute === "no_purchase_order"} onClick={selectNoPurchaseOrder} disabled={busy || disabled}>No purchase order</Button>
          {selection.postingRoute === "no_purchase_order" ? <label htmlFor={`${checkboxId}-no-po-reason`}><span>{purchaseOrderNumber ? `Reason for receiving without ${purchaseOrderNumber}` : "Reason for receiving without a purchase order"}</span><input id={`${checkboxId}-no-po-reason`} required maxLength={500} value={selection.noPurchaseOrderReason} onChange={(event) => { setSelection((current) => ({ ...current, noPurchaseOrderReason: event.target.value })); setAttested(false); }} disabled={busy || disabled} /></label> : null}
        </div> : null}
      </section>
      <div className="physical-receipt-destination-status">
        {positionLoading ? <p role="status">Loading eligible storage destinations…</p> : null}
        {positionError ? <p role="alert"><span>{positionError}</span><Button type="button" onClick={onRetryPositions} disabled={busy || disabled || positionLoading}>Try again</Button></p> : null}
      </div>
      <ReceiptLinesEditor runId={runId} runVersion={runVersion} receiptEpisode={receiptEpisode} draft={draft} suggestion={suggestion} positions={positions} positionLoading={positionLoading} positionError={positionError} disabled={busy || disabled} onChange={(lines, readyToPost) => { setReceiptLines(lines); setReceiptLinesReady(readyToPost); setAttested(false); }} />
      <div className="physical-receipt-controls">
        <label htmlFor={checkboxId}>
          <Checkbox
            id={checkboxId}
            checked={attested}
            onChange={(event) => { setAttested(event.target.checked); setMismatch(false); }}
            disabled={busy || disabled}
          />
          <span>I confirm the quantities and delivery exceptions entered below accurately describe this delivery</span>
        </label>
        <div className="physical-receipt-actions">
          <Button type="button" onClick={() => { setMismatch(true); setAttested(false); }} disabled={busy || disabled}>Nothing received</Button>
          <Button type="button" variant="primary" icon={Package} onClick={postReceipt} disabled={busy || disabled || !attested || !ready || !receiptLinesReady || suggestionLoading || Boolean(suggestionError)}>
            {busy ? "Posting received items…" : "Post received items"}
          </Button>
        </div>
      </div>
      {mismatch ? <p className="physical-receipt-note" role="status">Inventory unchanged. Leave all lines at zero until delivery arrives, or correct the reviewed invoice.</p> : null}
    </section>
  );
}
