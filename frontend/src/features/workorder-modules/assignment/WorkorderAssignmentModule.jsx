import { useEffect, useRef } from "react";
import { NarrativeField } from "../../../components/forms/index.js";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { Checkbox } from "../../../components/ui/Checkbox.jsx";
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
  presentation = "panel",
}) {
  const dropdownRef = useRef(null);
  const onePage = presentation === "one-page";
  useEffect(() => {
    if (!onePage) return undefined;
    const closeOnOutsidePointer = (event) => {
      if (dropdownRef.current?.open && !dropdownRef.current.contains(event.target)) {
        const restoreFocus = dropdownRef.current.contains(document.activeElement);
        dropdownRef.current.open = false;
        if (restoreFocus) dropdownRef.current.querySelector("summary")?.focus();
      }
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [onePage]);
  if (!access) return null;
  const t = (key) => interfaceText(locale, key);
  const canWrite = writable(access) && Boolean(allowedActions.assignMechanics);
  const selectedNames = assignableMechanics.filter((mechanic) => assignedIds.map(String).includes(String(mechanic.id))).map((mechanic) => mechanic.name);
  return (
    <ProgressiveWorkorderSection
      id="assignment"
      title={t("assignment.title")}
      activeSection={activeSection}
      onSelect={onSelect}
      attention={!assignedIds.length}
      displayMode="panel"
      showTitle={!onePage}
    >
      {canWrite && onePage ? (
        <div className="office-assignment-control create-assignment-one-page-field">
          <span className="create-assignment-one-page-label">Mechanic</span>
          <details className="create-assignment-one-page-dropdown" ref={dropdownRef}
            onBlur={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) event.currentTarget.open = false;
            }}
            onKeyDown={(event) => {
              if (event.key === "Escape" && event.currentTarget.open) {
                event.preventDefault();
                event.stopPropagation();
                event.currentTarget.open = false;
                event.currentTarget.querySelector("summary")?.focus();
              }
            }}>
            <summary>{selectedNames.length ? selectedNames.join(", ") : t("assignment.unassigned")}</summary>
            <fieldset className="office-mechanic-team">
              <legend>{t("assignment.assignedMechanics")}</legend>
              {assignableMechanics.map((mechanic) => {
                const checked = assignment.mechanicUserIds.includes(mechanic.id);
                return <label key={mechanic.id}><Checkbox checked={checked} onChange={() => onAssignmentChange?.((current) => ({ ...current, mechanicUserIds: checked ? current.mechanicUserIds.filter((id) => id !== mechanic.id) : [...current.mechanicUserIds, mechanic.id] }))} /><span>{mechanic.name}</span></label>;
              })}
              {!assignableMechanics.length ? <p>{t("assignment.noneAtLocation")}</p> : null}
              <Field label={t("assignment.reason")}><NarrativeField locale={locale} singleLine value={assignment.reason} onChange={(event) => onAssignmentChange?.((current) => ({ ...current, reason: event.target.value }))} placeholder={t("assignment.reasonPlaceholder")} /></Field>
              <Button type="button" variant="secondary" disabled={busy || !assignmentChanged} onClick={onSave}>{t("assignment.updateTeam")}</Button>
            </fieldset>
          </details>
        </div>
      ) : canWrite ? (
        <div className="office-assignment-control">
          <fieldset className="office-mechanic-team">
            <legend>{t("assignment.assignedMechanics")}</legend>
            {assignableMechanics.map((mechanic) => {
              const checked = assignment.mechanicUserIds.includes(mechanic.id);
              return (
                <label key={mechanic.id}>
                  <Checkbox checked={checked} onChange={() => onAssignmentChange?.((current) => ({
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
      {!onePage || !canWrite ? <dl className="workorder-assigned-mechanics"><div><dt>{t("assignment.assignedMechanics")}</dt><dd>{mechanicNames || t("assignment.unassigned")}</dd></div></dl> : null}
    </ProgressiveWorkorderSection>
  );
}
