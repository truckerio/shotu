import { ArrowLeft, Plus } from "@untitledui/icons";
import { DraftLeaveDialog, DraftSaveStatus } from "../../components/drafts/index.js";
import { PreviewPane, PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { WorkorderDetailLayout } from "../../components/workorders/WorkorderDetailLayout.jsx";
import { BrowserPrintDocument, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { CREATE_WORKORDER_FORM_ID, CreateWorkorderForm } from "../generator/CreateWorkorderForm.jsx";
import { workorderTemplateStyles } from "../../../../shared/workorder-template.js";

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
  return (
    <main className="prototype">
      <style>{workorderTemplateStyles}</style>
      <BrowserPrintDocument payload={browserPrintPayload} />
      <WorkorderDetailLayout detail={false} previewOpen={showEmbeddedPreview}>
        <aside className="control-panel" ref={formRef}>
          <div className="detail-context-bar office-create-nav">
            <button
              type="button"
              onClick={openOfficeWorkspace}
              aria-label={actor.role === "admin" ? "Back to Operations" : "Back to Office"}
              title={actor.role === "admin" ? "Back to Operations" : "Back to Office"}
            >
              <ArrowLeft />
            </button>
            <div>
              <strong>Create workorder</strong>
              <DraftSaveStatus
                status={workorderDraft.status}
                error={workorderDraft.error}
                labels={{ dirty: "Draft changed" }}
                className="office-create-draft-status"
              />
            </div>
            <div className="detail-context-actions">
              <button
                className="detail-create-button"
                type="submit"
                form={CREATE_WORKORDER_FORM_ID}
                disabled={officeCreateState.busy}
              >
                <Plus />
                <span>{officeCreateState.busy ? "Creating..." : "Create"}</span>
              </button>
              <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" />
            </div>
          </div>

          <div className="mobile-jumpbar" aria-label="Phone shortcuts">
            <button type="button" onClick={() => formRef.current?.scrollIntoView({ behavior: "smooth", block: "start" })}>
              Form
            </button>
            <PreviewToggle open={showEmbeddedPreview || previewFullscreen} onToggle={jumpToPreview} controls="workorder-preview-panel" className="mobile-preview-pane-toggle" />
          </div>

          <CreateWorkorderForm
            assignment={assignment}
            busy={officeCreateState.busy}
            errors={officeCreateErrors}
            errorFocusKey={officeCreateAttempt}
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
            mapsConfig={mapsConfig}
            selectedVehicle={selectedVehicle}
            vehicleLookup={vehicleLookup}
          />
        </aside>

        <PreviewPane
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
        </PreviewPane>
      </WorkorderDetailLayout>

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
      <DraftLeaveDialog
        open={draftLeaveOpen}
        busy={draftLeaveBusy}
        status={workorderDraft.status}
        error={workorderDraft.error}
        onStay={() => setDraftLeaveOpen(false)}
        onDiscard={discardDraftAndLeave}
        onSaveAndLeave={saveDraftAndLeave}
      />
    </main>
  );
}
