import { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DraftLeaveDialog } from "../../components/drafts/index.js";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { PreviewPane } from "../../components/preview/PreviewPane.jsx";
import { CompactWorkorderPreview } from "../../components/workorders/CompactWorkorderPreview.jsx";
import { BrowserPrintDocument, PreviewFullscreen, PrintModal, WorkorderPreview } from "../generator/GeneratorUi.jsx";
import { CreateWorkorderForm } from "../generator/CreateWorkorderForm.jsx";
import { workorderTemplateStyles } from "../../../../shared/workorder-template.js";
import { useFocusedFieldVisibility } from "../../hooks/useFocusedFieldVisibility.js";
import { useVisualViewport } from "../../hooks/useVisualViewport.js";
import { interfaceText } from "../../i18n/index.js";
import { CreateWorkorderShell } from "./CreateWorkorderShell.jsx";
import { CustomerDirectoryField } from "./CustomerDirectoryField.jsx";
import { normalizedVehicleTagNames } from "../workorder-modules/unit/CreateUnitModule.jsx";
import {
  listCustomerContacts,
  listCustomers,
} from "./customer-directory-api.js";
import { customerSelectionPatch, selectedCustomer } from "./customer-contact-model.js";
import { CustomerDocumentReview } from "../customer-documents/CustomerDocumentReview.jsx";
import { CustomerEstimateDelivery } from "../customer-documents/CustomerEstimateDelivery.jsx";
import { CustomerDocumentDiscountEditor } from "../customer-documents/CustomerDocumentDiscountEditor.jsx";
import {
  activateAcceptedEstimate,
  createEstimateGrant,
  customerDocumentCommandKey,
  customerDocumentGrantLink,
  emptyCustomerDocumentAdjustments,
  issueDraftEstimate,
  previewDraftEstimate,
  readCustomerDocumentProfile,
  readCurrentDraftEstimate,
  readCustomerRevision,
  sendCustomerDocumentGrantEmail,
} from "../customer-documents/customer-estimate-api.js";
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
  createPricing,
  draftLeaveBusy,
  draftLeaveOpen,
  addPartRow,
  createOfficeWorkorder,
  discardDraftAndLeave,
  jumpToPreview,
  openOfficeWorkspace,
  openActiveUnitWorkorder,
  openFullscreenPreview,
  reloadOfficeLocations,
  removePartRow,
  replacePartSerializedUnits,
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
  const createPresentation = isMechanicCreate ? "panel" : "one-page";
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
  const [customerPreviewOpen, setCustomerPreviewOpen] = useState(false);
  const [customerProjection, setCustomerProjection] = useState(null);
  const [customerRevisionId, setCustomerRevisionId] = useState("");
  const [customerLink, setCustomerLink] = useState("");
  const [customerDocumentBusy, setCustomerDocumentBusy] = useState(false);
  const [customerActivationBusy, setCustomerActivationBusy] = useState(false);
  const [customerDocumentError, setCustomerDocumentError] = useState("");
  const [customerAdjustments, setCustomerAdjustments] = useState(() => emptyCustomerDocumentAdjustments());
  const [maximumOfficeDiscount, setMaximumOfficeDiscount] = useState(null);
  const [grantRecoveryRequired, setGrantRecoveryRequired] = useState(false);
  const [customerGrant, setCustomerGrant] = useState({ id: "", rawToken: "" });
  const [deliveryEmail, setDeliveryEmail] = useState("");
  const [deliveryState, setDeliveryState] = useState({ busy: false, status: "" });
  const [customerDirectory, setCustomerDirectory] = useState({ customers: [], loading: false, error: "" });
  const issueKeyRef = useRef("");
  const grantKeyRef = useRef("");
  const grantExpiresAtRef = useRef("");
  const deliveryKeyRef = useRef("");
  const recoveredDraftRef = useRef("");
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
  const hasWritableCreateModule = createSections.some((section) => section.id !== WORKORDER_MODULE_IDS.PREVIEW && section.modulePolicy?.canWrite);
  const pricingBlocksCreate = createPricing?.hasPriceableRows && !createPricing.complete;
  const authorizationClassification = form.authorizationClassification || "";
  const authorizationResolved = Boolean(authorizationClassification);
  const authorizationException = ["internal_fleet", "exempt"].includes(authorizationClassification);
  const authorizationExceptionReady = authorizationException && Boolean(form.authorizationExceptionReason?.trim());
  const canDirectCreate = authorizationResolved && authorizationClassification !== "required_external_customer" && (!authorizationException || authorizationExceptionReady);
  const canCreate = hasWritableCreateModule && !pricingBlocksCreate && canDirectCreate;
  const deferredPreviewSource = useDeferredValue(form);
  const previewForm = useMemo(
    () => createWorkorderPreviewForm(deferredPreviewSource, assignment),
    [assignment, deferredPreviewSource],
  );
  const selectedDocumentLocation = useMemo(() => officeLocations.find((location) => (location.id || location.location?.id) === form.locationId), [form.locationId, officeLocations]);
  const customerDocumentCompanyId = selectedDocumentLocation?.company_id || selectedDocumentLocation?.companyId || selectedDocumentLocation?.location?.company_id || selectedDocumentLocation?.location?.companyId || "";
  const directoryAvailable = ["office", "admin"].includes(actor.role) && Boolean(customerDocumentCompanyId);
  const selectedDirectoryCustomer = useMemo(() => selectedCustomer(customerDirectory.customers, form.customerAccountId), [customerDirectory.customers, form.customerAccountId]);
  const selectedDirectoryContact = useMemo(() => (selectedDirectoryCustomer?.contacts || []).find((contact) => String(contact.id) === String(form.customerContactId || "")) || null, [form.customerContactId, selectedDirectoryCustomer]);
  const vehicleCustomerSuggestions = useMemo(
    () => normalizedVehicleTagNames(selectedVehicle?.tag_names || selectedVehicle?.tagNames),
    [selectedVehicle?.tag_names, selectedVehicle?.tagNames],
  );
  const savedDraft = workorderDraft?.draft;
  const customerSourceReady = ["office", "admin"].includes(actor.role)
    && Boolean(customerDocumentCompanyId && form.locationId && savedDraft?.id)
    && Number.isInteger(savedDraft?.version) && savedDraft.version > 0
    && savedDraft.status === "active"
    && workorderDraft.status === "saved" && !workorderDraft.hasUnsyncedChanges;

  useEffect(() => {
    if (!directoryAvailable) { setCustomerDirectory({ customers: [], loading: false, error: "" }); return undefined; }
    let active = true;
    setCustomerDirectory((current) => ({ ...current, loading: true, error: "" }));
    listCustomers(customerDocumentCompanyId).then((customers) => {
      if (active) setCustomerDirectory({ customers, loading: false, error: "" });
    }).catch((error) => {
      if (active) setCustomerDirectory((current) => ({ ...current, loading: false, error: error.message || "Customers could not be loaded." }));
    });
    return () => { active = false; };
  }, [customerDocumentCompanyId, directoryAvailable]);

  useEffect(() => {
    if (!directoryAvailable || !selectedDirectoryCustomer?.id) return undefined;
    let active = true;
    listCustomerContacts({ companyId: customerDocumentCompanyId, customerId: selectedDirectoryCustomer.id }).then((contacts) => {
      if (!active) return;
      setCustomerDirectory((current) => ({ ...current, customers: current.customers.map((customer) => String(customer.id) === String(selectedDirectoryCustomer.id) ? { ...customer, contacts } : customer) }));
    }).catch((error) => {
      if (active) setCustomerDirectory((current) => ({ ...current, error: error.message || "Contacts could not be loaded." }));
    });
    return () => { active = false; };
  }, [customerDocumentCompanyId, directoryAvailable, selectedDirectoryCustomer?.id]);

  function updateCustomerSelection(patch) {
    Object.entries(patch).forEach(([field, value]) => updateField(field, value));
  }

  async function recoverCurrentDraftEstimate({ open = false } = {}) {
    if (!customerSourceReady) return false;
    try {
      const result = await readCurrentDraftEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, draftId: savedDraft.id });
      const revisionId = result.revision?.id;
      if (!revisionId) throw new Error("The saved Estimate could not be recovered.");
      setCustomerRevisionId(revisionId); setCustomerProjection(result.projection); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" }); setGrantRecoveryRequired(true);
      if (open) setCustomerPreviewOpen(true);
      return true;
    } catch (error) {
      if (error?.status === 404) return false;
      throw error;
    }
  }

  useEffect(() => {
    if (!customerSourceReady || recoveredDraftRef.current === savedDraft.id) return;
    let active = true;
    recoveredDraftRef.current = savedDraft.id;
    recoverCurrentDraftEstimate().catch((error) => {
      if (active) setCustomerDocumentError(error.message || "The saved Estimate could not be verified. Issuance is unavailable until it can be checked.");
    });
    return () => { active = false; };
  }, [customerDocumentCompanyId, customerSourceReady, form.locationId, savedDraft?.id]);

  useEffect(() => {
    if (!customerSourceReady) { setMaximumOfficeDiscount(null); return; }
    let active = true;
    readCustomerDocumentProfile({ companyId: customerDocumentCompanyId, locationId: form.locationId })
      .then((profile) => { if (active) setMaximumOfficeDiscount(profile?.discountPolicy?.maxOfficePercentage ?? null); })
      .catch(() => { if (active) setMaximumOfficeDiscount(null); });
    return () => { active = false; };
  }, [customerDocumentCompanyId, customerSourceReady, form.locationId]);

  function updateCustomerAdjustments(next) {
    setCustomerAdjustments(next);
    setCustomerDocumentError("");
    if (!customerRevisionId) {
      setCustomerProjection(null); setCustomerPreviewOpen(false); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" });
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = "";
    }
  }

  async function previewCustomerEstimate() {
    if (!customerSourceReady) {
      setCustomerDocumentError("Save a current draft with a configured commercial profile before previewing an Estimate.");
      return;
    }
    setCustomerDocumentBusy(true); setCustomerDocumentError("");
    try {
      if (customerRevisionId) {
        setCustomerPreviewOpen(true);
        return;
      }
      if (await recoverCurrentDraftEstimate({ open: true })) return;
      const projection = await previewDraftEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, draftId: savedDraft.id, expectedVersion: savedDraft.version, adjustments: customerAdjustments });
      setCustomerProjection(projection); setCustomerRevisionId(""); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" }); setGrantRecoveryRequired(false); issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = ""; setCustomerPreviewOpen(true);
    } catch (error) { setCustomerDocumentError(error.message || "The Estimate preview could not be validated."); } finally { setCustomerDocumentBusy(false); }
  }

  async function refreshCustomerRevision(revisionId = customerRevisionId) {
    if (!revisionId) return;
    setCustomerDocumentBusy(true); setCustomerDocumentError("");
    try { const result = await readCustomerRevision(revisionId); setCustomerProjection(result.projection); }
    catch (error) { setCustomerDocumentError(error.message || "The Estimate status could not be refreshed."); }
    finally { setCustomerDocumentBusy(false); }
  }

  async function createCustomerGrant(replacement = false, revisionId = customerRevisionId) {
    if (!revisionId) return;
    if (replacement) { grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = ""; setGrantRecoveryRequired(false); setDeliveryState({ busy: false, status: "" }); }
    grantKeyRef.current ||= customerDocumentCommandKey("estimate-grant");
    grantExpiresAtRef.current ||= new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
    const grant = await createEstimateGrant({ companyId: customerDocumentCompanyId, locationId: form.locationId, revisionId, idempotencyKey: grantKeyRef.current, expiresAt: grantExpiresAtRef.current });
    if (!grant.rawToken) {
      grantKeyRef.current = ""; grantExpiresAtRef.current = ""; setGrantRecoveryRequired(true);
      throw new Error("The Estimate was issued, but this grant replay cannot return its secret link. Create a replacement link before sharing; a prior link may be invalidated or revoked by the server.");
    }
    const grantId = grant.grantId || grant.id || grant.grant?.id;
    if (!grantId) throw new Error("The Estimate was issued, but the secure link cannot be emailed because its grant identifier is unavailable. Copy the link for manual delivery.");
    setCustomerLink(customerDocumentGrantLink(grant.rawToken));
    setCustomerGrant({ id: grantId, rawToken: grant.rawToken });
    setDeliveryEmail((current) => current || selectedDirectoryContact?.email || "");
  }

  async function sendEstimateEmail() {
    if (!customerGrant.id || !customerGrant.rawToken) return;
    setDeliveryState((current) => ({ ...current, busy: true }));
    try {
      deliveryKeyRef.current ||= customerDocumentCommandKey("estimate-email");
      const result = await sendCustomerDocumentGrantEmail({ companyId: customerDocumentCompanyId, locationId: form.locationId, grantId: customerGrant.id, rawToken: customerGrant.rawToken, recipientEmail: deliveryEmail.trim() || null, idempotencyKey: deliveryKeyRef.current });
      setDeliveryState({ busy: false, status: result.status || (result.providerAccepted ? "provider_accepted" : "requested") });
    } catch (error) {
      setDeliveryState({ busy: false, status: "failed" });
      setCustomerDocumentError(error.message || "Email failed—copy link instead.");
    }
  }

  async function issueCustomerEstimate() {
    if (!customerSourceReady || !customerProjection?.financialFingerprint) return;
    setCustomerDocumentBusy(true); setCustomerDocumentError("");
    try {
      if (!customerRevisionId && await recoverCurrentDraftEstimate({ open: true })) return;
      issueKeyRef.current ||= customerDocumentCommandKey("estimate-issue");
      const issued = customerRevisionId ? null : await issueDraftEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, draftId: savedDraft.id, expectedVersion: savedDraft.version, projection: customerProjection, adjustments: customerAdjustments, recipient: { customerId: form.customerAccountId || null, contactId: form.customerContactId || null, name: selectedDirectoryContact?.name || form.customerContactName || form.customerCompanyName || null, company: form.customerCompanyName || null, email: selectedDirectoryContact?.email || form.customerContactEmail || null, phone: selectedDirectoryContact?.phone || null }, idempotencyKey: issueKeyRef.current });
      const revisionId = customerRevisionId || issued?.revision?.id || issued?.id;
      if (!revisionId) throw new Error("The issued Estimate did not include a revision identifier.");
      setCustomerRevisionId(revisionId);
      await createCustomerGrant(false, revisionId);
      await refreshCustomerRevision(revisionId);
    } catch (error) { setCustomerDocumentError(error.message || "The Estimate could not be issued."); }
    finally { setCustomerDocumentBusy(false); }
  }

  async function createReplacementCustomerGrant() {
    setCustomerDocumentBusy(true); setCustomerDocumentError("");
    try { await createCustomerGrant(true); }
    catch (error) { setCustomerDocumentError(error.message || "The replacement customer link could not be created."); }
    finally { setCustomerDocumentBusy(false); }
  }

  async function copyCustomerLink() {
    try { await navigator.clipboard.writeText(customerLink); }
    catch { setCustomerDocumentError("Copy failed. Select and copy the customer link from the address bar."); }
  }

  async function activateCustomerEstimate() {
    if (!customerSourceReady || !customerRevisionId || customerProjection?.response?.status !== "accepted" || !customerProjection?.eligibility?.canActivate) return;
    setCustomerActivationBusy(true); setCustomerDocumentError("");
    try { await activateAcceptedEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, revisionId: customerRevisionId, expectedDraftVersion: savedDraft.version }); await refreshCustomerRevision(customerRevisionId); }
    catch (error) { setCustomerDocumentError(error.message || "The accepted Estimate could not be activated."); }
    finally { setCustomerActivationBusy(false); }
  }

  const customerDocumentAction = !isMechanicCreate ? <button className="button secondary" type="button" disabled={!customerSourceReady || customerDocumentBusy} onClick={previewCustomerEstimate}>{customerDocumentBusy ? "Loading Estimate…" : customerRevisionId ? "View estimate" : "Preview estimate"}</button> : null;
  const customerDiscountControl = !isMechanicCreate && !customerRevisionId ? <CustomerDocumentDiscountEditor
    adjustments={customerAdjustments}
    onChange={updateCustomerAdjustments}
    disabled={!customerSourceReady || customerDocumentBusy}
    inline
    maximumOfficePercentage={actor.role === "office" ? maximumOfficeDiscount : null}
  /> : null;
  const exceptionControls = actor.role === "admin" ? <details className="create-workorder-authorization-exceptions"><summary>Legacy authorization exceptions</summary><p>Use only for audited internal fleet or exempt work.</p><label>Exception path<Dropdown value={authorizationException ? authorizationClassification : "approval_not_required"} onChange={(event) => { updateField("authorizationClassification", event.target.value); updateField("authorizationExceptionReason", ""); }}><option value="approval_not_required">No exception</option><option value="internal_fleet">Internal fleet</option><option value="exempt">Exempt</option></Dropdown></label>{authorizationException ? <label>Exception reason<textarea required rows="3" value={form.authorizationExceptionReason || ""} onChange={(event) => updateField("authorizationExceptionReason", event.target.value)} /></label> : null}{authorizationException ? <p role="alert">This exception is audited and bypasses customer Estimate approval.</p> : null}</details> : null;
  const customerControl = directoryAvailable ? <CustomerDirectoryField
    customers={customerDirectory.customers}
    customerAccountId={form.customerAccountId}
    customerCompanyName={form.customerCompanyName}
    customerContactId={form.customerContactId}
    customerAddress={form.customerAddress}
    customerContactName={form.customerContactName}
    customerContactEmail={form.customerContactEmail}
    disabled={officeCreateState.busy}
    loading={customerDirectory.loading}
    error={officeCreateErrors?.customerCompanyName || customerDirectory.error}
    exceptionControls={exceptionControls}
    approvalClassification={authorizationClassification}
    suggestions={vehicleCustomerSuggestions}
    suggestionsLabel={t("create.unit.vehicleTags")}
    onApprovalChange={(askForApproval) => { updateField("authorizationClassification", askForApproval ? "required_external_customer" : "approval_not_required"); updateField("authorizationExceptionReason", ""); }}
    onNameChange={(name) => { updateField("customerCompanyName", name); if (selectedDirectoryCustomer && name !== selectedDirectoryCustomer.name) updateCustomerSelection({ customerAccountId: "", customerContactId: "", customerCompanyName: name }); }}
    onSelectionChange={updateCustomerSelection}
    onUnmatchedDetailsChange={updateCustomerSelection}
  /> : null;

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
            presentation={createPresentation}
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
            customerDocumentAction={customerDocumentAction}
          >
            {!createSections.length ? (
              <div className="mechanic-empty-state" role="status">
                <strong>{t("create.unavailable")}</strong>
                <span>{t("create.noWritableModules")}</span>
              </div>
            ) : null}
            <CreateWorkorderForm
              actorId={actor.id}
              actorRole={actor.role}
              assignment={assignment}
              busy={officeCreateState.busy}
              locale={isMechanicCreate ? locale : "en"}
              error={officeCreateState.error}
              errors={officeCreateErrors}
              errorFocusKey={officeCreateAttempt}
              errorFocusReady={errorFocusReady}
              form={form}
              createPricing={createPricing}
              locationLoadState={officeLocationsState}
              locations={officeLocations}
              message={createStatusMessage}
              onAddPart={addPartRow}
              onAssignmentChange={(mechanicUserIds) => setCreateAssignment((current) => ({ ...current, mechanicUserIds }))}
              onFieldChange={updateField}
              onLocationChange={selectOfficeLocation}
              onOpenActiveWorkorder={openActiveUnitWorkorder}
              onReloadLocations={reloadOfficeLocations}
              onPartChange={updatePart}
              onRemovePart={removePartRow}
              onReplacePartSerializedUnits={replacePartSerializedUnits}
              onSubmit={createOfficeWorkorder}
              onUnitChange={updateUnitNumber}
              onVehicleSelect={applyVehicle}
              customerControl={customerControl}
              customerDiscountControl={customerDiscountControl}
              canAssign={canAssign}
              mapsConfig={mapsConfig}
              mobileSection={activeSection}
              mobileScrollRef={mobileScrollRef}
              onErrorFocusTarget={ensureFocusedFieldVisible}
              presentation={createPresentation}
              selectedVehicle={selectedVehicle}
              sections={createSections.filter((section) => section.id !== WORKORDER_MODULE_IDS.PREVIEW)}
              vehicleLookup={vehicleLookup}
            />
            {customerDocumentError && !customerPreviewOpen ? <p role="alert">{customerDocumentError}</p> : null}
            {customerPreviewOpen && customerProjection ? <CustomerDocumentReview
              projection={customerProjection}
              onClose={() => setCustomerPreviewOpen(false)}
              issueAvailable={authorizationClassification === "required_external_customer"
                && customerSourceReady && !customerRevisionId && Boolean(customerProjection.financialFingerprint)}
              onIssue={issueCustomerEstimate}
              issueBusy={customerDocumentBusy}
              shareLink={customerLink}
              onCopyLink={copyCustomerLink}
              onCreateReplacementGrant={grantRecoveryRequired ? createReplacementCustomerGrant : undefined}
              onRefreshResponse={() => refreshCustomerRevision()}
              onActivate={activateCustomerEstimate}
              activateAvailable={customerSourceReady && Boolean(customerRevisionId) && customerProjection.response?.status === "accepted" && customerProjection.eligibility?.canActivate}
              activationBusy={customerActivationBusy}
              actionError={customerDocumentError}
              delivery={customerLink && customerGrant.id ? <CustomerEstimateDelivery
                email={deliveryEmail}
                status={deliveryState.status}
                busy={deliveryState.busy}
                onEmailChange={setDeliveryEmail}
                onSend={sendEstimateEmail}
              /> : null}
            /> : null}
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
