import { useEffect, useRef } from "react";
import { officeQueueText } from "./part-request-model.js";
import { OfficeRequestCard } from "./OfficeRequestCard.jsx";
import { OfficePartComposer } from "./OfficePartComposer.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";
import { interfaceText } from "../../../i18n/index.js";
import { SectionHelpDisclosure } from "../SectionHelpDisclosure.jsx";

export function OfficePartsSurface({
  actorId,
  detail,
  parts,
  laborHours,
  laborProduct,
  locationId,
  laborRepairOrder,
  laborRepairOrderDisabled,
  installedParts = [],
  onLaborHoursChange,
  onLaborProductChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts,
  usedPartsAccess,
  laborEditable,
  presentation = "panel",
}) {
  const locale = "en";
  const t = (key) => interfaceText(locale, key);
  const requests = detail.partRequests || [];
  const focusedRequestId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("partRequest") || "";
  const focusedRequestRef = useRef(null);

  useEffect(() => {
    if (!focusedRequestId || !requests.some((request) => request.id === focusedRequestId)) return;
    const frame = window.requestAnimationFrame(() => {
      focusedRequestRef.current?.scrollIntoView?.({ block: "center" });
      focusedRequestRef.current?.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedRequestId, requests]);

  return (
    <>
      <UsedPartsSection
        actorId={actorId}
        role="office"
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborProduct={laborProduct}
        locationId={locationId}
        laborRepairOrder={laborRepairOrder}
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        installedParts={installedParts}
        onLaborHoursChange={onLaborHoursChange}
        onLaborProductChange={onLaborProductChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onPartsChange={onPartsChange}
        onSaveParts={onSaveParts}
        onChanged={onChanged}
        onRegisterSerializedRepairFlush={onRegisterSerializedRepairFlush}
        serializedParts={serializedParts}
        editable={usedPartsAccess.editable}
        laborEditable={laborEditable}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
        presentation={presentation}
      />
      {detail.allowedActions?.planParts ? (
        <section className={`office-part-planning${presentation === "one-page" ? " is-one-page" : ""}`} aria-labelledby="requests-supply-heading">
          <div className="office-part-planning-heading">
            <h3 id="requests-supply-heading">{t("parts.requestsSupply")}</h3>
            <SectionHelpDisclosure label={t("parts.planningDoesNotRecordUse")}><p>{t("parts.planningDoesNotRecordUse")}</p></SectionHelpDisclosure>
          </div>
          <OfficePartComposer detail={detail} onChanged={onChanged} />
        </section>
      ) : null}
      {requests.length ? <div className={`office-part-overview${presentation === "one-page" ? " is-one-page" : ""}`}>
        <strong>{officeQueueText(requests, locale)}</strong>
      </div> : null}
      <div className={`part-request-list${presentation === "one-page" ? " is-one-page" : ""}`}>
        {requests.length ? requests.map((request) => (
          <div
            id={`part-request-${request.id}`}
            className={`part-request-focus-target${request.id === focusedRequestId ? " is-selected" : ""}`}
            ref={request.id === focusedRequestId ? focusedRequestRef : undefined}
            tabIndex={request.id === focusedRequestId ? -1 : undefined}
            aria-current={request.id === focusedRequestId ? "true" : undefined}
            aria-label={request.id === focusedRequestId ? `${t("parts.selectedRequest")} ${request.partNumber || request.description || ""}`.trim() : undefined}
            key={request.id}
          >
            <OfficeRequestCard request={request} detail={detail} onChanged={onChanged} />
          </div>
        )) : null}
      </div>
    </>
  );
}
