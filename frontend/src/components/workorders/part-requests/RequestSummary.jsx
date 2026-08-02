import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { APPROVAL_LABELS, requestUomCode, statusText } from "./part-request-model.js";

export function RequestSummary({ request }) {
  return (
    <div className="part-request-summary">
      <div>
        <strong>{request.partNumber || request.description || request.rawQuery}</strong>
        <span>{[request.manufacturer, request.description].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="part-request-meta">
        <span>{formatQuantityUnit(request.quantity, requestUomCode(request))}</span>
        <span className={`part-state part-state-${request.approvalStatus}`}>
          {APPROVAL_LABELS[request.approvalStatus] || statusText(request.approvalStatus)}
        </span>
      </div>
    </div>
  );
}
