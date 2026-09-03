import { useCallback, useEffect, useMemo, useRef } from "react";
import { AlertCircle, CheckCircle, Save01, XClose } from "@untitledui/icons";
import { OperationalCheckboxGroup } from "../../components/forms/OperationalCheckboxGroup.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { PreviewPane, PreviewToggle } from "../../components/preview/PreviewPane.jsx";
import { ChatComposer } from "../../components/workorders/ChatComposer.jsx";
import { localizedMechanicHelpActions } from "../../components/workorders/mechanic-help-prompts.js";
import { ChatThread } from "../../components/workorders/ChatThread.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { WorkorderDetailSurface } from "../../components/workorders/WorkorderDetailSurface.jsx";
import { WorkorderStatusPill } from "../../components/workorders/WorkorderStatusPill.jsx";
import { WorkDoneButton } from "../../components/workorders/WorkDoneButton.jsx";
import { ApproveButton } from "../../components/workorders/ApproveButton.jsx";
import { useChatReceipts } from "../../components/workorders/chat/useChatReceipts.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { formatUiDateRange } from "../../lib/workorder-presentation.js";
import { BrowserPrintDocument, Field, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import { WorkorderDetailSections } from "./WorkorderDetailSections.jsx";
import { NarrativeField } from "../../components/forms/NarrativeField.jsx";
import { LocaleSelector } from "../../i18n/LocaleSelector.jsx";
import { interfaceText, localizedUnitType } from "../../i18n/index.js";
import { resolveWorkPerformed } from "../../../../shared/workorder-completion.js";
import {
  buildCompactPhoneDetailSections,
  coerceAllowedDetailSection,
  workorderNeedsChatAttention,
  workorderPreviewState,
} from "./workorder-detail-sections.js";
import { RETURN_CATEGORIES } from "./workorder-handoff.js";
import { useWorkorderOdooModule } from "../workorder-modules/odoo/useWorkorderOdooModule.js";
import { isWorkorderOdooEligible } from "../workorder-modules/odoo/workorder-odoo-model.js";
import { useUnitServiceHistory } from "../workorder-modules/unit/useUnitServiceHistory.js";
import { isPlainPrimaryActivation } from "../../components/ui/context-navigation.js";
import { inspectionReturnContext, inspectionWorkspaceSearch, workspaceSearchForRole } from "../../app/routes/route-state.js";
import {
  resolveWorkorderModulePolicy,
  WORKORDER_MODULE_IDS,
  WORKORDER_SURFACES,
} from "../workorder-modules/workorder-module-registry.js";

function MechanicActionMessage({ action, validationActive = false }) {
  if (!action?.message || (action.validationField && !validationActive)) return null;
  const validation = Boolean(action.validationField);
  return (
    <p
      className={`mechanic-action-message ${validation ? "is-validation-warning" : ""}`.trim()}
      role={validation ? "alert" : "status"}
    >
      {validation ? <strong>{action.message}</strong> : action.message}
    </p>
  );
}

function detailParent(actorRole, isOfficeDetail, locale) {
  const url = new URL(window.location.href);
  const inspectionReturn = inspectionReturnContext(url.searchParams);
  url.search = workspaceSearchForRole(actorRole, { inspectionReturn });
  return {
    label: inspectionReturn ? "Inspection" : actorRole === "admin" ? "Operations" : isOfficeDetail ? "Office" : interfaceText(locale, "mechanic.myWork"),
    href: url.toString(),
  };
}

function InspectionSourceReferences({ detailStatus, inspectionContext, inspectionContextUnavailable, actorRole }) {
  if (detailStatus !== "closed") return null;
  const sources = inspectionContext?.sources || [];
  if (!sources.length) return inspectionContextUnavailable ? <p className="workorder-inspection-context-unavailable" role="status">Inspection history is unavailable.</p> : null;
  const exactOne = sources.length === 1;
  const multiple = !exactOne;
  return <section className="workorder-inspection-sources" aria-label="Source inspections">
    <strong>{multiple ? "Choose source inspection" : "Source inspection"}</strong>
    {sources.map((source) => <div key={source.inspectionId}>
      <span>{source.inspectionNumber || "Inspection"}</span>
      <a href={inspectionWorkspaceSearch(actorRole, source.inspectionId)}>View inspection</a>
      {source.eligible ? <a href={inspectionWorkspaceSearch(actorRole, source.inspectionId, "reinspect")}>Reinspect</a> : source.blockerMessage ? <small>{source.blockerMessage}</small> : <small>Reinspection is not available.</small>}
    </div>)}
  </section>;
}

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
  filledPartCount,
  firstSerial,
  form,
  previewForm,
  formRef,
  fullscreenPageIndex,
  fullscreenZoom,
  isCompact,
  isMechanicDetail,
  isOfficeDetail,
  isPhone,
  locale = "en",
  localeError = "",
  localeReady = true,
  lastPhysicalPageIndex,
  lastSerial,
  mapsConfig,
  mechanicAction,
  mechanicAsset,
  mechanicFinish,
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
  policyOverrides,
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
  markOfficeWorkorderDone,
  cancelOfficeWorkorder,
  jumpToPreview,
  openFullscreenPreview,
  printWorkorders,
  printRevisedCopy,
  openOfficeCancel,
  openOfficeReturn,
  onLocaleChange,
  reloadActiveWorkorder,
  returnToRoleWorkspace,
  saveActiveUsedParts,
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
  updateActiveLaborHours,
  updateField,
  updateOfficeMechanicTeam,
  updateStartDate,
  commitDetailUnitNumber,
  unitLookupQuery,
  updateUnitLookupQuery,
  vehicleMileage,
  vehicleModelText,
}) {
  const viewport = useVisualViewport();
  const serializedRepairFlushRef = useRef(async () => true);
  const registerSerializedRepairFlush = useCallback((flush) => {
    serializedRepairFlushRef.current = typeof flush === "function" ? flush : async () => true;
  }, []);
  const t = (key) => interfaceText(locale, key);
  const renderedPreviewForm = previewForm || form;
  const modulePolicies = useMemo(() => Object.fromEntries([
    WORKORDER_MODULE_IDS.UNIT,
    WORKORDER_MODULE_IDS.LOCATION,
    WORKORDER_MODULE_IDS.SCHEDULE,
    WORKORDER_MODULE_IDS.ASSIGNMENT,
    WORKORDER_MODULE_IDS.CONCERN,
    WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR,
    WORKORDER_MODULE_IDS.PHOTOS,
    WORKORDER_MODULE_IDS.PARTS,
    WORKORDER_MODULE_IDS.CHAT,
    WORKORDER_MODULE_IDS.ACTIVITY,
    WORKORDER_MODULE_IDS.PREVIEW,
    WORKORDER_MODULE_IDS.COMPLETION,
    WORKORDER_MODULE_IDS.ODOO,
  ].map((moduleId) => [moduleId, resolveWorkorderModulePolicy({
    moduleId,
    overrides: policyOverrides,
    role: actor.role,
    surface: WORKORDER_SURFACES.DETAIL,
    userId: actor.id,
  })])), [actor.id, actor.role, policyOverrides]);
  const unitPolicy = modulePolicies[WORKORDER_MODULE_IDS.UNIT];
  const locationPolicy = modulePolicies[WORKORDER_MODULE_IDS.LOCATION];
  const schedulePolicy = modulePolicies[WORKORDER_MODULE_IDS.SCHEDULE];
  const assignmentPolicy = modulePolicies[WORKORDER_MODULE_IDS.ASSIGNMENT];
  const concernPolicy = modulePolicies[WORKORDER_MODULE_IDS.CONCERN];
  const diagnosisRepairPolicy = modulePolicies[WORKORDER_MODULE_IDS.DIAGNOSIS_REPAIR];
  const photosPolicy = modulePolicies[WORKORDER_MODULE_IDS.PHOTOS];
  const chatPolicy = modulePolicies[WORKORDER_MODULE_IDS.CHAT];
  const previewPolicy = modulePolicies[WORKORDER_MODULE_IDS.PREVIEW];
  const completionPolicy = modulePolicies[WORKORDER_MODULE_IDS.COMPLETION];
  const supportingPaneVisible = previewPolicy.canRead || chatPolicy.canRead;
  const effectiveSupportingView = !previewPolicy.canRead ? "chat" : !chatPolicy.canRead ? "preview" : supportingView;
  const visibleConversationMessages = useMemo(() => photosPolicy.canRead
    ? conversationMessages
    : conversationMessages.map((message) => ({ ...message, attachment: null, attachments: [] })),
  [conversationMessages, photosPolicy.canRead]);
  const odooSection = detailSections.find((section) => section.id === "odoo");
  const odooController = useWorkorderOdooModule({
    enabled: Boolean(odooSection),
    eligible: isWorkorderOdooEligible(detailStatus),
    onDetailRefresh: reloadActiveWorkorder,
    workorderId: activeWorkorder.workorder.id,
  });
  const unitHistoryController = useUnitServiceHistory({
    enabled: unitPolicy.canRead,
    locale: isMechanicDetail ? locale : "en",
    workorderId: activeWorkorder.workorder.id,
  });
  const visibleDetailSections = useMemo(
    () => {
      if (isCompact) return buildCompactPhoneDetailSections(detailSections, actor.role, {
        locale: isMechanicDetail ? locale : "en",
        policyOverrides,
        userId: actor.id,
      });
      return detailSections;
    },
    [actor.id, actor.role, detailSections, isCompact, isMechanicDetail, locale, policyOverrides],
  );
  const renderedDetailSection = coerceAllowedDetailSection(detailSection, visibleDetailSections);
  const mechanicValidationActive = mechanicAction.validationField === "workPerformed"
    && !resolveWorkPerformed(form);
  const canMarkWorkDone = (isMechanicDetail || isOfficeDetail) && activeWorkorder.allowedActions?.markDone === true;
  async function runAfterSerializedRepairFlush(action) {
    if (!await serializedRepairFlushRef.current()) return false;
    return action();
  }
  const markWorkDone = () => runAfterSerializedRepairFlush(isOfficeDetail
    ? markOfficeWorkorderDone
    : () => setMechanicFinish({ open: true, name: "", message: "" }));
  const markWorkDoneBusy = isOfficeDetail ? officeDetailState.busy : mechanicAction.busy === "done";
  const compactPreviewState = workorderPreviewState(activeWorkorder, renderedPreviewForm);
  const parent = detailParent(actor.role, isOfficeDetail, isMechanicDetail ? locale : "en");

  async function followDetailParent(event) {
    if (!isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    const serial = activeWorkorder.workorder.serial;
    if (!await serializedRepairFlushRef.current()) return;
    returnToRoleWorkspace();
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      if (!serial) return;
      const origin = [...document.querySelectorAll("button[aria-label], [role='row'][aria-label]")]
        .find((element) => element.getAttribute("aria-label")?.includes(serial));
      origin?.focus({ preventScroll: true });
    }));
  }
  useEffect(() => {
    if (!visibleDetailSections.length || renderedDetailSection === detailSection) return;
    selectDetailSection(renderedDetailSection);
  }, [detailSection, renderedDetailSection, selectDetailSection, visibleDetailSections.length]);
  useChatReceipts({
    active: chatPolicy.canRead && (renderedDetailSection === "chat" || (!isCompact && effectiveSupportingView === "chat")),
    currentUserId: actor.id,
    messages: visibleConversationMessages,
    role: isOfficeDetail ? "office" : "mechanic",
    workorderId: activeWorkorder.workorder.id,
  });
  const workorderChatContent = (
    <div id={isMechanicDetail ? "mechanic-chat-section" : undefined} className="chat-content">
      <ChatThread
        messages={visibleConversationMessages}
        currentRole={isOfficeDetail ? "office" : "mechanic"}
        currentUserId={actor.id}
        locale={isMechanicDetail ? locale : "en"}
        keyboardOpen={viewport.keyboardOpen}
        viewportHeight={viewport.viewportHeight}
      />
      {chatPolicy.canWrite && activeWorkorder.allowedActions?.sendMessage ? (
        <ChatComposer
          onSend={sendWorkorderChat}
          sending={mechanicAction.busy === "chat"}
          placeholder={t("chat.message")}
          textareaLabel={t("chat.messageLabel")}
          cameraLabel={isOfficeDetail ? "Take or add photo" : t("chat.takePhoto")}
          sendLabel={t("chat.send")}
          locale={locale}
          compact={isMechanicDetail}
          quickActions={isMechanicDetail ? localizedMechanicHelpActions(locale) : []}
          allowAttachments={photosPolicy.canRead}
        />
      ) : null}
      {chatPolicy.canWrite && !activeWorkorder.allowedActions?.sendMessage ? (
        <p className="workorder-chat-unavailable" role="status">
          {assignedMechanicIds.length
            ? t("chat.readOnly")
            : t("chat.assignMechanic")}
        </p>
      ) : null}
      <MechanicActionMessage action={mechanicAction} validationActive={mechanicValidationActive} />
    </div>
  );

  return (
    <main
      className={`prototype workorder-detail-page ${isMechanicDetail ? "mechanic-detail-page" : ""} ${viewport.keyboardOpen ? "is-keyboard-open" : ""}`.trim()}
      data-keyboard-open={viewport.keyboardOpen ? "true" : "false"}
      data-detail-section={renderedDetailSection}
      style={{
        "--workorder-visual-viewport-height": viewport.viewportHeight ? `${viewport.viewportHeight}px` : "100dvh",
        "--workorder-visual-viewport-offset-top": `${viewport.viewportOffsetTop}px`,
      }}
    >
      <style>{workorderTemplateStyles}</style>
      {previewPolicy.canRead ? <BrowserPrintDocument payload={browserPrintPayload} /> : null}
      <WorkorderDetailSurface
        locale={isMechanicDetail ? locale : "en"}
        previewOpen={!isPhone && supportingPaneVisible && showEmbeddedPreview}
        controlRef={formRef}
        context={{
          parent: { ...parent, onClick: followDetailParent },
          current: activeWorkorder.workorder.serial || t("detail.workorder"),
          title: unitPolicy.canRead
            ? activeWorkorder.workorder.asset?.unitNo || activeWorkorder.workorder.asset?.name || t("detail.workorder")
            : t("detail.workorder"),
          subtitle: activeWorkorder.workorder.serial,
          status: <WorkorderStatusPill status={detailStatus} label={currentStatusLabel} />,
          actions: (
            <>
              {isMechanicDetail ? (
                <LocaleSelector locale={locale} onChange={onLocaleChange} error={localeError} disabled={!localeReady} compact />
              ) : null}
              {isOfficeDetail && concernPolicy.canWrite && activeWorkorder.allowedActions?.update ? (
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
              {isOfficeDetail && completionPolicy.canWrite && activeWorkorder.allowedActions?.approve ? (
                <ApproveButton
                  className="detail-close-workorder-button"
                  type="button"
                  onClick={() => {
                    setOfficeDetailState((current) => ({ ...current, message: "" }));
                    setOfficeCloseOpen(true);
                  }}
                  busy={officeDetailState.busy}
                  aria-label="Approve workorder"
                  title="Approve workorder"
                />
              ) : null}
              {isMechanicDetail && assignmentPolicy.canWrite && activeWorkorder.allowedActions?.accept ? (
                <button
                  className="detail-close-workorder-button"
                  type="button"
                  onClick={acceptOpenedMechanicWorkorder}
                  disabled={Boolean(mechanicAction.busy)}
                  aria-label={t("detail.acceptStart")}
                >
                  <CheckCircle />
                  <span>{mechanicAction.busy === "accept" ? t("detail.accepting") : t("detail.acceptWork")}</span>
                </button>
              ) : null}
              {!isPhone && supportingPaneVisible ? (
                <PreviewToggle
                  open={showEmbeddedPreview || previewFullscreen}
                  onToggle={toggleWorkorderTools}
                  controls="workorder-preview-panel"
                  openLabel={t("preview.openWorkorderTools")}
                  closeLabel={t("preview.closeWorkorderTools")}
                />
              ) : null}
            </>
          ),
        }}
        summary={{
          concern: concernPolicy.canRead ? form.mechanicConcern : "",
          customer: unitPolicy.canRead ? form.customerCompanyName : "",
          dates: schedulePolicy.canRead ? formatUiDateRange(form.workStartDate, form.workEndDate, { locale }) : "",
          location: locationPolicy.canRead ? detailLocationName : "",
          mechanics: assignmentPolicy.canRead ? detailMechanicNames : "",
          unit: unitPolicy.canRead ? form.unitNo || mechanicAsset.unitNo || mechanicAsset.name : "",
          unitType: unitPolicy.canRead
            ? (isMechanicDetail
              ? localizedUnitType(form.unitType || mechanicAsset.unitType, locale) || t("detail.unit")
              : form.unitType || mechanicAsset.unitType || "Unit")
            : (isMechanicDetail ? t("detail.workorder") : "Workorder"),
          actions: canMarkWorkDone && !isCompact ? (
              <WorkDoneButton
                type="button"
                onClick={markWorkDone}
                busy={markWorkDoneBusy}
                disabled={isOfficeDetail
                  ? officeDetailState.busy
                  : Boolean(mechanicAction.busy) && mechanicAction.busy !== "done"}
                label={t("completion.workDone")}
                busyLabel={t("completion.submitting")}
              />
            ) : null,
          children: (
            <>
            <InspectionSourceReferences
              detailStatus={detailStatus}
              inspectionContext={activeWorkorder.inspectionContext}
              inspectionContextUnavailable={activeWorkorder.inspectionContextUnavailable}
              actorRole={actor.role}
            />
            {isMechanicDetail && unitPolicy.canRead ? (
              <div className="workorder-object-inline-detail">
                <span>{t("detail.assetDetails")}</span>
                <strong>{mechanicVehicleLabel}</strong>
                <span>{t("detail.mileage")}</span>
                <strong>{form.mileage ? `${form.mileage} ${t("unit.milesShort")}` : t("detail.notListed")}</strong>
              </div>
            ) : null}
            <MechanicActionMessage action={mechanicAction} validationActive={mechanicValidationActive} />
            {officeDetailState.error && officeDetailState.message ? (
              <p className="mechanic-action-message is-validation-warning" role="alert">
                <AlertCircle aria-hidden="true" />
                <strong>{officeDetailState.message}</strong>
              </p>
            ) : null}
            </>
          ),
        }}
        sections={{
          items: visibleDetailSections,
          activeId: renderedDetailSection,
          onSelect: selectDetailSection,
          preferenceKey: `workorder.sectionOrder.v1:${actor.id}:${actor.role}:detail`,
        }}
        supportingPane={!isCompact && supportingPaneVisible ? (
          <PreviewPane
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
            supportingContent={!isMechanicDetail && chatPolicy.canRead ? workorderChatContent : undefined}
            supportingLabel={isOfficeDetail ? "Chat with mechanic" : t("detail.helpFromOffice")}
            supportingCount={chatPolicy.canRead ? visibleConversationMessages.length || undefined : undefined}
            supportingAttention={workorderNeedsChatAttention(detailStatus)}
            activeView={effectiveSupportingView}
            onViewChange={setSupportingView}
            locale={isMechanicDetail ? locale : "en"}
          >
            {previewPolicy.canRead ? <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} mechanic-preview-grid`}>
              <WorkorderPreview label={t("preview.firstPage")} serial={firstSerial} form={renderedPreviewForm} />
              {effectiveCopies > 1 || lastPhysicalPageIndex > 0
                ? <WorkorderPreview label={t("preview.lastPage")} serial={lastSerial} form={renderedPreviewForm} pageIndex={lastPhysicalPageIndex} />
                : null}
            </div> : null}
          </PreviewPane>
        ) : null}
      >
          {!visibleDetailSections.length ? (
            <div className="mechanic-empty-state" role="status">
              <strong>{t("detail.noModules")}</strong>
              <span>{t("detail.noModulesHelp")}</span>
            </div>
          ) : null}

          {canMarkWorkDone && isMechanicDetail && isCompact ? (
            <div className="mechanic-compact-primary-action">
              <WorkDoneButton
                type="button"
                onClick={() => setMechanicFinish({ open: true, name: "", message: "" })}
                busy={mechanicAction.busy === "done"}
                disabled={Boolean(mechanicAction.busy) && mechanicAction.busy !== "done"}
                label={t("completion.workDone")}
                busyLabel={t("completion.submitting")}
              />
            </div>
          ) : null}

          <WorkorderDetailSections
            activeWorkorder={activeWorkorder}
            actorId={actor.id}
            actorRole={actor.role}
            assignedMechanicIds={assignedMechanicIds}
            conversationMessages={conversationMessages}
            detailMechanicNames={detailMechanicNames}
            detailSection={renderedDetailSection}
            detailSections={visibleDetailSections}
            modulePolicies={modulePolicies}
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
            mechanicValidationField={mechanicValidationActive ? mechanicAction.validationField : ""}
            mechanicUnitType={mechanicUnitType}
            mechanicVehicleLabel={mechanicVehicleLabel}
            officeAssignment={officeAssignment}
            officeAssignmentChanged={officeAssignmentChanged}
            officeDetailState={officeDetailState}
            officeLocations={officeLocations}
            odooAccess={odooSection?.access}
            odooController={odooController}
            pendingPartCount={pendingPartCount}
            selectedVehicle={selectedVehicle}
            vehicleLookup={vehicleLookup}
            visibleTimeline={visibleTimeline}
            locale={locale}
            workorderChatContent={workorderChatContent}
            applyVehicle={applyVehicle}
            reloadActiveWorkorder={reloadActiveWorkorder}
            onRegisterSerializedRepairFlush={registerSerializedRepairFlush}
            saveActiveUsedParts={saveActiveUsedParts}
            saveOfficeWorkorder={saveOfficeWorkorder}
            openOfficeCancel={openOfficeCancel}
            openOfficeReturn={openOfficeReturn}
            selectOfficeLocation={selectOfficeLocation}
            setDetailSection={selectDetailSection}
            setOfficeAssignment={setOfficeAssignment}
            updateActiveUsedParts={updateActiveUsedParts}
            updateActiveLaborHours={updateActiveLaborHours}
            updateField={updateField}
            updateOfficeMechanicTeam={updateOfficeMechanicTeam}
            updateStartDate={updateStartDate}
            onUnitNumberCommit={commitDetailUnitNumber}
            unitLookupQuery={unitLookupQuery}
            updateUnitNumber={updateUnitLookupQuery}
            unitHistoryController={unitHistoryController}
            vehicleMileage={vehicleMileage}
            vehicleModelText={vehicleModelText}
            acceptOpenedMechanicWorkorder={acceptOpenedMechanicWorkorder}
            openMechanicFinish={() => runAfterSerializedRepairFlush(
              () => setMechanicFinish({ open: true, name: "", message: "" }),
            )}
            markOfficeWorkorderDone={() => runAfterSerializedRepairFlush(markOfficeWorkorderDone)}
            openOfficeClose={() => {
              setOfficeDetailState((current) => ({ ...current, message: "" }));
              setOfficeCloseOpen(true);
            }}
          />
          {isCompact && renderedDetailSection === "preview" && previewPolicy.canRead ? (
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
              locale={locale}
            >
              <div ref={previewGridRef} className={`preview-grid ${effectiveCopies <= 1 ? "single" : ""} mechanic-preview-grid`}>
                <WorkorderPreview label={t("preview.firstPage")} serial={firstSerial} form={renderedPreviewForm} />
                {effectiveCopies > 1 || lastPhysicalPageIndex > 0
                  ? <WorkorderPreview label={t("preview.lastPage")} serial={lastSerial} form={renderedPreviewForm} pageIndex={lastPhysicalPageIndex} />
                  : null}
              </div>
            </CompactWorkorderPreview>
          ) : null}
      </WorkorderDetailSurface>

      {previewPolicy.canRead ? <PreviewFullscreen
        open={previewFullscreen}
        form={renderedPreviewForm}
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
        locale={isMechanicDetail ? locale : "en"}
      /> : null}
      {previewPolicy.canRead ? <PrintModal state={printState} range={range} locale={isMechanicDetail ? locale : "en"} onCreateRevision={printRevisedCopy} onClose={() => setPrintState({ open: false, stage: "idle", message: "" })} /> : null}

      {completionPolicy.canWrite && mechanicFinish.open ? (
        <div
          className="modal-backdrop"
          role="presentation"
          onMouseDown={(event) => {
            if (event.target === event.currentTarget && !mechanicAction.busy) {
              setMechanicFinish({ open: false, name: "", message: "" });
            }
          }}
        >
          <form className="mechanic-completion-modal" role="dialog" aria-modal="true" aria-label={t("completion.dialogLabel")} onSubmit={submitMechanicFinish}>
            <button
              className="close-button"
              type="button"
              onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
              disabled={Boolean(mechanicAction.busy)}
              aria-label={t("completion.cancelLabel")}
            >
              <XClose />
            </button>
            <h2>{t("completion.workDone")}?</h2>
            <p>{t("completion.confirm")}</p>
            {mechanicFinish.message ? <p className="mechanic-completion-message" role="alert">{mechanicFinish.message}</p> : null}
            <div className="mechanic-completion-actions">
              <Button
                variant="secondary"
                type="button"
                onClick={() => setMechanicFinish({ open: false, name: "", message: "" })}
                disabled={Boolean(mechanicAction.busy)}
              >
                {t("completion.keepWorking")}
              </Button>
              <Button variant="primary" type="submit" disabled={Boolean(mechanicAction.busy)} autoFocus>
                {mechanicAction.busy === "done" ? t("completion.submitting") : t("completion.yes")}
              </Button>
            </div>
          </form>
        </div>
      ) : null}

      {completionPolicy.canWrite && officeCloseOpen ? (
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
              <ApproveButton type="submit" busy={officeDetailState.busy} label="Approve workorder" />
            </div>
          </form>
        </div>
      ) : null}

      {completionPolicy.canWrite && officeReturn.open ? (
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

      {completionPolicy.canWrite && officeCancel.open ? (
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
