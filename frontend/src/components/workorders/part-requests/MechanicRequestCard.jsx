import { useState } from "react";
import { api } from "../../../lib/api.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { ALLOCATION_STATUS_LABELS, SOURCE_LABELS } from "./part-request-model.js";
import { RequestSummary } from "./RequestSummary.jsx";

export function MechanicRequestCard({ request, detail, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updateUsage(usageStatus) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/mechanic/workorders/${detail.workorder.id}/parts/${request.id}/usage`, {
        method: "PATCH",
        body: JSON.stringify({ usageStatus }),
      });
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="part-request-card">
      <RequestSummary request={request} />
      {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
      {request.decisionReason ? <p className="part-request-note">{request.decisionReason}</p> : null}
      {request.allocations.length ? (
        <div className="part-allocation-list">
          {request.allocations.map((allocation) => (
            <span key={allocation.id}>
              {SOURCE_LABELS[allocation.sourceType]} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)} · {ALLOCATION_STATUS_LABELS[allocation.status]}
            </span>
          ))}
        </div>
      ) : null}
      {request.approvalStatus === "approved" ? (
        <label className="part-usage-control">
          Usage
          <select value={request.usageStatus} onChange={(event) => updateUsage(event.target.value)} disabled={busy}>
            <option value="not_issued">Not issued</option>
            <option value="issued">Issued</option>
            <option value="partially_installed">Partially installed</option>
            <option value="installed">Installed</option>
            <option value="not_used">Not used</option>
            <option value="returned">Returned</option>
            <option value="damaged">Damaged</option>
          </select>
        </label>
      ) : null}
      {message ? <p className="part-request-error">{message}</p> : null}
    </article>
  );
}
