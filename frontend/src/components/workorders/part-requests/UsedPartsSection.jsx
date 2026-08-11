import { UsedPartsEditor } from "../UsedPartsEditor.jsx";

export function UsedPartsSection({
  actorId,
  detail,
  parts,
  laborHours,
  laborProduct,
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
        laborProduct={laborProduct}
        laborRepairOrder={laborRepairOrder}
        onLaborHoursChange={onLaborHoursChange}
        onChange={onPartsChange}
        onSave={onSaveParts}
        disabled={!editable}
        readonlyMessage={readonlyMessage}
        suggestionsEnabled={suggestionsEnabled}
      />
    </div>
  );
}
