import { WorkorderQueueTabs } from "../workorders/WorkorderQueue.jsx";
import { MobileQueueTools } from "./MobileQueueTools.jsx";
import "./mobile-queue-tools.css";

export function MobileQueueToolbar({
  activeTab,
  children,
  className = "",
  filtersActive = false,
  label,
  onChange,
  onClearFilters,
  tabs,
  title,
}) {
  return (
    <div className={`mobile-queue-toolbar ${className}`.trim()}>
      <WorkorderQueueTabs tabs={tabs} activeTab={activeTab} onChange={onChange} />
      <MobileQueueTools
        label={label}
        title={title}
        filtersActive={filtersActive}
        onClearFilters={onClearFilters}
      >
        {children}
      </MobileQueueTools>
    </div>
  );
}
