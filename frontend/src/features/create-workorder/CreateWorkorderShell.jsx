import { Plus } from "@untitledui/icons";
import { DraftSaveStatus } from "../../components/drafts/index.js";
import { KeyboardAwareDock } from "../../components/layout/KeyboardAwareDock.jsx";
import { PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { WorkorderPanelShell } from "../../components/workorders/WorkorderPanelShell.jsx";
import { WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
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
  sectionPreferenceKey = "",
  sections,
  workorderDraft,
  assignment,
  children,
  controlRef,
  previewOpen,
  supportingPane,
}) {
  const t = (key) => interfaceText(locale, key);
  const unit = createSummaryValue(form.unitNo, t("create.noUnitSelected"));
  const concern = createSummaryValue(form.mechanicConcern, t("create.title"));
  const dates = formatUiDateRange(form.workStartDate, form.workEndDate, { locale });

  return (
    <WorkorderPanelShell
      controlRef={controlRef}
      context={{
        className: "office-create-nav",
        back: { label: backLabel, onClick: onBack },
        content: (
          <>
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
          </>
        ),
        actions: (
          <>
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
          </>
        ),
      }}
      footer={isPhone ? (
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
              preferenceKey={sectionPreferenceKey}
            />
          </div>
        </KeyboardAwareDock>
      ) : null}
      locale={locale}
      previewOpen={previewOpen}
      sectionClassName="create-workorder-section-nav"
      sections={{ items: sections, activeId: activeSection, onSelect: onSelectSection, preferenceKey: sectionPreferenceKey }}
      summary={{
        concern,
        customer: form.customerCompanyName,
        dates,
        location: form.locationName || locationName(locations, form.locationId),
        mechanics: selectedCreateMechanicNames(assignment),
        unit,
        unitType: localizedUnitType(form.unitType, locale) || t("unit.title"),
      }}
      supportingPane={supportingPane}
    >
      {children}
    </WorkorderPanelShell>
  );
}
