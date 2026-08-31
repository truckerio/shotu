import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { ALLOCATION_STATUS_LABELS, SOURCE_LABELS, statusText } from "./part-request-model.js";
import { RequestSummary } from "./RequestSummary.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function MechanicRequestCard({ request, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const labelFor = (prefix, value, fallback) => {
    const key = `${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
  const usageKey = `parts.usage.${request.usageStatus}`;
  const localizedUsage = t(usageKey);
  return (
    <article className="part-request-card">
      <RequestSummary request={request} locale={locale} />
      {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
      {request.decisionReason ? <p className="part-request-note">{request.decisionReason}</p> : null}
      {request.allocations.length ? (
        <div className="part-allocation-list">
          {request.allocations.map((allocation) => (
            <span key={allocation.id}>
              {labelFor("parts.source", allocation.sourceType, SOURCE_LABELS[allocation.sourceType])} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)} · {labelFor("parts.allocation", allocation.status, ALLOCATION_STATUS_LABELS[allocation.status])}
            </span>
          ))}
        </div>
      ) : null}
      {request.approvalStatus === "approved" && request.usageStatus ? (
        <p className="part-request-note">{localizedUsage === usageKey ? statusText(request.usageStatus) : localizedUsage}</p>
      ) : null}
    </article>
  );
}
