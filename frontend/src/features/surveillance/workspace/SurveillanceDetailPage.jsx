import { ArrowLeft, ArrowRight } from "@untitledui/icons";
import { PreviewPane, PreviewToggle } from "../../../components/preview/PreviewPane.jsx";
import { WorkorderDetailSurface } from "../../../components/workorders/WorkorderDetailSurface.jsx";
import { CompactWorkorderPreview } from "../../../components/workorders/CompactWorkorderPreview.jsx";
import { ProgressiveWorkorderSection } from "../../../components/workorders/WorkorderObjectPage.jsx";
import { WorkorderTimelinePanel } from "../../../components/workorders/WorkorderTimeline.jsx";
import { timelineEventCount } from "../../../components/workorders/workorder-timeline-model.js";
import { WorkorderStatusPill } from "../../../components/workorders/WorkorderStatusPill.jsx";
import { PreviewFullscreen, WorkorderPreview } from "../../generator/GeneratorUi.jsx";
import { buildCompactPhoneDetailSections } from "../../workorder-detail/workorder-detail-sections.js";
import { canonicalDetailPreviewTemplate } from "../../workorder-detail/workorder-preview-template.js";
import {
  normalizeWorkorderFormData,
  workDateRangeLabel,
  workorderPhysicalPageCount,
  workorderTemplateStyles,
} from "../../../../../shared/workorder-template.js";
import { formatQuantity } from "../../../../../shared/units-of-measure.js";
import { surveillanceMissingInfoHandoff } from "../surveillanceQueue.js";
import { SurveillanceOdooPanel } from "./SurveillanceOdooPanel.jsx";
import { localDate, missingFields, progressTimestamp } from "./surveillance-workspace-model.js";

function valueOrDash(value) {
  return value || "-";
}

export function SurveillanceDetailPage({ controller, error, isPhone, rows }) {
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
  const baseDetailSections = [
    { id: "work", label: canProcessOdoo ? "Odoo" : "Work", attention: canProcessOdoo && missing.length > 0 },
    { id: "parts", label: "Parts", count: usedParts.length || undefined },
    { id: "unit", label: unitType || "Unit" },
    { id: "activity", label: "Activity", count: activityCount || undefined },
  ];
  const detailSections = isPhone
    ? buildCompactPhoneDetailSections(baseDetailSections, "surveillance")
    : baseDetailSections;
  const selectedSection = detailSections.some((section) => section.id === detailSection) ? detailSection : "work";
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

  return (
    <main className="prototype workorder-detail-page surveillance-detail-page">
      <style>{workorderTemplateStyles}</style>
      <WorkorderDetailSurface
        previewOpen={!isPhone && previewOpen}
        context={{
          onBack: closeDetail,
          backLabel: "Back to surveillance queue",
          title: valueOrDash(assetLabel || workorder.serial),
          subtitle: workorder.serial,
          status: <WorkorderStatusPill status={workorder.status} />,
          actions: (
            <>
              <nav className="surveillance-batch-nav" aria-label="Batch navigation">
                <button type="button" onClick={() => openRelative(-1)} disabled={currentIndex <= 0} aria-label="Previous workorder"><ArrowLeft /></button>
                <span>{currentIndex >= 0 ? `${currentIndex + 1} of ${rows.length}` : ""}</span>
                <button type="button" onClick={() => openRelative(1)} disabled={currentIndex < 0 || currentIndex >= rows.length - 1} aria-label="Next workorder"><ArrowRight /></button>
              </nav>
              {!isPhone ? (
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
          concern: workorder.concern,
          customer: customerName,
          dates: workDates,
          location: workorder.location?.name,
          mechanics: mechanicNames,
          unit: assetLabel,
          unitType,
          children: (
            <div className="workorder-object-inline-detail surveillance-inline-detail">
              <span>{unitType} details</span>
              <strong>{vehicleLabel || valueOrDash(formData.model || workorder.asset?.model)}</strong>
              <span>{progress.label}</span>
              <strong>{valueOrDash(progress.value ? new Date(progress.value).toLocaleString() : "")}</strong>
            </div>
          ),
        }}
        sections={{ items: detailSections, activeId: selectedSection, onSelect: setDetailSection }}
        supportingPane={!isPhone ? (
          <PreviewPane
            id="workorder-preview-panel"
            open={previewOpen}
            variant="dock"
            panelRef={previewRef}
            status={<WorkorderStatusPill status={workorder.status} />}
            countLabel="1 workorder"
            range={workorder.serial}
            onFullscreen={() => setPreviewFullscreen(true)}
            onOpenPreview={() => setPreviewFullscreen(true)}
          >
            {previewGrid}
          </PreviewPane>
        ) : null}
      >
        <div className="accordion-stack workorder-progressive-stack surveillance-detail-sections">
          <ProgressiveWorkorderSection
            id="work"
            title={canProcessOdoo ? "Odoo service order" : "Work progress"}
            summary={canProcessOdoo ? "Enter Odoo details or send back for information" : "Monitor mechanic and office progress"}
            activeSection={selectedSection}
            onSelect={setDetailSection}
            attention={canProcessOdoo && missing.length > 0}
            displayMode="panel"
          >
            <SurveillanceOdooPanel
              canProcessOdoo={canProcessOdoo}
              controller={controller}
              missing={missing}
              missingInfoHandoff={missingInfoHandoff}
              workorder={workorder}
            />
          </ProgressiveWorkorderSection>

          <ProgressiveWorkorderSection
            id="parts"
            title="Parts used"
            summary={usedParts.length ? `${usedParts.length} recorded` : "No parts recorded"}
            activeSection={selectedSection}
            onSelect={setDetailSection}
            displayMode="panel"
          >
            <div className="surveillance-parts-list">
              {usedParts.length ? usedParts.map((part, index) => (
                <div key={`${part.partNo || part.description}-${index}`}>
                  <strong>{valueOrDash(part.partNo || part.description)}</strong>
                  <span>{formatQuantity(part.qty, part.uomCode) || "Quantity not recorded"}</span>
                  <p>{part.repairOrder || part.description || ""}</p>
                </div>
              )) : <p>No parts recorded.</p>}
            </div>
          </ProgressiveWorkorderSection>

          <ProgressiveWorkorderSection
            id="unit"
            title={`${unitType || "Unit"} details`}
            summary={[assetLabel, customerName].filter(Boolean).join(" · ") || "Unit and customer information"}
            activeSection={selectedSection}
            onSelect={setDetailSection}
            displayMode="panel"
          >
            <dl className="surveillance-readonly-grid">
              <div><dt>Unit</dt><dd>{valueOrDash(assetLabel)}</dd></div>
              <div><dt>Type</dt><dd>{valueOrDash(unitType)}</dd></div>
              <div><dt>VIN</dt><dd>{valueOrDash(formData.vinNo || workorder.asset?.vin)}</dd></div>
              <div><dt>License</dt><dd>{valueOrDash(formData.licenseNo || workorder.asset?.licensePlate)}</dd></div>
              <div><dt>Model</dt><dd>{valueOrDash(formData.model || workorder.asset?.model)}</dd></div>
              <div><dt>Mileage</dt><dd>{formData.mileage ? `${formData.mileage} mi` : "Not listed"}</dd></div>
              <div><dt>Customer</dt><dd>{valueOrDash(customerName)}</dd></div>
              <div><dt>Location</dt><dd>{valueOrDash(workorder.location?.name)}</dd></div>
            </dl>
          </ProgressiveWorkorderSection>

          <ProgressiveWorkorderSection
            id="activity"
            title="Activity"
            summary={`${activityCount} ${activityCount === 1 ? "event" : "events"}`}
            activeSection={selectedSection}
            onSelect={setDetailSection}
            displayMode="panel"
          >
            <WorkorderTimelinePanel
              timeline={detail.timeline || []}
              participants={detail.participants || []}
              compact={isPhone}
            />
          </ProgressiveWorkorderSection>
          {isPhone && selectedSection === "preview" ? (
            <CompactWorkorderPreview
              panelRef={previewRef}
              status={<WorkorderStatusPill status={workorder.status} />}
              countLabel="1 workorder"
              range={workorder.serial}
              onFullscreen={() => setPreviewFullscreen(true)}
            >
              {previewGrid}
            </CompactWorkorderPreview>
          ) : null}
        </div>
      </WorkorderDetailSurface>
      <PreviewFullscreen
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
      />
    </main>
  );
}
