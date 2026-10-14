import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { DraftLeaveDialog } from "../../components/drafts/index.js";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { CreateWorkorderForm } from "../generator/CreateWorkorderForm.jsx";
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
import { DocumentsPanel } from "../customer-documents/DocumentsPanel.jsx";
import {
  customerDocumentAdjustmentsFromForm,
  customerEstimateActionPending,
  customerEstimateErrorMessage,
  customerEstimateSourceKey,
  isCurrentCustomerEstimateRequest,
  recoveredEstimateMatchesSavedDraft,
} from "./customer-estimate-state.js";
import {
  activateAcceptedEstimate,
  createEstimateGrant,
  customerDocumentCommandKey,
  customerDocumentGrantLink,
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
import {
  resolveWorkorderModulePolicy,
  WORKORDER_MODULE_IDS,
  WORKORDER_SURFACES,
} from "../workorder-modules/workorder-module-registry.js";
import "./create-workorder-page.css";

export function CreateWorkorderPage({
  actor,
  assignment,
  form,
  formRef,
  isPhone,
  locale = "en",
  locationPolicy,
  mapsConfig,
  officeCreateAttempt,
  officeCreateErrors,
  officeCreateState,
  officeLocations,
  officeLocationsState,
  selectedVehicle,
  vehicleLookup,
  workorderDraft,
  createPricing,
  draftLeaveBusy,
  draftLeaveOpen,
  addPartRow,
  createOfficeWorkorder,
  discardDraftAndLeave,
  openOfficeWorkspace,
  openActiveUnitWorkorder,
  reloadOfficeLocations,
  removePartRow,
  replacePartSerializedUnits,
  saveDraftAndLeave,
  setCreateAssignment,
  setDraftLeaveOpen,
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
  const customerEstimateRequestRef = useRef(0);
  const customerEstimateSourceRef = useRef("");
  const customerEstimateWasPreviewedRef = useRef(false);
  const refreshCustomerEstimateRef = useRef(false);
  const lastDraftIdRef = useRef("");
  const mobileScrollRef = useRef(null);
  const viewport = useVisualViewport();
  const keyboardOpen = viewport.keyboardOpen;
  const createSections = useMemo(
    () => buildCreateWorkorderSections({
      canAssign,
      policyOverrides: locationPolicy,
      role: actor.role,
      userId: actor.id,
    }).map((section) => ({
      ...section,
      label: interfaceText(locale, `create.section.${section.id}`),
    })),
    [actor.id, actor.role, canAssign, locale, locationPolicy],
  );
  const hasWritableCreateModule = createSections.some((section) => section.modulePolicy?.canWrite);
  const pricingBlocksCreate = createPricing?.hasPriceableRows && !createPricing.complete;
  const authorizationClassification = form.authorizationClassification || "";
  const authorizationResolved = Boolean(authorizationClassification);
  const authorizationException = ["internal_fleet", "exempt"].includes(authorizationClassification);
  const authorizationExceptionReady = authorizationException && Boolean(form.authorizationExceptionReason?.trim());
  const canDirectCreate = authorizationResolved && authorizationClassification !== "required_external_customer" && (!authorizationException || authorizationExceptionReady);
  const canCreate = hasWritableCreateModule && !pricingBlocksCreate && canDirectCreate;
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
  const customerAdjustments = useMemo(
    () => customerDocumentAdjustmentsFromForm(form.customerDocumentAdjustments),
    [form.customerDocumentAdjustments],
  );
  const customerEstimateKey = useMemo(() => customerEstimateSourceKey({
    companyId: customerDocumentCompanyId,
    locationId: form.locationId,
    draft: savedDraft,
    adjustments: customerAdjustments,
    ready: customerSourceReady,
  }), [customerAdjustments, customerDocumentCompanyId, customerSourceReady, form.locationId, savedDraft?.id, savedDraft?.version]);

  useLayoutEffect(() => {
    const priorKey = customerEstimateSourceRef.current;
    const priorDraftId = lastDraftIdRef.current;
    const nextDraftId = savedDraft?.id || "";
    customerEstimateSourceRef.current = customerEstimateKey;
    lastDraftIdRef.current = nextDraftId;
    if (!priorKey || priorKey === customerEstimateKey) return;
    customerEstimateRequestRef.current += 1;
    setCustomerDocumentBusy(false);
    const switchedDraft = priorDraftId !== nextDraftId;
    refreshCustomerEstimateRef.current ||= Boolean(customerEstimateWasPreviewedRef.current && !customerRevisionId && !switchedDraft);
    if (switchedDraft) {
      recoveredDraftRef.current = "";
      customerEstimateWasPreviewedRef.current = false;
      refreshCustomerEstimateRef.current = false;
      setCustomerRevisionId(""); setCustomerProjection(null); setCustomerPreviewOpen(false); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" }); setGrantRecoveryRequired(false);
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = "";
    } else if (!customerRevisionId) {
      customerEstimateWasPreviewedRef.current = false;
      setCustomerProjection(null); setCustomerPreviewOpen(false); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" });
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = "";
    }
  }, [customerEstimateKey, customerRevisionId, customerSourceReady, savedDraft?.id]);

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

  async function recoverCurrentDraftEstimate({ open = false, requestKey = customerEstimateKey } = {}) {
    if (!customerSourceReady) return false;
    try {
      const result = await readCurrentDraftEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, draftId: savedDraft.id });
      if (!isCurrentCustomerEstimateRequest(requestKey, customerEstimateSourceRef.current)) return false;
      const revisionId = result.revision?.id;
      if (!revisionId) throw new Error("The saved Estimate could not be recovered.");
      if (!recoveredEstimateMatchesSavedDraft({ revision: result.revision, draft: savedDraft, adjustments: customerAdjustments })) {
        throw new Error("The saved draft changed since issued estimate. The issued Estimate remains unchanged; preview the current draft before issuing a new Estimate.");
      }
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
    recoverCurrentDraftEstimate({ requestKey: customerEstimateKey }).catch((error) => {
      if (active) setCustomerDocumentError(customerEstimateErrorMessage(error, "The saved Estimate could not be verified. Issuance is unavailable until it can be checked."));
    });
    return () => { active = false; };
  }, [customerDocumentCompanyId, customerEstimateKey, customerSourceReady, form.locationId, savedDraft?.id]);

  useEffect(() => {
    if (!customerSourceReady) { setMaximumOfficeDiscount(null); return; }
    let active = true;
    readCustomerDocumentProfile({ companyId: customerDocumentCompanyId, locationId: form.locationId })
      .then((profile) => { if (active) setMaximumOfficeDiscount(profile?.discountPolicy?.maxOfficePercentage ?? null); })
      .catch(() => { if (active) setMaximumOfficeDiscount(null); });
    return () => { active = false; };
  }, [customerDocumentCompanyId, customerSourceReady, form.locationId]);

  function updateCustomerAdjustments(next) {
    updateField("customerDocumentAdjustments", customerDocumentAdjustmentsFromForm(next));
    setCustomerDocumentError("");
    if (!customerRevisionId) {
      setCustomerProjection(null); setCustomerPreviewOpen(false); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" });
      issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = "";
    }
  }

  async function previewCustomerEstimate({ open = true } = {}) {
    if (open) setCustomerPreviewOpen(true);
    if (!customerSourceReady) {
      setCustomerDocumentError("Save a current draft with a configured commercial profile before previewing an Estimate.");
      return;
    }
    const requestKey = customerEstimateKey;
    const requestId = ++customerEstimateRequestRef.current;
    setCustomerDocumentBusy(true); setCustomerDocumentError("");
    try {
      if (customerRevisionId) {
        if (open) setCustomerPreviewOpen(true);
        return;
      }
      if (await recoverCurrentDraftEstimate({ open, requestKey })) return;
      const projection = await previewDraftEstimate({ companyId: customerDocumentCompanyId, locationId: form.locationId, draftId: savedDraft.id, expectedVersion: savedDraft.version, adjustments: customerAdjustments });
      if (requestId !== customerEstimateRequestRef.current || !isCurrentCustomerEstimateRequest(requestKey, customerEstimateSourceRef.current)) return;
      customerEstimateWasPreviewedRef.current = true;
      setCustomerProjection(projection); setCustomerRevisionId(""); setCustomerLink(""); setCustomerGrant({ id: "", rawToken: "" }); setDeliveryState({ busy: false, status: "" }); setGrantRecoveryRequired(false); issueKeyRef.current = ""; grantKeyRef.current = ""; grantExpiresAtRef.current = ""; deliveryKeyRef.current = ""; if (open) setCustomerPreviewOpen(true);
    } catch (error) {
      if (requestId === customerEstimateRequestRef.current && isCurrentCustomerEstimateRequest(requestKey, customerEstimateSourceRef.current)) setCustomerDocumentError(customerEstimateErrorMessage(error, "The Estimate preview could not be validated."));
    } finally {
      if (requestId === customerEstimateRequestRef.current && isCurrentCustomerEstimateRequest(requestKey, customerEstimateSourceRef.current)) setCustomerDocumentBusy(false);
    }
  }

  useEffect(() => {
    if (!customerSourceReady || customerRevisionId || !refreshCustomerEstimateRef.current) return;
    refreshCustomerEstimateRef.current = false;
    previewCustomerEstimate({ open: false });
  }, [customerEstimateKey, customerRevisionId, customerSourceReady]);

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

  const estimateActionPending = customerEstimateActionPending({ busy: customerDocumentBusy, draft: savedDraft, draftStatus: workorderDraft?.status });
  const estimateActionLabel = customerRevisionId ? "View estimate" : "Review estimate";
  const customerDocumentAction = !isMechanicCreate ? <button className={`button secondary customer-estimate-preview-action${estimateActionPending ? " is-loading" : ""}`} type="button" disabled={!customerSourceReady || customerDocumentBusy} aria-busy={estimateActionPending} aria-label={estimateActionPending ? `${estimateActionLabel}, loading` : estimateActionLabel} onClick={() => previewCustomerEstimate()}><span>{estimateActionLabel}</span></button> : null;
  const customerDiscountControl = !isMechanicCreate && !customerRevisionId ? <CustomerDocumentDiscountEditor
    adjustments={customerAdjustments}
    projection={customerProjection}
    onChange={updateCustomerAdjustments}
    disabled={!["office", "admin"].includes(actor.role) || Boolean(customerRevisionId) || Boolean(savedDraft && savedDraft.status !== "active") || customerDocumentBusy}
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
    resetMobileScroll();
  }, [errorSection, isPhone, officeCreateAttempt]);

  useEffect(() => {
    if (createSections.some((section) => section.id === activeSection)) return;
    setActiveSection(createSections[0]?.id || "location");
  }, [activeSection, createSections]);

  function dismissKeyboard() {
    const activeElement = document.activeElement;
    if (typeof activeElement?.blur === "function") activeElement.blur();
  }

  function resetMobileScroll() {
    window.requestAnimationFrame(() => {
      window.scrollTo({ top: 0, left: 0, behavior: "auto" });
      mobileScrollRef.current?.scrollTo?.({ top: 0, left: 0, behavior: "auto" });
    });
  }

  function selectMobileSection(section) {
    dismissKeyboard();
    setActiveSection(section);
    resetMobileScroll();
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
            previewOpen={customerPreviewOpen}
            presentation={createPresentation}
            sectionPreferenceKey={`workorder.sectionOrder.v1:${actor.id}:${actor.role}:create`}
            sections={createSections}
            workorderDraft={workorderDraft}
            supportingPane={<DocumentsPanel
              open={customerPreviewOpen}
              onClose={() => setCustomerPreviewOpen(false)}
            >
              {customerDocumentBusy && !customerProjection ? <p role="status">Preparing document…</p> : null}
              {customerDocumentError ? <p role="alert">{customerDocumentError}</p> : null}
              {customerProjection ? <>
                {authorizationClassification === "approval_not_required" ? <p role="status">This Estimate is created with the Workorder; manual issuance is not required.</p> : null}
                <CustomerDocumentReview
                  projection={customerProjection}
                  issueAvailable={authorizationClassification === "required_external_customer"
                    && customerSourceReady && !customerRevisionId && Boolean(customerProjection.financialFingerprint)}
                  onIssue={authorizationClassification === "required_external_customer" ? issueCustomerEstimate : undefined}
                  issueBusy={customerDocumentBusy}
                  shareLink={customerLink}
                  onCopyLink={copyCustomerLink}
                  onCreateReplacementGrant={grantRecoveryRequired ? createReplacementCustomerGrant : undefined}
                  onRefreshResponse={() => refreshCustomerRevision()}
                  onActivate={activateCustomerEstimate}
                  activateAvailable={customerSourceReady && Boolean(customerRevisionId) && customerProjection.response?.status === "accepted" && customerProjection.eligibility?.canActivate}
                  activationBusy={customerActivationBusy}
                  delivery={customerLink && customerGrant.id ? <CustomerEstimateDelivery
                    email={deliveryEmail}
                    status={deliveryState.status}
                    busy={deliveryState.busy}
                    onEmailChange={setDeliveryEmail}
                    onSend={sendEstimateEmail}
                  /> : null}
                />
              </> : null}
            </DocumentsPanel>}
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
              customerEstimateProjection={customerRevisionId ? null : customerProjection}
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
              sections={createSections}
              vehicleLookup={vehicleLookup}
            />
            {customerDocumentError && !customerPreviewOpen ? <p role="alert">{customerDocumentError}</p> : null}
      </CreateWorkorderShell>
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
