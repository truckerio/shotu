import { PartRequestsPanel } from "../../../components/workorders/PartRequestsPanel.jsx";
import { SerializedPartsScanner } from "../../../components/workorders/part-requests/SerializedPartsScanner.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { interfaceText } from "../../../i18n/index.js";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

export function WorkorderPartsModule({
  access,
  activeWorkorder,
  actorId,
  detailSection,
  filledPartCount,
  form,
  isMechanicDetail,
  isOfficeDetail,
  locale,
  pendingPartCount,
  onChanged,
  onLaborHoursChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onSelect,
}) {
  const scanningAccess = activeWorkorder.moduleAccess?.partsScanning?.access;
  const canScanSerializedParts = scanningAccess === WORKORDER_MODULE_ACCESS.WRITE
    || scanningAccess === WORKORDER_MODULE_ACCESS.REQUIRED;
  const partsVisible = access && access !== WORKORDER_MODULE_ACCESS.HIDDEN;
  if (!partsVisible && !canScanSerializedParts) return null;
  const canWrite = access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection
      id="parts"
      title={isMechanicDetail ? t("parts.usedTitle") : "Parts"}
      summary={partsVisible
        ? (pendingPartCount
          ? `${pendingPartCount} ${isMechanicDetail ? t("parts.awaitingAction") : "awaiting action"}`
          : `${filledPartCount} ${isMechanicDetail ? t("parts.recorded") : "recorded"}`)
        : "Scan exact serialized parts"}
      activeSection={detailSection}
      onSelect={onSelect}
      attention={partsVisible && pendingPartCount > 0}
      displayMode="panel"
    >
      <div id={isMechanicDetail ? "mechanic-parts-section" : undefined}>
        {canScanSerializedParts ? (
          <SerializedPartsScanner
            key={`scanner:${activeWorkorder.workorder.id}`}
            workorderId={activeWorkorder.workorder.id}
            onChanged={onChanged}
            locale={locale}
          />
        ) : null}
        {partsVisible ? <PartRequestsPanel
          key={activeWorkorder.workorder.id}
          actorId={actorId}
          role={canWrite ? (isOfficeDetail ? "office" : "mechanic") : "read"}
          detail={activeWorkorder}
          parts={form.parts}
          laborHours={form.laborHours || ""}
          laborProduct={form.laborProduct || null}
          laborRepairOrder={form.workPerformed || ""}
          laborRepairOrderDisabled={!activeWorkorder.allowedActions?.saveNotes}
          onLaborHoursChange={onLaborHoursChange}
          onLaborRepairOrderChange={onLaborRepairOrderChange}
          onPartsChange={onPartsChange}
          onSaveParts={onSaveParts}
          onChanged={onChanged}
          locale={locale}
        /> : null}
      </div>
    </ProgressiveWorkorderSection>
  );
}
