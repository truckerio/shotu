import { PartRequestsPanel } from "../../../components/workorders/PartRequestsPanel.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
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
  onPartsChange,
  onSaveParts,
  onSelect,
}) {
  if (!access) return null;
  const canWrite = access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
  return (
    <ProgressiveWorkorderSection
      id="parts"
      title={isMechanicDetail ? "Parts used" : "Parts"}
      summary={pendingPartCount ? `${pendingPartCount} awaiting action` : `${filledPartCount} recorded`}
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
          onLaborHoursChange={onLaborHoursChange}
          onPartsChange={onPartsChange}
          onSaveParts={onSaveParts}
          onChanged={onChanged}
          locale={locale}
        />
      </div>
    </ProgressiveWorkorderSection>
  );
}
