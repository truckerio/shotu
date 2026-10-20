import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function ReadOnlyPartsSurface({
  actorId,
  financialFooter = null,
  locationId,
  locale = "en",
  presentation = "panel",
  role = "read",
  detail,
  parts,
  laborHours,
  laborProduct,
  laborRepairOrder,
  laborRepairOrderDisabled,
  laborLogContent,
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
        financialFooter={financialFooter}
        locationId={locationId}
        locale={locale}
        presentation={presentation}
        role={role}
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborProduct={laborProduct}
        laborRepairOrder={laborRepairOrder}
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        laborLogContent={laborLogContent}
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
