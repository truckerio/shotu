import { useEffect, useState } from "react";
import { interfaceText } from "../../../i18n/index.js";
import { MechanicPartRequestForm } from "../MechanicPartRequestForm.jsx";
import { mechanicPartsActionState } from "../mechanic-part-request-model.js";
import { usedPartHasValue } from "../used-parts-model.js";
import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function MechanicPartsSurface({
  actorId,
  detail,
  parts,
  laborHours,
  laborProduct,
  laborRepairOrder,
  laborRepairOrderDisabled,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  locale,
  usedPartsAccess,
}) {
  const mechanicActions = mechanicPartsActionState(detail.allowedActions || {});
  const [activeAction, setActiveAction] = useState(() => mechanicActions.canRecordUsedPart ? "used" : "");
  const requests = detail.partRequests || [];
  const hasRecordedUsedParts = Array.isArray(parts) && parts.some(usedPartHasValue);
  const showUsedParts = mechanicActions.canRecordUsedPart || hasRecordedUsedParts;
  const usedPartsPanelId = `used-parts-${detail.workorder.id}`;
  const requestPartPanelId = `request-part-${detail.workorder.id}`;
  const t = (key) => interfaceText(locale, key);

  useEffect(() => {
    setActiveAction(mechanicActions.canRecordUsedPart ? "used" : "");
  }, [detail.workorder.id, mechanicActions.canRecordUsedPart]);

  return (
    <>
      {mechanicActions.available.length ? (
        <div className="mechanic-part-choices" role="group" aria-label={t("parts.chooseAction")}>
          {mechanicActions.canRecordUsedPart ? (
            <button
              type="button"
              className={activeAction === "used" ? "is-selected" : ""}
              aria-pressed={activeAction === "used"}
              aria-controls={usedPartsPanelId}
              onClick={() => setActiveAction("used")}
            >
              {t("parts.usedPartAction")}
            </button>
          ) : null}
          {mechanicActions.canRequestPart ? (
            <button
              type="button"
              className={activeAction === "request" ? "is-selected" : ""}
              aria-pressed={activeAction === "request"}
              aria-controls={requestPartPanelId}
              onClick={() => setActiveAction("request")}
            >
              {t("parts.needPartAction")}
            </button>
          ) : null}
        </div>
      ) : null}

      {mechanicActions.canRequestPart ? (
        <div id={requestPartPanelId} hidden={activeAction !== "request"}>
          <MechanicPartRequestForm workorderId={detail.workorder.id} onChanged={onChanged} locale={locale} />
        </div>
      ) : null}

      {showUsedParts ? (
        <div hidden={mechanicActions.canRecordUsedPart && activeAction !== "used"}>
          <UsedPartsSection
            actorId={actorId}
            detail={detail}
            parts={parts}
            laborHours={laborHours}
            laborProduct={laborProduct}
            laborRepairOrder={laborRepairOrder}
            laborRepairOrderDisabled={laborRepairOrderDisabled}
            onLaborHoursChange={onLaborHoursChange}
            onLaborRepairOrderChange={onLaborRepairOrderChange}
            onPartsChange={onPartsChange}
            onSaveParts={onSaveParts}
            editable={usedPartsAccess.editable}
            readonlyMessage={usedPartsAccess.message}
            suggestionsEnabled={false}
            locale={locale}
            id={usedPartsPanelId}
          />
        </div>
      ) : null}

      {requests.length ? (
        <div className="part-request-list">
          {requests.map((request) => (
            <MechanicRequestCard request={request} detail={detail} onChanged={onChanged} locale={locale} key={request.id} />
          ))}
        </div>
      ) : null}
    </>
  );
}
