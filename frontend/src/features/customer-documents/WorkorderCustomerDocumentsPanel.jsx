import { useEffect, useState } from "react";
import { DotsVertical } from "@untitledui/icons";
import { Button as AriaButton, Menu, MenuItem, MenuTrigger, Popover } from "react-aria-components";
import { Button } from "../../components/ui/Button.jsx";
import { CustomerDocumentReview } from "./CustomerDocumentReview.jsx";
import { CustomerDocumentDiscountEditor } from "./CustomerDocumentDiscountEditor.jsx";
import { revisionProjection, useWorkorderCustomerDocuments } from "./useWorkorderCustomerDocuments.js";
import { commercialProfileSetupUrl } from "./commercial-profile-navigation.js";
import { WorkorderCustomerLink } from "./WorkorderCustomerLink.jsx";
import { downloadCustomerDocument, printCustomerDocument } from "./customer-document-export.js";
import "./workorder-customer-documents.css";

export function WorkorderCustomerDocumentsPanel(props) {
  return props.controller ? <DocumentsBody {...props} controller={props.controller} /> : <StandaloneDocuments {...props} />;
}
function StandaloneDocuments(props) {
  const controller = useWorkorderCustomerDocuments(props);
  return <DocumentsBody {...props} controller={controller} />;
}
function DocumentsBody({ companyId, locationId, workorderId, actorRole, canWrite = false, controller }) {
  const { projection, previewType, adjustments, busy, error, setError, refresh, preview, issue, updateAdjustments, estimate, invoice, reconciliation, canPreviewInvoice, canPreviewRevision, selectIssuedDocument } = controller;
  const [editing, setEditing] = useState(false);
  const [menuContainer, setMenuContainer] = useState(null);
  useEffect(() => { setEditing(false); }, [workorderId]);
  useEffect(() => { if (!previewType) setEditing(false); }, [previewType]);
  const needsUpdate = !invoice && (controller.discountRevisionRequired || controller.summary?.estimateChanges?.requiresUpdate === true);
  const sourceDirty = controller.sourceDirty === true;
  const [exportBusy, setExportBusy] = useState(false);
  async function download() {
    if (!projection || exportBusy) return;
    setExportBusy(true);
    try { await downloadCustomerDocument(previewType ? controller.exportRequest : { revisionId: projection.revisionId }, { projection }); }
    catch (error) { setError(error.message); }
    finally { setExportBusy(false); }
  }
  function print() { try { printCustomerDocument(projection); } catch (error) { setError(error.message); } }
  const selectedType = projection?.type || "estimate";
  const response = projection?.response?.status || "pending";
  const displayedApprovalRequired = projection?.revisionId === estimate?.id ? controller.summary?.approvalRequired : null;
  const status = previewType ? "Preview" : selectedType === "invoice" ? "Issued" : ({ pending: displayedApprovalRequired === false ? "No approval required" : displayedApprovalRequired == null ? "Approval unavailable" : "Awaiting approval", accepted: "Accepted", changes_requested: "Changes requested", declined: "Declined", rejected: "Declined", not_required: "No approval required", not_applicable: "No approval required" }[response] || response.replaceAll("_", " "));
  const issueAvailable = canWrite && Boolean(previewType && projection?.financialFingerprint && (previewType !== "invoice" || canPreviewInvoice));
  const beginUpdate = () => { if (sourceDirty) { setError("Save changes before reviewing the estimate."); return; } setEditing(true); };
  return <section ref={setMenuContainer} className="workorder-customer-documents" aria-label="Workorder documents">
    <header className="workorder-document-toolbar">
      <div role="group" aria-label="Document type" className="workorder-document-types">
        <button type="button" aria-pressed={selectedType === "estimate"} disabled={busy || !estimate} onClick={() => { selectIssuedDocument("estimate"); setEditing(false); }}>Estimate</button>
        {invoice ? <button type="button" aria-pressed={selectedType === "invoice"} disabled={busy} onClick={() => { selectIssuedDocument("invoice"); setEditing(false); }}>Invoice</button> : null}
      </div>
      {projection ? <span className="workorder-document-status">{status}</span> : null}
      {projection ? <div className="workorder-document-export"><button type="button" onClick={print}>Print</button><button type="button" disabled={busy || exportBusy || (previewType && !controller.exportRequest)} onClick={download}>{exportBusy ? "Preparing…" : "Download PDF"}</button></div> : null}
      <MenuTrigger>
        <AriaButton type="button" className="workorder-document-more" aria-label="More document options" isDisabled={busy}><DotsVertical aria-hidden="true" /></AriaButton>
        <Popover UNSTABLE_portalContainer={menuContainer || undefined} className="workorder-document-menu-popover" placement="bottom end">
          <Menu aria-label="Document options" className="workorder-document-menu">
            <MenuItem id="refresh" onAction={refresh}>Refresh</MenuItem>
            {canWrite && canPreviewRevision && !needsUpdate ? <MenuItem id="update" onAction={beginUpdate}>Update estimate</MenuItem> : null}
          </Menu>
        </Popover>
      </MenuTrigger>
    </header>
    {sourceDirty ? <p role="status">Save changes to update estimate</p> : null}
    {needsUpdate && !sourceDirty ? <div className="workorder-document-notice" role="status"><span>Estimate needs updating</span>{canWrite && canPreviewRevision && !editing && !previewType ? <button type="button" disabled={busy} onClick={beginUpdate}>Update estimate</button> : null}</div> : null}
    {error ? <p role="alert" className="workorder-customer-document-error">{error}</p> : null}
    {error && controller.errorCode === "CUSTOMER_DOCUMENT_PROFILE_UNAVAILABLE" ? actorRole === "admin"
      ? <p><a href={commercialProfileSetupUrl(companyId, locationId)} target="_blank" rel="noopener noreferrer" aria-label="Create profile (opens in new tab)">Create profile</a></p>
      : <p>Ask an Admin to create the commercial profile.</p> : null}
    <div className="workorder-document-scroll" role="region" aria-label="Document preview" tabIndex={0}>
      {!projection ? <p className="workorder-document-empty" role="status">{busy ? "Loading document…" : "No Estimate issued."}</p> : null}
      {editing && canWrite && canPreviewRevision ? <section className="workorder-customer-document-revision" aria-label="Update estimate">
        <CustomerDocumentDiscountEditor adjustments={adjustments} onChange={updateAdjustments} disabled={busy || !controller.canAdjustDiscount} maximumOfficePercentage={controller.maximumOfficePercentage} />
        <Button variant="secondary" type="button" onClick={() => preview("estimate")} disabled={busy}>Review revised Estimate</Button>
      </section> : null}
      {projection && !previewType && projection.lines?.length === 0 ? <p className="workorder-document-empty">This issued estimate has no line items. Review an updated estimate from the saved Workorder.</p> : null}
      {projection ? <CustomerDocumentReview minimal projection={projection} previousRevision={previewType === "estimate" ? revisionProjection(estimate) : null} /> : null}
    </div>
    {(previewType || canWrite) ? <footer className="workorder-document-footer">
      {canWrite && !previewType && estimate ? <WorkorderCustomerLink key={`${companyId}:${locationId}:${workorderId}`} companyId={companyId} locationId={locationId} workorderId={workorderId} recipientEmail={projection?.customer?.email || ""} disabled={busy || sourceDirty} /> : null}
      {previewType && estimate ? <Button variant="secondary" type="button" disabled={busy} onClick={() => { selectIssuedDocument("estimate"); setEditing(false); }}>Back to Estimate</Button> : null}
      {canWrite && previewType ? <Button variant="primary" type="button" onClick={issue} disabled={busy || !issueAvailable}>{busy ? "Issuing…" : previewType === "invoice" ? "Issue final Invoice" : "Issue revised Estimate"}</Button> : null}
      {canWrite && canPreviewInvoice && previewType !== "invoice" ? <Button variant="primary" type="button" onClick={() => preview("invoice")} disabled={busy}>Review Invoice</Button> : null}
    </footer> : null}
  </section>;
}
