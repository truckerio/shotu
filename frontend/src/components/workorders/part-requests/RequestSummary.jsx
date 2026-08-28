import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { APPROVAL_LABELS, requestUomCode, statusText } from "./part-request-model.js";
import { interfaceText } from "../../../i18n/index.js";

export function RequestSummary({ request, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const approvalKey = `parts.approval.${request.approvalStatus}`;
  const localizedApproval = t(approvalKey);
  return (
    <div className="part-request-summary">
      <div>
        <strong>{request.partNumber || request.description || request.rawQuery}</strong>
        <span>{[request.manufacturer, request.description].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="part-request-meta">
        <span>{formatQuantityUnit(request.quantity, requestUomCode(request))}</span>
        <span className={`part-state part-state-${request.approvalStatus}`}>
          {localizedApproval === approvalKey
            ? APPROVAL_LABELS[request.approvalStatus] || statusText(request.approvalStatus)
            : localizedApproval}
        </span>
      </div>
    </div>
  );
}
