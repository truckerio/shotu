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
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  usedPartsAccess,
}) {
  const requests = detail.partRequests || [];

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
        onLaborHoursChange={onLaborHoursChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onPartsChange={onPartsChange}
        onSaveParts={onSaveParts}
        editable={usedPartsAccess.editable}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
      />
      <div className="office-part-overview">
        <strong>{officeQueueText(requests)}</strong>
      </div>
      <div className="part-request-list">
        {requests.length ? requests.map((request) => (
          <OfficeRequestCard request={request} detail={detail} onChanged={onChanged} key={request.id} />
        )) : <p className="part-request-empty">No part requests yet.</p>}
      </div>
    </>
  );
}
