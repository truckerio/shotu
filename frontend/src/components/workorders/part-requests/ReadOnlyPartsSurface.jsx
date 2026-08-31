import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function ReadOnlyPartsSurface({
  actorId,
  role = "read",
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
  laborEditable,
}) {
  const requests = detail.partRequests || [];
  return (
    <>
      <UsedPartsSection
        actorId={actorId}
        role={role}
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
        laborEditable={laborEditable}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
      />
      {requests.length ? (
        <div className="part-request-list">
          {requests.map((request) => (
            <MechanicRequestCard request={request} key={request.id} />
          ))}
        </div>
      ) : null}
    </>
  );
}
