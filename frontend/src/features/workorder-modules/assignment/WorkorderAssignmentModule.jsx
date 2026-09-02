import { NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Field } from "../../generator/GeneratorUi.jsx";
import { WORKORDER_MODULE_ACCESS } from "../workorder-module-registry.js";
import { interfaceText } from "../../../i18n/index.js";

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
  locale = "en",
  onAssignmentChange,
  onSave,
  onSelect,
}) {
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const canWrite = writable(access) && Boolean(allowedActions.assignMechanics);
  return (
    <ProgressiveWorkorderSection
      id="assignment"
      title={t("assignment.title")}
      activeSection={activeSection}
      onSelect={onSelect}
      attention={!assignedIds.length}
      displayMode="panel"
    >
      {canWrite ? (
        <div className="office-assignment-control">
          <fieldset className="office-mechanic-team">
            <legend>{t("assignment.assignedMechanics")}</legend>
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
            {!assignableMechanics.length ? <p>{t("assignment.noneAtLocation")}</p> : null}
          </fieldset>
          <Field label={t("assignment.reason")}>
            <NarrativeField locale={locale} singleLine value={assignment.reason} onChange={(event) => onAssignmentChange?.((current) => ({ ...current, reason: event.target.value }))} placeholder={t("assignment.reasonPlaceholder")} />
          </Field>
          <Button type="button" variant="secondary" disabled={busy || !assignmentChanged} onClick={onSave}>{t("assignment.updateTeam")}</Button>
        </div>
      ) : null}
      <dl className="workorder-assigned-mechanics"><div><dt>{t("assignment.assignedMechanics")}</dt><dd>{mechanicNames || t("assignment.unassigned")}</dd></div></dl>
    </ProgressiveWorkorderSection>
  );
}
