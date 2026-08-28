import { UsedPartsEditor } from "../UsedPartsEditor.jsx";

export function UsedPartsSection({
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
  editable,
  readonlyMessage,
  suggestionsEnabled,
  locale,
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
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        onLaborHoursChange={onLaborHoursChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onChange={onPartsChange}
        onSave={onSaveParts}
        disabled={!editable}
        readonlyMessage={readonlyMessage}
        suggestionsEnabled={suggestionsEnabled}
        locale={locale}
      />
    </div>
  );
}
