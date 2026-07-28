import { useLayoutEffect, useMemo, useRef, useState } from "react";
import { ArrowLeft, Plus } from "@untitledui/icons";
import { DraftLeaveDialog, DraftSaveStatus } from "../../components/drafts/index.js";
import { KeyboardAwareDock } from "../../components/layout/KeyboardAwareDock.jsx";
import { PreviewPane, PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { WorkorderDetailLayout } from "../../components/workorders/WorkorderDetailLayout.jsx";
import { WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
import { BrowserPrintDocument, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { CREATE_WORKORDER_FORM_ID, CreateWorkorderForm } from "../generator/CreateWorkorderForm.jsx";
import { workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import { useFocusedFieldVisibility } from "../../hooks/useFocusedFieldVisibility.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import {
  buildCreateWorkorderSections,
  createSectionForErrors,
  isCreateErrorSectionReady,
} from "./create-workorder-sections.js";
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
  lastPhysicalPageIndex,
  lastSerial,
  mapsConfig,
  officeCreateAttempt,
  officeCreateErrors,
  officeCreateState,
  officeLocations,
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
  const canAssign = !isMechanicCreate;
  const backLabel = actor.role === "admin" ? "Back to Operations" : isMechanicCreate ? "Back to My Work" : "Back to Office";
  const [mobileSection, setMobileSection] = useState("work");
  const mobileScrollRef = useRef(null);
  const viewport = useVisualViewport();
  const keyboardOpen = Boolean(isPhone && viewport.keyboardOpen);
  const mobileSections = useMemo(
    () => buildCreateWorkorderSections({ canAssign }),
    [canAssign],
  );

  const ensureFocusedFieldVisible = useFocusedFieldVisibility({
    enabled: isPhone,
    containerRef: mobileScrollRef,
    keyboardOpen,
    margin: 12,
  });
  const errorSection = createSectionForErrors(officeCreateErrors);
  const errorFocusReady = !isPhone || isCreateErrorSectionReady({
    activeSection: mobileSection,
    errors: officeCreateErrors,
  });

  useLayoutEffect(() => {
    if (!isPhone || !officeCreateAttempt) return;
    if (!errorSection) return;
    dismissKeyboard();
    setMobileSection(errorSection);
    resetMobileScroll(errorSection);
  }, [errorSection, isPhone, officeCreateAttempt]);

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
    setMobileSection(section);
    resetMobileScroll(section);
  }

  return (
    <main
      className={`prototype create-workorder-page create-section-${mobileSection}${keyboardOpen ? " is-keyboard-open" : ""}`}
      data-keyboard-open={keyboardOpen ? "true" : "false"}
      style={{
        "--create-visual-viewport-height": viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
        "--create-visual-viewport-offset-top": `${viewport.viewportOffsetTop}px`,
        "--keyboard-inset": `${viewport.keyboardInset}px`,
      }}
    >
      <style>{workorderTemplateStyles}</style>
      <BrowserPrintDocument payload={browserPrintPayload} />
      <WorkorderDetailLayout detail={false} previewOpen={showEmbeddedPreview}>
        <aside className="control-panel" ref={formRef}>
          <div className="detail-context-bar office-create-nav">
            <button
              type="button"
              onClick={openOfficeWorkspace}
              aria-label={backLabel}
              title={backLabel}
            >
              <ArrowLeft />
            </button>
            <div>
              <strong>Create workorder</strong>
              {!isMechanicCreate ? (
                <DraftSaveStatus
                  status={workorderDraft.status}
                  error={workorderDraft.error}
                  labels={{ dirty: "Draft changed" }}
                  className="office-create-draft-status"
                />
              ) : null}
            </div>
            <div className="detail-context-actions">
              {!isPhone ? <button
                className="detail-create-button"
                type="submit"
                form={CREATE_WORKORDER_FORM_ID}
                disabled={officeCreateState.busy}
              >
                <Plus />
                <span>{officeCreateState.busy ? "Creating..." : "Create"}</span>
              </button> : null}
              {!isPhone ? (
                <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" />
              ) : null}
            </div>
          </div>

          <CreateWorkorderForm
            assignment={assignment}
            busy={officeCreateState.busy}
            errors={officeCreateErrors}
            errorFocusKey={officeCreateAttempt}
            errorFocusReady={errorFocusReady}
            form={form}
            locations={officeLocations}
            message={officeCreateState.message}
            onAddPart={addPartRow}
            onAssignmentChange={(mechanicUserIds) => setCreateAssignment((current) => ({ ...current, mechanicUserIds }))}
            onFieldChange={updateField}
            onLocationChange={selectOfficeLocation}
            onPartChange={updatePart}
            onRemovePart={removePartRow}
            onSubmit={createOfficeWorkorder}
            onUnitChange={updateUnitNumber}
            onVehicleSelect={applyVehicle}
            canAssign={canAssign}
            mapsConfig={mapsConfig}
            mobileSection={mobileSection}
            mobileScrollRef={mobileScrollRef}
            onErrorFocusTarget={ensureFocusedFieldVisible}
            selectedVehicle={selectedVehicle}
            vehicleLookup={vehicleLookup}
          />
          {isPhone && mobileSection === "preview" ? (
            <CompactWorkorderPreview
              panelRef={previewRef}
              countLabel={workorderCountLabel}
              range={range}
              printMenuOpen={printMenuOpen}
              onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
              primaryActionLabel={primaryActionLabel}
              onFullscreen={openFullscreenPreview}
            >
              <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""}`}>
                <WorkorderPreview label="First page" serial={firstSerial} form={form} />
                {effectiveCopies > 1 || lastPhysicalPageIndex > 0
                  ? <WorkorderPreview label="Last page" serial={lastSerial} form={form} pageIndex={lastPhysicalPageIndex} />
                  : null}
              </div>
            </CompactWorkorderPreview>
          ) : null}
        </aside>

        {!isPhone ? <PreviewPane
          id="workorder-preview-panel"
          open={showEmbeddedPreview}
          variant="full"
          panelRef={previewRef}
          countLabel={workorderCountLabel}
          range={range}
          printMenuOpen={printMenuOpen}
          onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
          primaryActionLabel={primaryActionLabel}
          onFullscreen={openFullscreenPreview}
        >
          <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""}`}>
            <WorkorderPreview label="First page" serial={firstSerial} form={form} />
            {effectiveCopies > 1 || lastPhysicalPageIndex > 0
              ? <WorkorderPreview label="Last page" serial={lastSerial} form={form} pageIndex={lastPhysicalPageIndex} />
              : null}
          </div>
        </PreviewPane> : null}
      </WorkorderDetailLayout>
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
              sections={mobileSections}
              activeSection={mobileSection}
              onSelect={selectMobileSection}
            />
          </div>
        </KeyboardAwareDock>
      ) : null}

      <PreviewFullscreen
        open={previewFullscreen}
        form={form}
        serials={previewSerials}
        pageIndex={fullscreenPageIndex}
        zoom={fullscreenZoom}
        range={range}
        countLabel={workorderCountLabel}
        actionLabel={primaryActionLabel}
        onClose={() => setPreviewFullscreen(false)}
        onPageChange={setFullscreenPageIndex}
        onZoomChange={setFullscreenZoom}
      />
      <PrintModal state={printState} range={range} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} />
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
