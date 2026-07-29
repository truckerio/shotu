import { ArrowLeft, Plus } from "@untitledui/icons";
import { DraftSaveStatus } from "../../components/drafts/index.js";
import { KeyboardAwareDock } from "../../components/layout/KeyboardAwareDock.jsx";
import { PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
import { workDateRangeLabel } from "../../../../shared/workorder-template.js";
import { CREATE_WORKORDER_FORM_ID } from "../generator/CreateWorkorderForm.jsx";
import { resolveCreateLocation } from "./create-workorder-utils.js";

function createSummaryValue(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function locationName(locations = [], locationId = "") {
  return resolveCreateLocation(locations, locationId)?.location?.name || "";
}

function mechanicNames(assignment = {}) {
  const selected = new Set(assignment.mechanicUserIds || []);
  if (!selected.size) return "";
  return (assignment.mechanics || [])
    .filter((mechanic) => selected.has(mechanic.id))
    .map((mechanic) => mechanic.displayName || mechanic.display_name || mechanic.name || mechanic.username)
    .filter(Boolean)
    .join(", ");
}

export function CreateWorkorderShell({
  activeSection,
  backLabel,
  canSaveDraft,
  form,
  isPhone,
  keyboardOpen,
  locations,
  officeCreateState,
  onBack,
  onSelectSection,
  onTogglePreview,
  previewActive,
  sections,
  workorderDraft,
  assignment,
  children,
}) {
  const unit = createSummaryValue(form.unitNo, "No unit selected");
  const concern = createSummaryValue(form.mechanicConcern, "Create workorder");
  const dates = workDateRangeLabel(form);

  return (
    <>
      <div className="detail-context-bar office-create-nav">
        <button
          type="button"
          onClick={onBack}
          aria-label={backLabel}
          title={backLabel}
        >
          <ArrowLeft />
        </button>
        <div>
          <strong>Create workorder</strong>
          {canSaveDraft ? (
            <DraftSaveStatus
              status={workorderDraft.status}
              error={workorderDraft.error}
              showPristine
              labels={{ dirty: "Draft changed" }}
              className="office-create-draft-status"
            />
          ) : null}
        </div>
        <div className="detail-context-actions">
          {!isPhone ? (
            <button
              className="detail-create-button"
              type="submit"
              form={CREATE_WORKORDER_FORM_ID}
              disabled={officeCreateState.busy}
            >
              <Plus />
              <span>{officeCreateState.busy ? "Creating..." : "Create"}</span>
            </button>
          ) : null}
          {!isPhone ? (
            <PreviewToggle
              open={previewActive}
              onToggle={onTogglePreview}
              controls="workorder-preview-panel"
            />
          ) : null}
        </div>
      </div>

      <WorkorderObjectSummary
        concern={concern}
        customer={form.customerCompanyName}
        dates={dates}
        location={form.locationName || locationName(locations, form.locationId)}
        mechanics={mechanicNames(assignment)}
        unit={unit}
        unitType={form.unitType || "Unit"}
      />

      <WorkorderSectionNav
        sections={sections}
        activeSection={activeSection}
        onSelect={onSelectSection}
      />

      {children}

      {isPhone ? (
        <KeyboardAwareDock
          className="create-workorder-mobile-dock"
          keyboardOpen={keyboardOpen}
          mode="hide"
        >
          <div className="create-workorder-mobile-action">
            <button
              type="submit"
              form={CREATE_WORKORDER_FORM_ID}
              disabled={officeCreateState.busy}
            >
              <Plus aria-hidden="true" />
              <span>{officeCreateState.busy ? "Creating..." : "Create workorder"}</span>
            </button>
          </div>
          <div className="create-workorder-mobile-nav">
            <WorkorderSectionNav
              sections={sections}
              activeSection={activeSection}
              onSelect={onSelectSection}
            />
          </div>
        </KeyboardAwareDock>
      ) : null}
    </>
  );
}
