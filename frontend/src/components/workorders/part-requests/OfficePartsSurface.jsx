import { useEffect, useRef } from "react";
import { officeQueueText } from "./part-request-model.js";
import { OfficeRequestCard } from "./OfficeRequestCard.jsx";
import { OfficePartComposer } from "./OfficePartComposer.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function OfficePartsSurface({
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
  usedPartsAccess,
}) {
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
      {detail.allowedActions?.addApprovedParts ? (
        <OfficePartComposer detail={detail} onChanged={onChanged} />
      ) : null}
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
      />
      <div className="office-part-overview">
        <strong>{officeQueueText(requests)}</strong>
      </div>
      <div className="part-request-list">
        {requests.length ? requests.map((request) => (
          <div
            id={`part-request-${request.id}`}
            className={`part-request-focus-target${request.id === focusedRequestId ? " is-selected" : ""}`}
            ref={request.id === focusedRequestId ? focusedRequestRef : undefined}
            tabIndex={request.id === focusedRequestId ? -1 : undefined}
            aria-current={request.id === focusedRequestId ? "true" : undefined}
            aria-label={request.id === focusedRequestId ? `Selected part request ${request.partNumber || request.description || ""}`.trim() : undefined}
            key={request.id}
          >
            <OfficeRequestCard request={request} detail={detail} onChanged={onChanged} />
          </div>
        )) : <p className="part-request-empty">No part requests yet.</p>}
      </div>
    </>
  );
}
