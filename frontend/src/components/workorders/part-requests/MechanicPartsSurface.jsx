import { useState } from "react";
import { interfaceText } from "../../../i18n/index.js";
import { MechanicPartRequestForm } from "../MechanicPartRequestForm.jsx";
import { mechanicPartsActionState } from "../mechanic-part-request-model.js";
import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

function isCompletedRequest(request) {
  if (["rejected", "cancelled"].includes(request.approvalStatus)) return true;
  // `not_used` remains open: the Office queue treats it as an unresolved exception.
  return ["installed", "returned"].includes(request.usageStatus);
}

export function MechanicPartsSurface({
  actorId,
  detail,
  parts,
  laborHours,
  laborProduct,
  laborRepairOrder,
  laborRepairOrderDisabled,
  installedParts = [],
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts,
  locale,
  usedPartsAccess,
}) {
  const mechanicActions = mechanicPartsActionState(detail.allowedActions || {});
  const [requestFormOpen, setRequestFormOpen] = useState(false);
  const requests = detail.partRequests || [];
  const requestPartPanelId = `request-part-${detail.workorder.id}`;
  const openRequests = requests.filter((request) => !isCompletedRequest(request));
  const completedRequests = requests.filter(isCompletedRequest);
  const t = (key) => interfaceText(locale, key);

  return (
    <>
      <UsedPartsSection
        actorId={actorId}
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborProduct={laborProduct}
        laborRepairOrder={laborRepairOrder}
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        installedParts={installedParts}
        onLaborHoursChange={onLaborHoursChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onPartsChange={onPartsChange}
        onSaveParts={onSaveParts}
        onChanged={onChanged}
        onRegisterSerializedRepairFlush={onRegisterSerializedRepairFlush}
        serializedParts={serializedParts}
        editable={usedPartsAccess.editable}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
        locale={locale}
      />

      {mechanicActions.canRequestPart ? (
        <div className="mechanic-part-request-action">
          <button
            type="button"
            aria-controls={requestPartPanelId}
            aria-expanded={requestFormOpen}
            onClick={() => setRequestFormOpen((open) => !open)}
          >
            {t("parts.requestPart")}
          </button>
          <div id={requestPartPanelId} hidden={!requestFormOpen}>
            <MechanicPartRequestForm workorderId={detail.workorder.id} onChanged={onChanged} locale={locale} />
          </div>
        </div>
      ) : null}

      {openRequests.length ? (
        <section className="part-request-section" aria-label={t("parts.requestsSupply")}>
          <h3>{t("parts.requestsSupply")}</h3>
          <div className="part-request-list">
            {openRequests.map((request) => (
              <MechanicRequestCard request={request} detail={detail} onChanged={onChanged} locale={locale} key={request.id} />
            ))}
          </div>
        </section>
      ) : null}

      {completedRequests.length ? (
        <details className="part-request-history">
          <summary>{t("parts.completedRequests")} ({completedRequests.length})</summary>
          <div className="part-request-list">
            {completedRequests.map((request) => (
              <MechanicRequestCard request={request} detail={detail} onChanged={onChanged} locale={locale} key={request.id} />
            ))}
          </div>
        </details>
      ) : null}
    </>
  );
}
