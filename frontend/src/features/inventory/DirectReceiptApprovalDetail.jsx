import { useCallback, useEffect, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";
import {
  directReceiptApprovalCost,
  directReceiptApprovalDecision,
  directReceiptApprovalDecisionUrl,
  directReceiptApprovalPresentation,
  directReceiptApprovalStatus,
  directReceiptApprovalUrl,
  isDirectReceiptApprovalRefreshError,
} from "./direct-receipt-approval-model.js";
import "./direct-receipt-approval-detail.css";

const quantity = (value, uom) => `${Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 })}${uom ? ` ${uom}` : ""}`;

export function DirectReceiptApprovalDetail({ approvalId, onClose }) {
  const [detail, setDetail] = useState(null);
  const [receipt, setReceipt] = useState(null);
  const [reason, setReason] = useState("");
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const load = useCallback(async ({ refreshed = false } = {}) => {
    setLoading(true); setError("");
    try {
      const next = await api(directReceiptApprovalUrl(approvalId));
      setDetail(next);
      if (refreshed) setNotice("Request refreshed. Review the current status before deciding.");
    } catch (next) { setError(next.message || "Approval request could not be loaded."); }
    finally { setLoading(false); }
  }, [approvalId]);

  useEffect(() => { load(); }, [load]);

  async function decide(action) {
    if (!detail || busy || (action === "reject" && !reason.trim())) return;
    setBusy(true); setError(""); setNotice("");
    try {
      const result = await api(directReceiptApprovalDecisionUrl(approvalId), {
        method: "POST",
        body: JSON.stringify(directReceiptApprovalDecision(action, detail, reason)),
      });
      if (result.receipt) {
        setReceipt(result.receipt);
        setDetail((current) => ({ ...current, approvalRequest: { ...current.approvalRequest, status: "approved", receiptId: result.receipt.id, version: current.approvalRequest.version + 1 } }));
        setNotice(directReceiptApprovalPresentation(detail).successNotice);
      } else if (result.approvalRequest) {
        setDetail((current) => ({ ...current, approvalRequest: result.approvalRequest }));
        setNotice("Arrival rejected. Stock was not added.");
      }
    } catch (next) {
      if (isDirectReceiptApprovalRefreshError(next)) { await load({ refreshed: true }); }
      else setError(next.message || "Approval decision could not be saved.");
    } finally { setBusy(false); }
  }

  const request = detail?.approvalRequest;
  const postedReceiptId = receipt?.id || (request?.status === "approved" ? request.receiptId : "");
  const presentation = directReceiptApprovalPresentation(detail);
  return <section className="direct-receipt-approval" aria-labelledby="direct-receipt-approval-title">
    <header className="direct-receipt-approval-header">
      <div><p>No-PO arrival</p><h2 id="direct-receipt-approval-title">{directReceiptApprovalStatus(request?.status)}</h2></div>
      <Button type="button" onClick={onClose}>Back to inbound</Button>
    </header>
    {loading && !detail ? <p role="status">Loading approval request…</p> : null}
    {error ? <div className="direct-receipt-approval-message is-error" role="alert"><span>{error}</span><Button type="button" onClick={() => load()}>Retry</Button></div> : null}
    {detail ? <>
      {notice ? <p className="direct-receipt-approval-message" role="status">{notice}</p> : null}
      <div className="direct-receipt-approval-grid">
        <section><h3>Arrival</h3><dl>
          <div><dt>Part</dt><dd><strong>{detail.part.partNumber}</strong>{detail.part.description ? <span>{detail.part.description}</span> : null}</dd></div>
          <div><dt>Quantity</dt><dd>{quantity(detail.arrival.quantity, detail.arrival.uomCode)}</dd></div>
          <div><dt>Condition</dt><dd>{presentation.dispositionLabel}</dd></div>
          <div><dt>Shop</dt><dd>{detail.location.name}</dd></div>
          <div><dt>Destination</dt><dd>{presentation.destinationLabel}</dd></div>
          {presentation.held ? <><div><dt>Physical hold location</dt><dd>{detail.arrival.holdLocation}</dd></div><div><dt>Damage findings</dt><dd>{detail.arrival.damageDetails}</dd></div></> : null}
          <div><dt>Cost</dt><dd>{directReceiptApprovalCost(detail.arrival.totalCost)}</dd></div>
        </dl></section>
        <section><h3>Original evidence</h3><dl>
          <div><dt>Submitted by</dt><dd>{detail.submitter.displayName}</dd></div>
          <div><dt>No-PO reason</dt><dd>{detail.arrival.noPurchaseOrderReason || "No reason recorded"}</dd></div>
          <div><dt>Reference</dt><dd>{detail.arrival.reference || "No delivery reference"}</dd></div>
          <div><dt>Confirmation</dt><dd>{detail.evidence.confirmation === "new_company_stock_received" ? presentation.confirmationLabel : detail.evidence.confirmation}</dd></div>
          <div><dt>Request</dt><dd>{request.id}</dd></div>
        </dl></section>
      </div>
      {postedReceiptId ? <section className={`direct-receipt-approval-result${presentation.held ? " is-held" : ""}`} aria-label={presentation.held ? "Held receipt posted" : "Receipt posted"}><h3>{presentation.successHeading}</h3>{presentation.held ? <><p>{quantity(detail.arrival.quantity, detail.arrival.uomCode)} was received at {detail.location.name} and entered the damage inspection workflow. Usable stock was not added.</p><p>Held at: {detail.arrival.holdLocation} · {detail.arrival.damageDetails}</p></> : <p>{quantity(detail.arrival.quantity, detail.arrival.uomCode)} was added to {detail.location.name}.</p>}<p>Receipt reference: {postedReceiptId}</p></section> : null}
      {request.status === "rejected" ? <section className="direct-receipt-approval-result is-rejected" aria-label="Arrival rejected"><h3>Arrival rejected</h3><p>{request.decisionReason || "No rejection reason recorded."}</p><p>Stock was not added.</p></section> : null}
      {request.status === "pending" && !postedReceiptId ? <section className="direct-receipt-approval-actions" aria-label="Approval decision">
        <label><span>Decision note</span><textarea value={reason} onChange={(event) => setReason(event.target.value)} maxLength={500} placeholder="Required when rejecting" disabled={busy} /></label>
        <div><Button type="button" onClick={() => decide("reject")} disabled={busy || !reason.trim()}>Reject</Button><Button type="button" variant="primary" onClick={() => decide("approve")} disabled={busy}>{busy ? "Saving…" : "Approve and receive"}</Button></div>
      </section> : null}
    </> : null}
  </section>;
}
