import { FilterLines } from "@untitledui/icons";
import { useState } from "react";
import { MobileFilterSheet } from "../responsive/MobileFilterSheet.jsx";
import "./mobile-queue-tools.css";

export function MobileQueueTools({
  label = "Open queue tools",
  title = "Queue tools",
  children,
  filtersActive = false,
  onClearFilters,
}) {
  const [open, setOpen] = useState(false);

  return (
    <div className="mobile-queue-tools">
      <button
        className="mobile-queue-tools-trigger"
        type="button"
        aria-label={label}
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={() => setOpen(true)}
      >
        <FilterLines aria-hidden="true" />
        {filtersActive ? <span className="mobile-queue-tools-indicator" aria-hidden="true" /> : null}
      </button>
      <MobileFilterSheet
        open={open}
        onOpenChange={setOpen}
        title={title}
        footer={(
          <div className="mobile-queue-tools-footer">
            {onClearFilters ? (
              <button type="button" disabled={!filtersActive} onClick={onClearFilters}>Clear filters</button>
            ) : <span />}
            <button type="button" className="mobile-queue-tools-done" onClick={() => setOpen(false)}>Show results</button>
          </div>
        )}
      >
        {children}
      </MobileFilterSheet>
    </div>
  );
}
