import { RepairHistorySuggestions } from "./RepairHistorySuggestions.jsx";

/**
 * Shared repair-order field shell for Create and Detail Parts rows.
 * History stays attached to the field and opens only when requested.
 */
export function PartRepairOrderField({
  children,
  historyEnabled = true,
  workorderId,
  locationId,
  catalogPartId,
  partNumber,
  assetId,
  currentRepairOrder = "",
  onApply,
  disabled = false,
  locale = "en",
  className = "",
}) {
  return (
    <div className={`workorder-part-repair-with-history ${className}`.trim()}>
      {children}
      {historyEnabled && catalogPartId ? <RepairHistorySuggestions
        workorderId={workorderId}
        locationId={locationId}
        catalogPartId={catalogPartId}
        partNumber={partNumber}
        assetId={assetId}
        currentRepairOrder={currentRepairOrder}
        onApply={onApply}
        disabled={disabled}
        locale={locale}
        initiallyCollapsed
        dropdown
      /> : null}
    </div>
  );
}
