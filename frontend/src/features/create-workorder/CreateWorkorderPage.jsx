import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DraftLeaveDialog } from "../../components/drafts/index.js";
import { PreviewPane } from "../../components/preview/PreviewPane.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { BrowserPrintDocument, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { CreateWorkorderForm } from "../generator/CreateWorkorderForm.jsx";
import { workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import { useFocusedFieldVisibility } from "../../hooks/useFocusedFieldVisibility.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { interfaceText } from "../../i18n/index.js";
import { CreateWorkorderShell } from "./CreateWorkorderShell.jsx";
import {
  buildCreateWorkorderSections,
  createSectionForErrors,
  defaultCreateWorkorderSection,
  isCreateErrorSectionReady,
} from "./create-workorder-sections.js";
import { createWorkorderPreviewForm } from "./create-workorder-utils.js";
import {
  resolveWorkorderModulePolicy,
  WORKORDER_MODULE_IDS,
  WORKORDER_SURFACES,
} from "../workorder-modules/workorder-module-registry.js";
import "./create-workorder-page.css";

export function CreateWorkorderPage({
  actor,
  assignment,
  browserPrintPayload,
  effectiveCopies,
  firstSerial,
  form,
  formRef,
  fullscreenPageIndex,
  fullscreenZoom,
  isPhone,
  locale = "en",
  lastPhysicalPageIndex,
  lastSerial,
  locationPolicy,
  mapsConfig,
  officeCreateAttempt,
  officeCreateErrors,
  officeCreateState,
  officeLocations,
  officeLocationsState,
  previewFullscreen,
  previewGridRef,
  previewRef,
  previewSerials,
  printMenuOpen,
  printState,
  primaryActionLabel,
  range,
  selectedVehicle,
  showEmbeddedPreview,
  vehicleLookup,
  workorderCountLabel,
  workorderDraft,
  draftLeaveBusy,
  draftLeaveOpen,
  addPartRow,
  createOfficeWorkorder,
  discardDraftAndLeave,
  jumpToPreview,
  openOfficeWorkspace,
  openFullscreenPreview,
  reloadOfficeLocations,
  removePartRow,
  saveDraftAndLeave,
  setCreateAssignment,
  setDraftLeaveOpen,
  setFullscreenPageIndex,
  setFullscreenZoom,
  setPreviewFullscreen,
  setPrintMenuOpen,
  setPrintState,
  selectOfficeLocation,
  updateField,
  updatePart,
  updateUnitNumber,
  applyVehicle,
}) {
  const isMechanicCreate = actor.role === "mechanic";
  const t = (key) => interfaceText(locale, key);
  const assignmentPolicy = useMemo(() => resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.ASSIGNMENT,
    overrides: locationPolicy,
    role: actor.role,
    surface: WORKORDER_SURFACES.CREATE,
    userId: actor.id,
  }), [actor.id, actor.role, locationPolicy]);
  const canAssign = assignmentPolicy.canWrite;
  const backLabel = actor.role === "admin"
    ? t("create.backOperations")
    : actor.role === "surveillance"
      ? t("create.backSurveillance")
      : isMechanicCreate
        ? t("create.backMyWork")
        : t("create.backOffice");
  const [activeSection, setActiveSection] = useState(() => defaultCreateWorkorderSection(actor.role));
  const mobileScrollRef = useRef(null);
  const viewport = useVisualViewport();
  const keyboardOpen = viewport.keyboardOpen;
  const createSections = useMemo(
    () => buildCreateWorkorderSections({
      canAssign,
      includePreview: isPhone,
      policyOverrides: locationPolicy,
      role: actor.role,
      userId: actor.id,
    }).map((section) => ({
      ...section,
      label: interfaceText(locale, `create.section.${section.id}`),
    })),
    [actor.id, actor.role, canAssign, isPhone, locale, locationPolicy],
  );
  const previewPolicy = useMemo(() => resolveWorkorderModulePolicy({
    moduleId: WORKORDER_MODULE_IDS.PREVIEW,
    overrides: locationPolicy,
    role: actor.role,
    surface: WORKORDER_SURFACES.CREATE,
    userId: actor.id,
  }), [actor.id, actor.role, locationPolicy]);
  const canCreate = createSections.some((section) => section.id !== WORKORDER_MODULE_IDS.PREVIEW && section.modulePolicy?.canWrite);
  const previewForm = useMemo(
    () => createWorkorderPreviewForm(form, assignment),
    [assignment, form],
  );

  const ensureFocusedFieldVisible = useFocusedFieldVisibility({
    enabled: true,
    containerRef: mobileScrollRef,
    keyboardOpen,
    margin: 12,
  });
  const errorSection = createSectionForErrors(officeCreateErrors);
  const errorFocusReady = !isPhone || isCreateErrorSectionReady({
    activeSection,
    errors: officeCreateErrors,
  });
  const createStatusMessage = isMechanicCreate && officeCreateState.message
    ? officeCreateState.busy
      ? t("create.creatingWorkorder")
      : officeCreateState.error
        ? Object.keys(officeCreateErrors).some((key) => officeCreateErrors[key])
          ? t("create.fixHighlightedFields")
          : t("create.failed")
        : t("create.createdAssigned")
    : officeCreateState.message;

  useLayoutEffect(() => {
    if (!isPhone || !officeCreateAttempt) return;
    if (!errorSection) return;
    dismissKeyboard();
    setActiveSection(errorSection);
    resetMobileScroll(errorSection);
  }, [errorSection, isPhone, officeCreateAttempt]);

  useEffect(() => {
    if (createSections.some((section) => section.id === activeSection)) return;
    setActiveSection(createSections[0]?.id || "location");
  }, [activeSection, createSections]);

  function dismissKeyboard() {
    const activeElement = document.activeElement;
    if (typeof activeElement?.blur === "function") activeElement.blur();
  }

  function resetMobileScroll(section) {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      if (section === "preview") {
        previewRef.current?.querySelector?.(".preview-pane-content")?.scrollTo?.({ top: 0, left: 0 });
        return;
      }
      mobileScrollRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }

  function selectMobileSection(section) {
    dismissKeyboard();
    if (section === "preview" && !showEmbeddedPreview) jumpToPreview();
    setActiveSection(section);
    resetMobileScroll(section);
  }

  return (
    <main
      className={`prototype workorder-detail-page create-workorder-page create-section-${activeSection}${keyboardOpen ? " is-keyboard-open" : ""}`}
      data-detail-section={activeSection}
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      style={{
        "--create-visual-viewport-height": viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
        "--create-visual-viewport-offset-top": `${viewport.viewportOffsetTop}px`,
        "--workorder-visual-viewport-height": viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
        "--workorder-visual-viewport-offset-top": `${viewport.viewportOffsetTop}px`,
        "--keyboard-inset": `${viewport.keyboardInset}px`,
      }}
    >
      <style>{workorderTemplateStyles}</style>
      {previewPolicy.canRead ? <BrowserPrintDocument payload={browserPrintPayload} /> : null}
      <CreateWorkorderShell
            activeSection={activeSection}
            assignment={assignment}
            backLabel={backLabel}
            canCreate={canCreate}
            canSaveDraft={["admin", "office"].includes(actor.role)}
            controlRef={formRef}
            form={form}
            isPhone={isPhone}
            keyboardOpen={keyboardOpen}
            locale={locale}
            locations={officeLocations}
            officeCreateState={officeCreateState}
            onBack={openOfficeWorkspace}
            onSelectSection={selectMobileSection}
            onTogglePreview={jumpToPreview}
            previewOpen={previewPolicy.canRead && showEmbeddedPreview}
            previewActive={showEmbeddedPreview || previewFullscreen}
            previewVisible={previewPolicy.canRead}
            sectionPreferenceKey={`workorder.sectionOrder.v1:${actor.id}:${actor.role}:create`}
            sections={createSections}
            workorderDraft={workorderDraft}
            supportingPane={!isPhone && previewPolicy.canRead ? <PreviewPane
              id="workorder-preview-panel"
              open={showEmbeddedPreview}
              variant="full"
              panelRef={previewRef}
              countLabel={workorderCountLabel}
              range={range}
              printMenuOpen={printMenuOpen}
              onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
              locale={locale}
              primaryActionLabel={primaryActionLabel}
              onFullscreen={openFullscreenPreview}
            >
              <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""}`}>
                <WorkorderPreview label={t("preview.firstPage")} serial={firstSerial} form={previewForm} />
                {effectiveCopies > 1 || lastPhysicalPageIndex > 0
                  ? <WorkorderPreview label={t("preview.lastPage")} serial={lastSerial} form={previewForm} pageIndex={lastPhysicalPageIndex} />
                  : null}
              </div>
            </PreviewPane> : null}
          >
            {!createSections.length ? (
              <div className="mechanic-empty-state" role="status">
                <strong>{t("create.unavailable")}</strong>
                <span>{t("create.noWritableModules")}</span>
              </div>
            ) : null}
            <CreateWorkorderForm
              assignment={assignment}
              busy={officeCreateState.busy}
              locale={isMechanicCreate ? locale : "en"}
              error={officeCreateState.error}
              errors={officeCreateErrors}
              errorFocusKey={officeCreateAttempt}
              errorFocusReady={errorFocusReady}
              form={form}
              locationLoadState={officeLocationsState}
              locations={officeLocations}
              message={createStatusMessage}
              onAddPart={addPartRow}
              onAssignmentChange={(mechanicUserIds) => setCreateAssignment((current) => ({ ...current, mechanicUserIds }))}
              onFieldChange={updateField}
              onLocationChange={selectOfficeLocation}
              onReloadLocations={reloadOfficeLocations}
              onPartChange={updatePart}
              onRemovePart={removePartRow}
              onSubmit={createOfficeWorkorder}
              onUnitChange={updateUnitNumber}
              onVehicleSelect={applyVehicle}
              canAssign={canAssign}
              mapsConfig={mapsConfig}
              mobileSection={activeSection}
              mobileScrollRef={mobileScrollRef}
              onErrorFocusTarget={ensureFocusedFieldVisible}
              selectedVehicle={selectedVehicle}
              sections={createSections.filter((section) => section.id !== WORKORDER_MODULE_IDS.PREVIEW)}
              vehicleLookup={vehicleLookup}
            />
          {isPhone && activeSection === "preview" && previewPolicy.canRead ? (
            <CompactWorkorderPreview
              panelRef={previewRef}
              countLabel={workorderCountLabel}
              range={range}
              printMenuOpen={printMenuOpen}
              onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
              locale={locale}
              primaryActionLabel={primaryActionLabel}
              onFullscreen={openFullscreenPreview}
            >
              <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""}`}>
                <WorkorderPreview label={t("preview.firstPage")} serial={firstSerial} form={previewForm} />
                {effectiveCopies > 1 || lastPhysicalPageIndex > 0
                  ? <WorkorderPreview label={t("preview.lastPage")} serial={lastSerial} form={previewForm} pageIndex={lastPhysicalPageIndex} />
                  : null}
              </div>
            </CompactWorkorderPreview>
          ) : null}
      </CreateWorkorderShell>

      {previewPolicy.canRead ? <PreviewFullscreen
        open={previewFullscreen}
        form={previewForm}
        serials={previewSerials}
        pageIndex={fullscreenPageIndex}
        zoom={fullscreenZoom}
        range={range}
        countLabel={workorderCountLabel}
        actionLabel={primaryActionLabel}
        onClose={() => setPreviewFullscreen(false)}
        onPageChange={setFullscreenPageIndex}
        onZoomChange={setFullscreenZoom}
        locale={locale}
      /> : null}
      {previewPolicy.canRead ? <PrintModal state={printState} range={range} locale={locale} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} /> : null}
      {!isMechanicCreate ? (
        <DraftLeaveDialog
          open={draftLeaveOpen}
          busy={draftLeaveBusy}
          status={workorderDraft.status}
          error={workorderDraft.error}
          onStay={() => setDraftLeaveOpen(false)}
          onDiscard={discardDraftAndLeave}
          onSaveAndLeave={saveDraftAndLeave}
        />
      ) : null}
    </main>
  );
}
