import { MechanicMultiSelect } from "../../../components/forms/index.js";
import { useEffect, useId, useRef, useState } from "react";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";

function selectedMechanicNames(mechanics, selectedIds) {
  const selected = new Set((selectedIds || []).map(String));
  return (mechanics || []).filter((mechanic) => selected.has(String(mechanic.id))).map((mechanic) => mechanic.name).filter(Boolean);
}

export function CreateAssignmentModule({ access, activeSection, assignment, onChange, presentation = "panel" }) {
  const dropdownRef = useRef(null);
  const triggerRef = useRef(null);
  const [open, setOpen] = useState(false);
  const optionsId = useId();
  const onePage = presentation === "one-page";
  const mechanics = assignment?.mechanics || [];
  const selectedIds = assignment?.mechanicUserIds || [];
  const selectedNames = selectedMechanicNames(mechanics, selectedIds);
  const mechanicSelect = <MechanicMultiSelect mechanics={mechanics} selectedIds={selectedIds} onChange={onChange} disabled={assignment?.loading} emptyMessage={assignment?.loading ? "Loading mechanics..." : "No active mechanics at this location."} description="" />;
  useEffect(() => {
    if (!onePage) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target)) {
        const restoreFocus = dropdownRef.current.contains(document.activeElement);
        setOpen(false);
        if (restoreFocus) triggerRef.current?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    document.addEventListener("focusin", closeOnOutsidePointer);
    return () => {
      document.removeEventListener("pointerdown", closeOnOutsidePointer);
      document.removeEventListener("focusin", closeOnOutsidePointer);
    };
  }, [onePage]);
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="assignment" className={`create-assignment-card${onePage ? " create-assignment-one-page" : ""}`} title="Assignment" headerAction={onePage ? null : <SectionHelpDisclosure label="Assignment help"><p>Choose the mechanic team for this workorder.</p><p>Leave the team empty to make this work available for mechanics to accept.</p></SectionHelpDisclosure>} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted showTitle={!onePage}>
      <div className="create-assignment-content">
        {onePage ? <div className="create-assignment-one-page-field">
          <span className="create-assignment-one-page-label">Mechanic</span>
          <div className="create-assignment-one-page-dropdown" ref={dropdownRef}
            onBlur={(event) => {
              if (event.relatedTarget && !event.currentTarget.contains(event.relatedTarget)) setOpen(false);
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && open) {
                event.preventDefault();
                event.stopPropagation();
                setOpen(false);
                triggerRef.current?.focus();
              }
            }}>
            <button type="button" className="create-mechanic-trigger" ref={triggerRef} aria-expanded={open} aria-controls={optionsId} disabled={assignment?.loading} onClick={() => setOpen(value => !value)} aria-label={`Mechanic: ${selectedNames.length ? selectedNames.join(", ") : "Select mechanic"}`}>{selectedNames.length ? selectedNames.join(", ") : "Select mechanic"}</button>
            {open ? <div id={optionsId} className="create-mechanic-options">{mechanicSelect}</div> : null}
          </div>
        </div> : mechanicSelect}
        {!onePage && !selectedIds.length ? <p className="operational-availability-note">This workorder will appear in the available queue.</p> : null}
      </div>
    </ProgressiveWorkorderSection>
  );
}
