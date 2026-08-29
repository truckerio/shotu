import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function ReadOnlyPartsSurface({
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
  usedPartsAccess,
}) {
  const requests = detail.partRequests || [];
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
        editable={usedPartsAccess.editable}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
      />
      {requests.length ? (
        <div className="part-request-list">
          {requests.map((request) => (
            <MechanicRequestCard request={request} detail={detail} onChanged={onChanged} key={request.id} />
          ))}
        </div>
      ) : null}
    </>
  );
}
