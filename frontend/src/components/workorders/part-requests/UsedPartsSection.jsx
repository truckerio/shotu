import { UsedPartsEditor } from "../UsedPartsEditor.jsx";

export function UsedPartsSection({
  actorId,
  detail,
  parts,
  laborHours,
  laborRepairOrder,
  onLaborHoursChange,
  onPartsChange,
  onSaveParts,
  editable,
  readonlyMessage,
  suggestionsEnabled,
  id,
  hidden,
}) {
  return (
    <div id={id} hidden={hidden}>
      <UsedPartsEditor
        actorId={actorId}
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborRepairOrder={laborRepairOrder}
        onLaborHoursChange={onLaborHoursChange}
        onChange={onPartsChange}
        onSave={onSaveParts}
        disabled={!editable}
        readonlyMessage={readonlyMessage}
        minimumRows={0}
        suggestionsEnabled={suggestionsEnabled}
      />
    </div>
  );
}
