import { ArrowLeft, ArrowRight } from "@untitledui/icons";
import { useEffect } from "react";
import { PreviewPane, PreviewToggle } from "../../../components/preview/PreviewPane.jsx";
import { WorkorderDetailSurface } from "../../../components/workorders/WorkorderDetailSurface.jsx";
import { CompactWorkorderPreview } from "../../../components/workorders/CompactWorkorderPreview.jsx";
import { ChatThread } from "../../../components/workorders/ChatThread.jsx";
import { timelineEventCount } from "../../../components/workorders/workorder-timeline-model.js";
import { WorkorderStatusPill } from "../../../components/workorders/WorkorderStatusPill.jsx";
import { PreviewFullscreen, WorkorderPreview } from "../../generator/GeneratorUi.jsx";
import {
  buildCompactPhoneDetailSections,
  buildSurveillanceWorkorderDetailSections,
  coerceAllowedDetailSection,
} from "../../workorder-detail/workorder-detail-sections.js";
import { canonicalDetailPreviewTemplate } from "../../workorder-detail/workorder-preview-template.js";
import {
  normalizeWorkorderFormData,
  workDateRangeLabel,
  workorderPhysicalPageCount,
  workorderTemplateStyles,
} from "../../../../../shared/workorder-template.js";
import { surveillanceMissingInfoHandoff } from "../surveillanceQueue.js";
import { WorkorderDetailModuleHost } from "../../workorder-modules/WorkorderDetailModuleHost.jsx";
import { localDate, missingFields, progressTimestamp } from "./surveillance-workspace-model.js";

function valueOrDash(value) {
  return value || "-";
}

export function SurveillanceDetailPage({ actor, controller, error, isPhone, rows }) {
  const {
    closeDetail,
    detail,
    detailSection,
    fullscreenPageIndex,
    fullscreenZoom,
    openRelative,
    previewFullscreen,
    previewOpen,
    previewRef,
    setDetailSection,
    setFullscreenPageIndex,
    setFullscreenZoom,
    setPreviewFullscreen,
    togglePreview,
  } = controller;
  const workorder = detail.workorder;
  const formData = workorder.formData || {};
  const unitType = workorder.asset?.unitType || formData.unitType || "Vehicle";
  const mechanicNames = workorder.mechanics?.map((mechanic) => mechanic.name).filter(Boolean).join(", ")
    || workorder.mechanic?.name;
  const usedParts = (formData.parts || []).filter((part) => part.partNo || part.description || part.repairOrder);
  const missing = missingFields(workorder);
  const currentIndex = rows.findIndex((row) => row.id === workorder.id);
  const canProcessOdoo = ["closed", "odoo_entered"].includes(workorder.status);
  const progress = progressTimestamp(workorder);
  const activityCount = timelineEventCount(detail.timeline);
  const missingInfoHandoff = surveillanceMissingInfoHandoff(workorder, detail.timeline);
  const baseDetailSections = buildSurveillanceWorkorderDetailSections({
    activityCount,
    canProcessOdoo,
    missingCount: missing.length,
    policyOverrides: detail.policy || workorder.policy || workorder.location?.policy,
    unitType,
    usedPartCount: usedParts.length,
    role: "surveillance",
    userId: actor?.id || "",
  });
  const detailSections = isPhone
    ? buildCompactPhoneDetailSections(baseDetailSections, "surveillance", {
      policyOverrides: detail.policy || workorder.policy || workorder.location?.policy,
      userId: actor?.id || "",
    })
    : baseDetailSections;
  const selectedSection = coerceAllowedDetailSection(detailSection, detailSections);
  const odooSection = detailSections.find((section) => section.id === "odoo");
  useEffect(() => {
    if (!detailSections.length || selectedSection === detailSection) return;
    setDetailSection(selectedSection);
  }, [detailSection, detailSections.length, selectedSection, setDetailSection]);
  const workDates = workDateRangeLabel({
    workStartDate: formData.workStartDate || workorder.workStartDate || workorder.createdAt,
    workEndDate: formData.workEndDate || workorder.workEndDate || formData.workStartDate || workorder.createdAt,
  });
  const customerName = workorder.customerCompanyName || formData.customerCompanyName || formData.companyName;
  const assetLabel = workorder.asset?.unitNo || workorder.asset?.name;
  const previewForm = normalizeWorkorderFormData({
    ...formData,
    ...canonicalDetailPreviewTemplate(workorder),
    mechanicConcern: formData.mechanicConcern || workorder.concern || "",
    customerCompanyName: customerName || "",
    unitNo: formData.unitNo || assetLabel || "",
    unitType: formData.unitType || unitType || "",
    model: formData.model || workorder.asset?.model || "",
    vinNo: formData.vinNo || workorder.asset?.vin || "",
    licenseNo: formData.licenseNo || workorder.asset?.licensePlate || "",
    workStartDate: formData.workStartDate || formData.workDate || workorder.workStartDate || localDate(workorder.createdAt),
    workEndDate: formData.workEndDate || workorder.workEndDate || formData.workStartDate || formData.workDate || localDate(workorder.createdAt),
    parts: Array.isArray(formData.parts) ? formData.parts : [],
  }, { assetOwnerName: customerName || "" });
  const pageCount = workorderPhysicalPageCount(previewForm);
  const openFullscreenPreview = () => {
    setFullscreenPageIndex(0);
    setFullscreenZoom(1);
    setPreviewFullscreen(true);
  };
  const vehicleLabel = [
    formData.model || workorder.asset?.model,
    formData.mileage ? `${formData.mileage} mi` : "",
  ].filter(Boolean).join(" · ");

  const previewGrid = (
    <div className="preview-grid single mechanic-preview-grid">
      <WorkorderPreview label="First page" serial={workorder.serial} form={previewForm} />
      {pageCount > 1
        ? <WorkorderPreview label="Last page" serial={workorder.serial} form={previewForm} pageIndex={pageCount - 1} />
        : null}
    </div>
  );
  const sectionAccess = (moduleId) => detailSections.find((section) => section.id === moduleId)?.access || null;
  const canRead = (moduleId) => Boolean(sectionAccess(moduleId));
  const moduleProps = {
    activity: {
      activeWorkorder: detail,
      detailSection: selectedSection,
      isMechanicDetail: false,
      onSelect: setDetailSection,
      visibleTimeline: detail.timeline || [],
    },
    assignment: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      assignedIds: workorder.mechanics?.map((mechanic) => mechanic.id) || [],
      assignment: { mechanicUserIds: workorder.mechanics?.map((mechanic) => mechanic.id) || [], reason: "" },
      assignmentChanged: false,
      assignableMechanics: [],
      busy: false,
      mechanicNames,
      onSelect: setDetailSection,
    },
    chat: {
      activeWorkorder: detail,
      conversationMessages: detail.messages || [],
      detailSection: selectedSection,
      isCompact: isPhone,
      isMechanicDetail: false,
      label: "Chat",
      onSelect: setDetailSection,
      content: <div className="chat-content"><ChatThread messages={detail.messages || []} currentRole="surveillance" currentUserId={actor?.id || ""} /></div>,
    },
    completion: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      busy: false,
      customerSignature: formData.customerSignature,
      onSelect: setDetailSection,
      workorder,
    },
    concern: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      concern: formData.mechanicConcern || workorder.concern,
      onSelect: setDetailSection,
    },
    diagnosisRepair: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      diagnosis: formData.diagnosis || workorder.diagnosis,
      onSelect: setDetailSection,
      workPerformed: formData.workPerformed || workorder.workPerformed,
    },
    location: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      location: workorder.location,
      locations: [],
      onSelect: setDetailSection,
      vehicle: workorder.asset,
    },
    odoo: {
      activeWorkorder: detail,
      controller,
      detailSection: selectedSection,
      detailStatus: workorder.status,
      fieldAccess: {
        concern: Boolean(sectionAccess("concern")),
        diagnosisRepair: Boolean(sectionAccess("diagnosisRepair")),
      },
      onSelect: setDetailSection,
    },
    parts: {
      activeWorkorder: detail,
      actorId: actor?.id || "",
      detailSection: selectedSection,
      filledPartCount: usedParts.length,
      form: { ...previewForm, parts: formData.parts || [] },
      isMechanicDetail: false,
      isOfficeDetail: false,
      pendingPartCount: 0,
      onSelect: setDetailSection,
    },
    photos: { activeSection: selectedSection, messages: detail.messages || [], onSelect: setDetailSection },
    schedule: {
      activeSection: selectedSection,
      allowedActions: detail.allowedActions || {},
      endDate: previewForm.workEndDate,
      onSelect: setDetailSection,
      startDate: previewForm.workStartDate,
      workorder,
    },
    unit: {
      activeWorkorder: detail,
      detailSection: selectedSection,
      form: previewForm,
      onSelect: setDetailSection,
      vehicleLookup: { loading: false, results: [] },
      vehicleMileage: () => "",
      vehicleModelText: () => "",
    },
  };

  return (
    <main className="prototype workorder-detail-page surveillance-detail-page">
      <style>{workorderTemplateStyles}</style>
      <WorkorderDetailSurface
        previewOpen={!isPhone && canRead("preview") && previewOpen}
        context={{
          onBack: closeDetail,
          backLabel: "Back to surveillance queue",
          title: canRead("unit") ? valueOrDash(assetLabel || workorder.serial) : workorder.serial,
          subtitle: workorder.serial,
          status: <WorkorderStatusPill status={workorder.status} />,
          actions: (
            <>
              <nav className="surveillance-batch-nav" aria-label="Batch navigation">
                <button type="button" onClick={() => openRelative(-1)} disabled={currentIndex <= 0} aria-label="Previous workorder"><ArrowLeft /></button>
                <span>{currentIndex >= 0 ? `${currentIndex + 1} of ${rows.length}` : ""}</span>
                <button type="button" onClick={() => openRelative(1)} disabled={currentIndex < 0 || currentIndex >= rows.length - 1} aria-label="Next workorder"><ArrowRight /></button>
              </nav>
              {!isPhone && canRead("preview") ? (
                <PreviewToggle
                  open={previewOpen || previewFullscreen}
                  onToggle={togglePreview}
                  controls="workorder-preview-panel"
                />
              ) : null}
            </>
          ),
        }}
        notice={error ? <p className="ops-error" role="alert">{error}</p> : null}
        summary={{
          concern: canRead("concern") ? workorder.concern : "",
          customer: canRead("unit") ? customerName : "",
          dates: canRead("schedule") ? workDates : "",
          location: canRead("location") ? workorder.location?.name : "",
          mechanics: canRead("assignment") ? mechanicNames : "",
          unit: canRead("unit") ? assetLabel : "",
          unitType: canRead("unit") ? unitType : "Workorder",
          children: (
            canRead("unit") ? <div className="workorder-object-inline-detail surveillance-inline-detail">
              <span>{unitType} details</span>
              <strong>{vehicleLabel || valueOrDash(formData.model || workorder.asset?.model)}</strong>
              <span>{progress.label}</span>
              <strong>{valueOrDash(progress.value ? new Date(progress.value).toLocaleString() : "")}</strong>
            </div> : null
          ),
        }}
        sections={{ items: detailSections, activeId: selectedSection, onSelect: setDetailSection }}
        supportingPane={!isPhone && canRead("preview") ? (
          <PreviewPane
            id="workorder-preview-panel"
            open={previewOpen}
            variant="dock"
            panelRef={previewRef}
            status={<WorkorderStatusPill status={workorder.status} />}
            countLabel="1 workorder"
            range={workorder.serial}
            onFullscreen={openFullscreenPreview}
            onOpenPreview={openFullscreenPreview}
          >
            {previewGrid}
          </PreviewPane>
        ) : null}
      >
        {!detailSections.length ? (
          <div className="mechanic-empty-state" role="status">
            <strong>No workorder modules available</strong>
            <span>Your access does not include any visible detail sections for this workorder.</span>
          </div>
        ) : (
        <div className="surveillance-detail-sections">
          <WorkorderDetailModuleHost sections={detailSections} moduleProps={moduleProps} />
          {isPhone && selectedSection === "preview" && canRead("preview") ? (
            <CompactWorkorderPreview
              panelRef={previewRef}
              status={<WorkorderStatusPill status={workorder.status} />}
              countLabel="1 workorder"
              range={workorder.serial}
              onFullscreen={openFullscreenPreview}
            >
              {previewGrid}
            </CompactWorkorderPreview>
          ) : null}
        </div>
        )}
      </WorkorderDetailSurface>
      {canRead("preview") ? <PreviewFullscreen
        open={previewFullscreen}
        form={previewForm}
        serials={[workorder.serial]}
        pageIndex={fullscreenPageIndex}
        zoom={fullscreenZoom}
        range={workorder.serial}
        countLabel="1 workorder"
        actionLabel="Preview workorder"
        onClose={() => setPreviewFullscreen(false)}
        onPageChange={setFullscreenPageIndex}
        onZoomChange={setFullscreenZoom}
      /> : null}
    </main>
  );
}
