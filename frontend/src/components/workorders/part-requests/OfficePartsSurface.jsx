import { DotsVertical } from "@untitledui/icons";
import { useEffect, useId, useRef, useState } from "react";
import { Button, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { ModalFrame } from "../../ui/ModalFrame.jsx";
import { officeQueueText } from "./part-request-model.js";
import { OfficeRequestCard } from "./OfficeRequestCard.jsx";
import { OfficePartComposer } from "./OfficePartComposer.jsx";
import { UsedPartsSection } from "./UsedPartsSection.jsx";
import { interfaceText } from "../../../i18n/index.js";
import { SectionHelpDisclosure } from "../SectionHelpDisclosure.jsx";
import { MechanicPartRequestForm } from "../MechanicPartRequestForm.jsx";

export function OfficePartsSurface({
  actorId,
  financialFooter = null,
  detail,
  parts,
  laborHours,
  laborProduct,
  locationId,
  laborRepairOrder,
  laborRepairOrderDisabled,
  installedParts = [],
  onLaborHoursChange,
  onLaborProductChange,
  onLaborRepairOrderChange,
  onPartsChange,
  onSaveParts,
  onChanged,
  onRegisterSerializedRepairFlush,
  serializedParts,
  usedPartsAccess,
  laborEditable,
  presentation = "panel",
}) {
  const locale = "en";
  const t = (key) => interfaceText(locale, key);
  const requests = detail.partRequests || [];
  const focusedRequestId = typeof window === "undefined"
    ? ""
    : new URLSearchParams(window.location.search).get("partRequest") || "";
  const focusedRequestRef = useRef(null);
  const supplyDialogTitleId = useId();
  const [requestFormOpen, setRequestFormOpen] = useState(Boolean(focusedRequestId));
  const [supplyDialogOpen, setSupplyDialogOpen] = useState(Boolean(focusedRequestId));

  useEffect(() => {
    if (!focusedRequestId || !requests.some((request) => request.id === focusedRequestId)) return;
    setSupplyDialogOpen(true);
    const frame = window.requestAnimationFrame(() => {
      focusedRequestRef.current?.scrollIntoView?.({ block: "center" });
      focusedRequestRef.current?.focus?.({ preventScroll: true });
    });
    return () => window.cancelAnimationFrame(frame);
  }, [focusedRequestId, requests]);

  const partsSupplyContent = <>
    {detail.allowedActions?.requestParts ? <div className="mechanic-part-request-action">
      <button type="button" aria-expanded={requestFormOpen} aria-controls={`office-request-part-${detail.workorder.id}`} onClick={() => setRequestFormOpen((open) => !open)}>Request part</button>
      <div id={`office-request-part-${detail.workorder.id}`} hidden={!requestFormOpen}>
        <MechanicPartRequestForm workorderId={detail.workorder.id} onChanged={onChanged} requestUrl={`/api/workorders/${encodeURIComponent(detail.workorder.id)}/modules/parts/actions/request`} />
      </div>
    </div> : null}
    {detail.allowedActions?.planParts ? (
      <section className={`office-part-planning${presentation === "one-page" ? " is-one-page" : ""}`} aria-labelledby="requests-supply-heading">
        <div className="office-part-planning-heading">
          <h3 id="requests-supply-heading">{t("parts.requestsSupply")}</h3>
          <SectionHelpDisclosure label={t("parts.planningDoesNotRecordUse")}><p>{t("parts.planningDoesNotRecordUse")}</p></SectionHelpDisclosure>
        </div>
        <OfficePartComposer detail={detail} onChanged={onChanged} />
      </section>
    ) : null}
    {requests.length ? <div className={`office-part-overview${presentation === "one-page" ? " is-one-page" : ""}`}>
      <strong>{officeQueueText(requests, locale)}</strong>
    </div> : null}
    <div className={`part-request-list${presentation === "one-page" ? " is-one-page" : ""}`}>
      {requests.map((request) => (
        <div
          id={`part-request-${request.id}`}
          className={`part-request-focus-target${request.id === focusedRequestId ? " is-selected" : ""}`}
          ref={request.id === focusedRequestId ? focusedRequestRef : undefined}
          tabIndex={request.id === focusedRequestId ? -1 : undefined}
          aria-current={request.id === focusedRequestId ? "true" : undefined}
          aria-label={request.id === focusedRequestId ? `${t("parts.selectedRequest")} ${request.partNumber || request.description || ""}`.trim() : undefined}
          key={request.id}
        >
          <OfficeRequestCard request={request} detail={detail} onChanged={onChanged} />
        </div>
      ))}
    </div>
  </>;

  const partsMoreAction = presentation === "one-page" ? <MenuTrigger>
    <Button className="office-parts-more-trigger" aria-label="More Parts options">
      <DotsVertical aria-hidden="true" />
    </Button>
    <Popover className="office-parts-more-popover" placement="bottom end" offset={6}>
      <Menu aria-label="More Parts options">
        <MenuItem id="parts-supply" textValue="Parts & supply" onAction={() => setSupplyDialogOpen(true)}>
          Parts &amp; supply
        </MenuItem>
      </Menu>
    </Popover>
  </MenuTrigger> : null;

  return (
    <>
      <UsedPartsSection
        actorId={actorId}
        financialFooter={financialFooter}
        role="office"
        detail={detail}
        parts={parts}
        laborHours={laborHours}
        laborProduct={laborProduct}
        locationId={locationId}
        laborRepairOrder={laborRepairOrder}
        laborRepairOrderDisabled={laborRepairOrderDisabled}
        installedParts={installedParts}
        onLaborHoursChange={onLaborHoursChange}
        onLaborProductChange={onLaborProductChange}
        onLaborRepairOrderChange={onLaborRepairOrderChange}
        onPartsChange={onPartsChange}
        onSaveParts={onSaveParts}
        onChanged={onChanged}
        onRegisterSerializedRepairFlush={onRegisterSerializedRepairFlush}
        serializedParts={serializedParts}
        editable={usedPartsAccess.editable}
        laborEditable={laborEditable}
        headerAction={partsMoreAction}
        readonlyMessage={usedPartsAccess.message}
        suggestionsEnabled
        presentation={presentation}
      />
      {presentation === "one-page" ? (supplyDialogOpen ? <ModalFrame
        overlayClassName="office-parts-supply-overlay"
        modalClassName="office-parts-supply-modal"
        dialogClassName="office-parts-supply-dialog"
        ariaLabelledBy={supplyDialogTitleId}
        onOpenChange={(open) => setSupplyDialogOpen(open)}
      >
        <header className="office-parts-supply-dialog-header">
          <h2 id={supplyDialogTitleId}>Parts &amp; supply</h2>
          <Button onPress={() => setSupplyDialogOpen(false)}>Close</Button>
        </header>
        <div className="office-parts-supply-dialog-content">{partsSupplyContent}</div>
      </ModalFrame> : null) : <details className="compact-parts-labor" open><summary>Requests &amp; supply</summary>{partsSupplyContent}</details>}
    </>
  );
}
