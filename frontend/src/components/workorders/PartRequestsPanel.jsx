import { installedSerializedUsedParts, usedPartsAccessState } from "./used-parts-model.js";
import { MechanicPartsSurface } from "./part-requests/MechanicPartsSurface.jsx";
import { OfficePartsSurface } from "./part-requests/OfficePartsSurface.jsx";
import { ReadOnlyPartsSurface } from "./part-requests/ReadOnlyPartsSurface.jsx";
import "./part-requests-panel.css";

export function PartRequestsPanel({
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
    financialFooter,
    actorId,
    role,
    detail,
    parts,
    laborHours,
    laborProduct,
    locationId,
    laborRepairOrder,
    laborRepairOrderDisabled,
    laborLogContent,
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
        <MechanicPartsSurface {...commonProps} locale={locale} presentation={presentation} />
      ) : role === "office" ? (
        <OfficePartsSurface {...commonProps} presentation={presentation} />
      ) : (
        <ReadOnlyPartsSurface {...commonProps} />
      )}
    </div>
  );
}
