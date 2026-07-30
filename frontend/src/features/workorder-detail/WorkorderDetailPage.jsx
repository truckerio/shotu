import { useMemo } from "react";
import { ArrowLeft, CheckCircle, Save01, XClose } from "@untitledui/icons";
import { OperationalCheckboxGroup } from "../../components/forms/OperationalCheckboxGroup.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PreviewPane, PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { ChatComposer } from "../../components/workorders/ChatComposer.jsx";
import { ChatThread } from "../../components/workorders/ChatThread.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { WorkorderDetailLayout } from "../../components/workorders/WorkorderDetailLayout.jsx";
import { WorkorderObjectSummary, WorkorderSectionNav } from "../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderStatusPill } from "../../components/workorders/WorkorderStatusPill.jsx";
import { useChatReceipts } from "../../components/workorders/chat/useChatReceipts.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { BrowserPrintDocument, Field, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { workDateRangeLabel, workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import { WorkorderDetailSections } from "./WorkorderDetailSections.jsx";
import { textEntryProps } from "../../components/forms/text-entry-policy.js";
import { NarrativeField } from "../../components/forms/NarrativeField.jsx";
import {
  buildCompactPhoneDetailSections,
  workorderNeedsChatAttention,
  workorderPreviewState,
} from "./workorder-detail-sections.js";
import { RETURN_CATEGORIES } from "./workorder-handoff.js";

export function WorkorderDetailPage({
  activeWorkorder,
  actor,
  assignedMechanicIds,
  browserPrintPayload,
  canPrint,
  conversationMessages,
  currentStatusLabel,
  detailMechanicNames,
  detailLocationName,
  detailSection,
  detailSections,
  detailStatus,
  effectiveCopies,
  expectedMechanicName,
  filledPartCount,
  firstSerial,
  form,
  formRef,
  fullscreenPageIndex,
  fullscreenZoom,
  isCompact,
  isMechanicDetail,
  isOfficeDetail,
  isPhone,
  lastPhysicalPageIndex,
  lastSerial,
  mapsConfig,
  mechanicAction,
  mechanicAsset,
  mechanicFinish,
  mechanicFinishNameMatches,
  mechanicMapLocation,
  mechanicMapVehicle,
  mechanicProgress,
  mechanicUnitType,
  mechanicVehicleLabel,
  officeAssignment,
  officeAssignmentChanged,
  officeCloseNote,
  officeCloseOpen,
  officeReturn,
  officeCancel,
  officeDetailState,
  officeLocations,
  pendingPartCount,
  previewFullscreen,
  previewGridRef,
  previewPanelOpen,
  previewRef,
  previewSerials,
  printMenuOpen,
  printState,
  primaryActionLabel,
  range,
  selectedVehicle,
  showEmbeddedPreview,
  supportingView,
  vehicleLookup,
  visibleTimeline,
  workorderCountLabel,
  applyVehicle,
  acceptOpenedMechanicWorkorder,
  closeOfficeWorkorder,
  cancelOfficeWorkorder,
  jumpToPreview,
  openFullscreenPreview,
  printWorkorders,
  openOfficeCancel,
  openOfficeReturn,
  reloadActiveWorkorder,
  returnToRoleWorkspace,
  saveActiveUsedParts,
  saveMechanicWorkNotes,
  saveOfficeWorkorder,
  selectDetailSection,
  selectOfficeLocation,
  sendWorkorderChat,
  setDetailSection,
  setFullscreenPageIndex,
  setFullscreenZoom,
  setMechanicFinish,
  setOfficeAssignment,
  setOfficeCloseNote,
  setOfficeCloseOpen,
  setOfficeReturn,
  setOfficeCancel,
  setOfficeDetailState,
  setPreviewFullscreen,
  setPrintMenuOpen,
  setPrintState,
  setSupportingView,
  submitMechanicFinish,
  returnOfficeWorkorder,
  toggleWorkorderTools,
  updateActiveUsedParts,
  updateField,
  updateOfficeMechanicTeam,
  updateStartDate,
  updateUnitNumber,
  vehicleMileage,
  vehicleModelText,
}) {
  const viewport = useVisualViewport();
  const visibleDetailSections = useMemo(
    () => (isPhone
      ? buildCompactPhoneDetailSections(detailSections, isMechanicDetail ? "mechanic" : "office")
      : detailSections),
    [detailSections, isMechanicDetail, isPhone],
  );
  const compactPreviewState = workorderPreviewState(activeWorkorder, form);
  useChatReceipts({
    active: detailSection === "chat" || (!isCompact && supportingView === "chat"),
    currentUserId: actor.id,
    messages: conversationMessages,
    role: isOfficeDetail ? "office" : "mechanic",
    workorderId: activeWorkorder.workorder.id,
  });
  const workorderChatContent = (
    <div id={isMechanicDetail ? "mechanic-chat-section" : undefined} className="chat-content">
      <ChatThread
        messages={conversationMessages}
        currentRole={isOfficeDetail ? "office" : "mechanic"}
        currentUserId={actor.id}
        keyboardOpen={viewport.keyboardOpen}
        viewportHeight={viewport.viewportHeight}
      />
      <ChatComposer
        onSend={sendWorkorderChat}
        disabled={isMechanicDetail && !activeWorkorder.allowedActions.sendMessage}
        sending={mechanicAction.busy === "chat"}
        placeholder="Message..."
        textareaLabel="Chat message"
        cameraLabel={isOfficeDetail ? "Take or add photo" : "Take photo"}
        sendLabel="Send"
        compact={isMechanicDetail}
      />
      {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
    </div>
  );

  return (
    <main
      className={`prototype workorder-detail-page ${isMechanicDetail ? "mechanic-detail-page" : ""} ${viewport.keyboardOpen ? "is-keyboard-open" : ""}`.trim()}
      data-keyboard-open={viewport.keyboardOpen ? "true" : "false"}
      data-detail-section={detailSection}
      style={{
        "--workorder-visual-viewport-height": viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
        "--workorder-visual-viewport-offset-top": `${viewport.viewportOffsetTop}px`,
      }}
    >
      <style>{workorderTemplateStyles}</style>
      <BrowserPrintDocument payload={browserPrintPayload} />
      <WorkorderDetailLayout detail previewOpen={!isPhone && showEmbeddedPreview}>
        <aside className="control-panel" ref={formRef}>
          <div className="detail-context-bar">
            <button
              type="button"
              onClick={returnToRoleWorkspace}
              aria-label={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
              title={actor.role === "admin" ? "Back to Operations" : isOfficeDetail ? "Back to Office" : "Back to My Work"}
            >
              <ArrowLeft />
            </button>
            <div>
              <strong>{activeWorkorder.workorder.asset?.unitNo || activeWorkorder.workorder.asset?.name || "Workorder"}</strong>
              <span>{activeWorkorder.workorder.serial}</span>
            </div>
            <div className="detail-context-actions">
              <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />
              {isOfficeDetail && activeWorkorder.allowedActions?.update ? (
                <button
                  className="detail-save-button"
                  type="button"
                  onClick={saveOfficeWorkorder}
                  disabled={officeDetailState.busy}
                  aria-label={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                  title={officeDetailState.busy ? "Saving workorder" : "Save workorder"}
                >
                  <Save01 />
                </button>
              ) : null}
              {isOfficeDetail && activeWorkorder.allowedActions?.approve ? (
                <button
                  className="detail-close-workorder-button"
                  type="button"
                  onClick={() => {
                    setOfficeDetailState((current) => ({ ...current, message: "" }));
                    setOfficeCloseOpen(true);
                  }}
                  disabled={officeDetailState.busy}
                  aria-label="Approve workorder"
                  title="Approve workorder"
                >
                  <CheckCircle />
                  <span>Approve</span>
                </button>
              ) : null}
              {isMechanicDetail && activeWorkorder.allowedActions?.accept ? (
                <button
                  className="detail-close-workorder-button"
                  type="button"
                  onClick={acceptOpenedMechanicWorkorder}
                  disabled={Boolean(mechanicAction.busy)}
                  aria-label="Accept work and start this job"
                >
                  <CheckCircle />
                  <span>{mechanicAction.busy === "accept" ? "Accepting..." : "Accept work"}</span>
                </button>
              ) : null}
              {!isPhone ? (
                <PreviewToggle
                  open={showEmbeddedPreview || previewFullscreen}
                  onToggle={toggleWorkorderTools}
                  controls="workorder-preview-panel"
                  openLabel="Open workorder tools"
                  closeLabel="Close workorder tools"
                />
              ) : null}
            </div>
          </div>

          <WorkorderObjectSummary
            concern={form.mechanicConcern}
            customer={form.customerCompanyName}
            dates={workDateRangeLabel(form)}
            location={detailLocationName}
            mechanics={detailMechanicNames}
            unit={form.unitNo || mechanicAsset.unitNo || mechanicAsset.name}
            unitType={form.unitType || mechanicAsset.unitType || "Unit"}
            actions={isMechanicDetail && !isCompact ? (
              <button
                className="finish-work-button"
                type="button"
                onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                disabled={!activeWorkorder?.allowedActions.markDone || Boolean(mechanicAction.busy)}
              >
                <CheckCircle />
                <span>{mechanicAction.busy === "done" ? "Submitting" : "Work done"}</span>
              </button>
            ) : null}
          >
            {isMechanicDetail ? (
              <div className="workorder-object-inline-detail">
                <span>{mechanicUnitType} details</span>
                <strong>{mechanicVehicleLabel}</strong>
                <span>Mileage</span>
                <strong>{form.mileage ? `${form.mileage} mi` : "Not listed"}</strong>
              </div>
            ) : null}
            {mechanicAction.message ? <p className="mechanic-action-message" role="status">{mechanicAction.message}</p> : null}
          </WorkorderObjectSummary>
          <WorkorderSectionNav sections={visibleDetailSections} activeSection={detailSection} onSelect={selectDetailSection} />
          {isMechanicDetail && isCompact && detailSection === "work" ? (
            <div className="mechanic-compact-primary-action">
              <button
                className="finish-work-button"
                type="button"
                onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                disabled={!activeWorkorder?.allowedActions.markDone || Boolean(mechanicAction.busy)}
              >
                <CheckCircle />
                <span>{mechanicAction.busy === "done" ? "Submitting" : "Work done"}</span>
              </button>
            </div>
          ) : null}

          <WorkorderDetailSections
            activeWorkorder={activeWorkorder}
            actorId={actor.id}
            assignedMechanicIds={assignedMechanicIds}
            conversationMessages={conversationMessages}
            detailMechanicNames={detailMechanicNames}
            detailSection={detailSection}
            detailStatus={detailStatus}
            filledPartCount={filledPartCount}
            form={form}
            isCompact={isCompact}
            isMechanicDetail={isMechanicDetail}
            isOfficeDetail={isOfficeDetail}
            mapsConfig={mapsConfig}
            mechanicAction={mechanicAction}
            mechanicMapLocation={mechanicMapLocation}
            mechanicMapVehicle={mechanicMapVehicle}
            mechanicProgress={mechanicProgress}
            mechanicUnitType={mechanicUnitType}
            mechanicVehicleLabel={mechanicVehicleLabel}
            officeAssignment={officeAssignment}
            officeAssignmentChanged={officeAssignmentChanged}
            officeDetailState={officeDetailState}
            officeLocations={officeLocations}
            pendingPartCount={pendingPartCount}
            selectedVehicle={selectedVehicle}
            vehicleLookup={vehicleLookup}
            visibleTimeline={visibleTimeline}
            workorderChatContent={workorderChatContent}
            applyVehicle={applyVehicle}
            reloadActiveWorkorder={reloadActiveWorkorder}
            saveActiveUsedParts={saveActiveUsedParts}
            saveMechanicWorkNotes={saveMechanicWorkNotes}
            saveOfficeWorkorder={saveOfficeWorkorder}
            openOfficeCancel={openOfficeCancel}
            openOfficeReturn={openOfficeReturn}
            selectOfficeLocation={selectOfficeLocation}
            setDetailSection={selectDetailSection}
            setOfficeAssignment={setOfficeAssignment}
            updateActiveUsedParts={updateActiveUsedParts}
            updateField={updateField}
            updateOfficeMechanicTeam={updateOfficeMechanicTeam}
            updateStartDate={updateStartDate}
            updateUnitNumber={updateUnitNumber}
            vehicleMileage={vehicleMileage}
            vehicleModelText={vehicleModelText}
          />
          {isPhone && detailSection === "preview" ? (
            <CompactWorkorderPreview
              panelRef={previewRef}
              status={<WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />}
              countLabel={workorderCountLabel}
              range={range}
              printMenuOpen={printMenuOpen}
              onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
              onPrint={canPrint ? () => {
                setPrintMenuOpen(false);
                printWorkorders();
              } : undefined}
              primaryActionLabel={primaryActionLabel}
              onFullscreen={openFullscreenPreview}
              previewState={compactPreviewState}
            >
              <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} mechanic-preview-grid`}>
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
          variant="dock"
          panelRef={previewRef}
          status={<WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />}
          countLabel={workorderCountLabel}
          range={range}
          printMenuOpen={printMenuOpen}
          onTogglePrintMenu={() => setPrintMenuOpen((open) => !open)}
          onPrint={canPrint ? () => {
            setPrintMenuOpen(false);
            printWorkorders();
          } : undefined}
          primaryActionLabel={primaryActionLabel}
          onFullscreen={openFullscreenPreview}
          onOpenPreview={openFullscreenPreview}
          supportingContent={!isCompact ? workorderChatContent : undefined}
          supportingLabel={isOfficeDetail ? "Chat with mechanic" : "Chat with office"}
          supportingCount={conversationMessages.length || undefined}
          supportingAttention={workorderNeedsChatAttention(detailStatus)}
          activeView={supportingView}
          onViewChange={setSupportingView}
        >
          <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} mechanic-preview-grid`}>
            <WorkorderPreview label="First page" serial={firstSerial} form={form} />
            {effectiveCopies > 1 || lastPhysicalPageIndex > 0
              ? <WorkorderPreview label="Last page" serial={lastSerial} form={form} pageIndex={lastPhysicalPageIndex} />
              : null}
          </div>
        </PreviewPane> : null}
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
        onPrint={canPrint ? () => {
          setPreviewFullscreen(false);
          printWorkorders();
        } : undefined}
      />
      <PrintModal state={printState} range={range} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} />

      {mechanicFinish.open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mechanicAction.busy) {
              setMechanicFinish({ open: false, name: "", message: "" });
            }
          }}
        >
          <form className="mechanic-completion-modal" role="dialog" aria-modal="true" aria-label="Mark work as done" onSubmit={submitMechanicFinish}>
            <button
              className="close-button"
              type="button"
              onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
              disabled={Boolean(mechanicAction.busy)}
              aria-label="Cancel marking work as done"
            >
              <XClose />
            </button>
            <h2>Mark work as done?</h2>
            <p>This sends the workorder to office for review. Write your name to confirm.</p>
            <Field label={`Write "${expectedMechanicName}"`}>
              <input
                {...textEntryProps("name")}
                type="text"
                value={mechanicFinish.name}
                onChange={(event) => setMechanicFinish({ open: true, name: event.target.value, message: "" })}
                placeholder={expectedMechanicName}
                autoComplete="off"
                autoFocus
              />
            </Field>
            {mechanicFinish.message ? <p className="mechanic-completion-message" role="alert">{mechanicFinish.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
                disabled={Boolean(mechanicAction.busy)}
              >
                Cancel
              </Button>
              <Button variant="primary" type="submit" disabled={!mechanicFinishNameMatches || Boolean(mechanicAction.busy)}>
                {mechanicAction.busy === "done" ? "Submitting..." : "Confirm work done"}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {officeCloseOpen ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setOfficeCloseOpen(false)}>
          <form className="office-close-modal" role="dialog" aria-modal="true" aria-label="Approve workorder" onSubmit={closeOfficeWorkorder}>
            <button className="close-button" type="button" onClick={() => setOfficeCloseOpen(false)} aria-label="Close review"><XClose /></button>
            <h2>Approve workorder?</h2>
            <p className="office-close-modal-copy">This sends the completed workorder to the surveillance team's Odoo queue.</p>
            <Field label="Approval note (optional)">
              <NarrativeField rows="3" value={officeCloseNote} onChange={(event) => setOfficeCloseNote(event.target.value)} placeholder="Add an approval note" />
            </Field>
            {officeDetailState.message ? <p className="mechanic-completion-message" role="status">{officeDetailState.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button variant="secondary" type="button" onClick={() => setOfficeCloseOpen(false)}>Cancel</Button>
              <Button variant="primary" type="submit" disabled={officeDetailState.busy}>{officeDetailState.busy ? "Approving..." : "Approve workorder"}</Button>
            </div>
          </form>
        </div>
      ) : null}

      {officeReturn.open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !officeDetailState.busy && setOfficeReturn({ open: false, reason: "", categories: [], message: "" })}>
          <form className="office-handoff-modal" role="dialog" aria-modal="true" aria-label="Return workorder to mechanic" onSubmit={returnOfficeWorkorder}>
            <button className="close-button" type="button" onClick={() => setOfficeReturn({ open: false, reason: "", categories: [], message: "" })} disabled={officeDetailState.busy} aria-label="Close return dialog"><XClose /></button>
            <h2>Return to mechanic?</h2>
            <p>Explain what needs correction. The workorder will return to active work and the mechanic will see this request.</p>
            <Field label="Reason">
              <NarrativeField rows="4" required minLength="2" maxLength="1000" value={officeReturn.reason} onChange={(event) => setOfficeReturn((current) => ({ ...current, reason: event.target.value, message: "" }))} autoFocus />
            </Field>
            <OperationalCheckboxGroup
              legend="What needs attention? (optional)"
              options={RETURN_CATEGORIES}
              selectedValues={officeReturn.categories}
              onChange={(categories) => setOfficeReturn((current) => ({
                ...current,
                categories,
                message: "",
              }))}
            />
            {officeReturn.message ? <p className="mechanic-completion-message" role="alert">{officeReturn.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button type="button" onClick={() => setOfficeReturn({ open: false, reason: "", categories: [], message: "" })} disabled={officeDetailState.busy}>Keep in review</Button>
              <Button variant="primary" type="submit" disabled={officeDetailState.busy || officeReturn.reason.trim().length < 2}>{officeDetailState.busy ? "Returning..." : "Return to mechanic"}</Button>
            </div>
          </form>
        </div>
      ) : null}

      {officeCancel.open ? (
        <div className="modal-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && !officeDetailState.busy && setOfficeCancel({ open: false, reason: "", message: "" })}>
          <form className="office-handoff-modal" role="dialog" aria-modal="true" aria-label="Cancel workorder" onSubmit={cancelOfficeWorkorder}>
            <button className="close-button" type="button" onClick={() => setOfficeCancel({ open: false, reason: "", message: "" })} disabled={officeDetailState.busy} aria-label="Close cancellation dialog"><XClose /></button>
            <h2>Cancel workorder?</h2>
            <p><strong>{activeWorkorder.workorder.serial}</strong> will leave active queues. Assignments and outstanding part commitments will be released. This action remains in Activity.</p>
            <Field label="Cancellation reason">
              <NarrativeField rows="4" required minLength="2" maxLength="1000" value={officeCancel.reason} onChange={(event) => setOfficeCancel({ open: true, reason: event.target.value, message: "" })} autoFocus />
            </Field>
            {officeCancel.message ? <p className="mechanic-completion-message" role="alert">{officeCancel.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button type="button" onClick={() => setOfficeCancel({ open: false, reason: "", message: "" })} disabled={officeDetailState.busy}>Keep workorder</Button>
              <Button variant="danger" type="submit" disabled={officeDetailState.busy || officeCancel.reason.trim().length < 2}>{officeDetailState.busy ? "Cancelling..." : "Cancel workorder"}</Button>
            </div>
          </form>
        </div>
      ) : null}
    </main>
  );
}
