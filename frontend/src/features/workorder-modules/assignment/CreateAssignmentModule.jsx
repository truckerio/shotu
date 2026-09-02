import { MechanicMultiSelect } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { SectionHelpDisclosure } from "../../../components/workorders/SectionHelpDisclosure.jsx";

export function CreateAssignmentModule({ access, activeSection, assignment, onChange }) {
  if (!access) return null;
  return (
    <ProgressiveWorkorderSection id="assignment" className="create-assignment-card" title="Assignment" headerAction={<SectionHelpDisclosure label="Assignment help"><p>Choose the mechanic team for this workorder.</p><p>Leave the team empty to make this work available for mechanics to accept.</p></SectionHelpDisclosure>} activeSection={activeSection} onSelect={() => {}} displayMode="panel" keepMounted>
      <div className="create-assignment-content">
        <MechanicMultiSelect mechanics={assignment?.mechanics || []} selectedIds={assignment?.mechanicUserIds || []} onChange={onChange} disabled={assignment?.loading} emptyMessage={assignment?.loading ? "Loading mechanics..." : "No active mechanics at this location."} description="" />
        {!assignment?.mechanicUserIds?.length ? <p className="operational-availability-note">This workorder will appear in the available queue.</p> : null}
      </div>
    </ProgressiveWorkorderSection>
  );
}
