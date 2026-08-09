import { NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";

function writable(access) {
  return access === WORKORDER_MODULE_ACCESS.WRITE || access === WORKORDER_MODULE_ACCESS.REQUIRED;
}

export function WorkorderAssignmentModule({
  access,
  activeSection,
  allowedActions = {},
  assignedIds = [],
  assignment,
  assignmentChanged,
  assignableMechanics = [],
  busy,
  mechanicNames,
  onAssignmentChange,
  onSave,
  onSelect,
}) {
  if (!access) return null;
  const canWrite = writable(access) && Boolean(allowedActions.assignMechanics);
  return (
    <ProgressiveWorkorderSection
      id="assignment"
      title="Assignment"
      summary={mechanicNames || "Unassigned"}
      activeSection={activeSection}
      onSelect={onSelect}
      attention={!assignedIds.length}
      displayMode="panel"
    >
      {canWrite ? (
        <div className="office-assignment-control">
          <fieldset className="office-mechanic-team">
            <legend>Assigned mechanics</legend>
            {assignableMechanics.map((mechanic) => {
              const checked = assignment.mechanicUserIds.includes(mechanic.id);
              return (
                <label key={mechanic.id}>
                  <input type="checkbox" checked={checked} onChange={() => onAssignmentChange?.((current) => ({
                    ...current,
                    mechanicUserIds: checked
                      ? current.mechanicUserIds.filter((id) => id !== mechanic.id)
                      : [...current.mechanicUserIds, mechanic.id],
                  }))} />
                  <span>{mechanic.name}</span>
                </label>
              );
            })}
            {!assignableMechanics.length ? <p>No mechanics assigned to this location.</p> : null}
          </fieldset>
          <Field label="Assignment reason">
            <NarrativeField singleLine value={assignment.reason} onChange={(event) => onAssignmentChange?.((current) => ({ ...current, reason: event.target.value }))} placeholder="Why is the team changing?" />
          </Field>
          <Button type="button" variant="secondary" disabled={busy || !assignmentChanged} onClick={onSave}>Update team</Button>
        </div>
      ) : null}
      <dl className="workorder-assigned-mechanics"><div><dt>Assigned mechanics</dt><dd>{mechanicNames || "Unassigned"}</dd></div></dl>
    </ProgressiveWorkorderSection>
  );
}
