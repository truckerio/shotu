import { installedSerializedUsedParts, usedPartsAccessState } from "./used-parts-model.js";
import { MechanicPartsSurface } from "./part-requests/MechanicPartsSurface.jsx";
import { OfficePartsSurface } from "./part-requests/OfficePartsSurface.jsx";
import { ReadOnlyPartsSurface } from "./part-requests/ReadOnlyPartsSurface.jsx";
import "./part-requests-panel.css";

export function PartRequestsPanel({
  actorId,
  role,
  detail,
  parts,
  laborHours,
  laborProduct,
  locationId,
  laborRepairOrder,
  laborRepairOrderDisabled,
  onLaborHoursChange,
  onLaborProductChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts = null,
  locale = "en",
  presentation = "panel",
}) {
  const usedPartsAccess = usedPartsAccessState(role, detail.allowedActions || {});
  const laborEditable = detail.allowedActions?.saveNotes === true;
  const installedParts = installedSerializedUsedParts(detail);
  const commonProps = {
    actorId,
    role,
    detail,
    parts,
    laborHours,
    laborProduct,
    locationId,
    laborRepairOrder,
    laborRepairOrderDisabled,
    installedParts,
    onLaborHoursChange,
    onLaborProductChange,
    onLaborRepairOrderChange,
    onPartsChange,
    onSaveParts,
    onChanged,
    onRegisterSerializedRepairFlush,
    serializedParts,
    usedPartsAccess,
    laborEditable,
  };

  return (
    <div className="part-requests-panel">
      {role === "mechanic" ? (
        <MechanicPartsSurface {...commonProps} locale={locale} />
      ) : role === "office" ? (
        <OfficePartsSurface {...commonProps} presentation={presentation} />
      ) : (
        <ReadOnlyPartsSurface {...commonProps} />
      )}
    </div>
  );
}
