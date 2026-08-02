import { MechanicRequestCard } from "./MechanicRequestCard.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";

export function ReadOnlyPartsSurface({
  actorId,
  detail,
  parts,
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
