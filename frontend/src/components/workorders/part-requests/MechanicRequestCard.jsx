import { Dropdown } from "../../forms/Dropdown.jsx";
import { useState } from "react";
import { api } from "../../../lib/api.js";
import { formatQuantityUnit } from "../../forms/quantity-unit-model.js";
import { ALLOCATION_STATUS_LABELS, SOURCE_LABELS } from "./part-request-model.js";
import { RequestSummary } from "./RequestSummary.jsx";
import { interfaceText } from "../../../i18n/index.js";

export function MechanicRequestCard({ request, detail, onChanged, locale = "en" }) {
  const t = (key) => interfaceText(locale, key);
  const labelFor = (prefix, value, fallback) => {
    const key = `${prefix}.${value}`;
    const translated = t(key);
    return translated === key ? fallback : translated;
  };
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
      setMessage(locale === "en" && error?.message ? error.message : t("parts.usageUpdateFailed"));
    } finally {
      setBusy(false);
    }
  }

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
      {request.approvalStatus === "approved" ? (
        <label className="part-usage-control">
          {t("parts.usage")}
          <Dropdown value={request.usageStatus} onChange={(event) => updateUsage(event.target.value)} disabled={busy}>
            <option value="not_issued">{t("parts.usage.not_issued")}</option>
            <option value="issued">{t("parts.usage.issued")}</option>
            <option value="partially_installed">{t("parts.usage.partially_installed")}</option>
            <option value="installed">{t("parts.usage.installed")}</option>
            <option value="not_used">{t("parts.usage.not_used")}</option>
            <option value="returned">{t("parts.usage.returned")}</option>
            <option value="damaged">{t("parts.usage.damaged")}</option>
          </Dropdown>
        </label>
      ) : null}
      {message ? <p className="part-request-error">{message}</p> : null}
    </article>
  );
}
