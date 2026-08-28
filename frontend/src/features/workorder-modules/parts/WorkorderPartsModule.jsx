import { PartRequestsPanel } from "../../../components/workorders/PartRequestsPanel.jsx";
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
  if (!access) return null;
  const canWrite = access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
  const t = (key) => interfaceText(locale, key);
  return (
    <ProgressiveWorkorderSection
      id="parts"
      title={isMechanicDetail ? t("parts.usedTitle") : "Parts"}
      summary={pendingPartCount
        ? `${pendingPartCount} ${isMechanicDetail ? t("parts.awaitingAction") : "awaiting action"}`
        : `${filledPartCount} ${isMechanicDetail ? t("parts.recorded") : "recorded"}`}
      activeSection={detailSection}
      onSelect={onSelect}
      attention={pendingPartCount > 0}
      displayMode="panel"
    >
      <div id={isMechanicDetail ? "mechanic-parts-section" : undefined}>
        <PartRequestsPanel
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
        />
      </div>
    </ProgressiveWorkorderSection>
  );
}
