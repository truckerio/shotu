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
  laborRepairOrder,
  laborRepairOrderDisabled,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts = null,
  locale = "en",
}) {
  const usedPartsAccess = usedPartsAccessState(role, detail.allowedActions || {});
  const laborEditable = detail.allowedActions?.saveNotes === true;
  const installedParts = installedSerializedUsedParts(detail);
  const commonProps = {
    actorId,
    detail,
    parts,
    laborHours,
    laborProduct,
    laborRepairOrder,
    laborRepairOrderDisabled,
    installedParts,
    onLaborHoursChange,
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
        <OfficePartsSurface {...commonProps} />
      ) : (
        <ReadOnlyPartsSurface {...commonProps} />
      )}
    </div>
  );
}
