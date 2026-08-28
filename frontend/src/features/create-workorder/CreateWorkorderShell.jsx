import { ArrowLeft, Plus } from "@untitledui/icons";
import { DraftSaveStatus } from "../../components/drafts/index.js";
import { KeyboardAwareDock } from "../../components/layout/KeyboardAwareDock.jsx";
import { PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
import { formatUiDateRange } from "../../lib/workorder-presentation.js";
import { interfaceText, localizedUnitType } from "../../i18n/index.js";
import { CREATE_WORKORDER_FORM_ID } from "../generator/CreateWorkorderForm.jsx";
import { resolveCreateLocation, selectedCreateMechanicNames } from "./create-workorder-utils.js";

function createSummaryValue(value, fallback = "") {
  const text = String(value || "").trim();
  return text || fallback;
}

function locationName(locations = [], locationId = "") {
  return resolveCreateLocation(locations, locationId)?.location?.name || "";
}

export function CreateWorkorderShell({
  activeSection,
  backLabel,
  canCreate = true,
  canSaveDraft,
  form,
  isPhone,
  keyboardOpen,
  locale = "en",
  locations,
  officeCreateState,
  onBack,
  onSelectSection,
  onTogglePreview,
  previewActive,
  previewVisible = true,
  sections,
  workorderDraft,
  assignment,
  children,
}) {
  const t = (key) => interfaceText(locale, key);
  const unit = createSummaryValue(form.unitNo, t("create.noUnitSelected"));
  const concern = createSummaryValue(form.mechanicConcern, t("create.title"));
  const dates = formatUiDateRange(form.workStartDate, form.workEndDate, { locale });

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
          <strong>{t("create.title")}</strong>
          {canSaveDraft ? (
            <DraftSaveStatus
              status={workorderDraft.status}
              error={workorderDraft.error}
              showPristine
              labels={{ dirty: t("create.draftChanged") }}
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
              disabled={officeCreateState.busy || !canCreate}
            >
              <Plus />
              <span>{officeCreateState.busy ? t("create.creating") : t("create.create")}</span>
            </button>
          ) : null}
          {!isPhone && previewVisible ? (
            <PreviewToggle
              open={previewActive}
              onToggle={onTogglePreview}
              controls="workorder-preview-panel"
              openLabel={t("create.openPreview")}
              closeLabel={t("create.closePreview")}
            />
          ) : null}
        </div>
      </div>

      <WorkorderObjectSummary
        concern={concern}
        customer={form.customerCompanyName}
        dates={dates}
        location={form.locationName || locationName(locations, form.locationId)}
        mechanics={selectedCreateMechanicNames(assignment)}
        unit={unit}
        unitType={localizedUnitType(form.unitType, locale) || t("unit.title")}
        locale={locale}
      />

      <WorkorderSectionNav
        className="create-workorder-section-nav"
        sections={sections}
        activeSection={activeSection}
        onSelect={onSelectSection}
        locale={locale}
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
              disabled={officeCreateState.busy || !canCreate}
            >
              <Plus aria-hidden="true" />
              <span>{officeCreateState.busy ? t("create.creating") : t("create.title")}</span>
            </button>
          </div>
          <div className="create-workorder-mobile-nav">
            <WorkorderSectionNav
              className="create-workorder-section-nav"
              sections={sections}
              activeSection={activeSection}
              onSelect={onSelectSection}
              locale={locale}
            />
          </div>
        </KeyboardAwareDock>
      ) : null}
    </>
  );
}
