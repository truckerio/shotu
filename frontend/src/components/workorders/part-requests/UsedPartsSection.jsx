import { UsedPartsEditor } from "../UsedPartsEditor.jsx";

export function UsedPartsSection({
  actorId,
  financialFooter = null,
  role,
  detail,
  parts,
  laborHours,
  laborProduct,
  locationId,
  laborRepairOrder,
  laborRepairOrderDisabled,
  laborLogContent = null,
  installedParts,
  onLaborHoursChange,
  onLaborProductChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts,
  editable,
  laborEditable,
  headerAction = null,
  readonlyMessage,
  suggestionsEnabled,
  locale,
  id,
  hidden,
  presentation = "panel",
}) {
  return (
    <div id={id} hidden={hidden}>
      <UsedPartsEditor
        actorId={actorId}
        financialFooter={financialFooter}
        role={role}
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborProduct={laborProduct}
        locationId={locationId}
        laborRepairOrder={laborRepairOrder}
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        laborLogContent={laborLogContent}
        installedParts={installedParts}
        onLaborHoursChange={onLaborHoursChange}
        onLaborProductChange={onLaborProductChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onChange={onPartsChange}
        onSave={onSaveParts}
        onChanged={onChanged}
        onRegisterSerializedRepairFlush={onRegisterSerializedRepairFlush}
        serializedParts={serializedParts}
        disabled={!editable}
        partsEditable={editable}
        laborEditable={laborEditable}
        headerAction={headerAction}
        readonlyMessage={readonlyMessage}
        suggestionsEnabled={suggestionsEnabled}
        locale={locale}
        presentation={presentation}
      />
    </div>
  );
}
