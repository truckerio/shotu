import { useEffect, useRef, useState } from "react";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { FormCard } from "../../../components/forms/FormCard.jsx";
import { FormField } from "../../../components/forms/FormField.jsx";
import { BusinessAddressField } from "../../../components/forms/BusinessAddressField.jsx";
import { ActionFooter } from "../../../components/forms/ActionFooter.jsx";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";
import { commercialProfileInitialScope } from "../../customer-documents/commercial-profile-navigation.js";
import { taxRequestKey } from "../commercial/tax-setup-model.js";
import { BUSINESS_MODES, setupDraft, usesCustomerBilling, businessSetupUrl } from "./business-setup-model.js";
import "./business-setup.css";

function SetupForm({ companyId, locationId, onOpenBilling, onSavingChange }) {
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [step, setStep] = useState(1);
  const [editing, setEditing] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [conflict, setConflict] = useState(false);
  const [reload, setReload] = useState(0);
  const pending = useRef(null);
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    const controller = new AbortController();
    setError(""); setConflict(false);
    api(`/api/admin/business-setup?${new URLSearchParams({ companyId, ...(locationId ? { locationId } : {}) })}`, { signal: controller.signal })
      .then(result => {
        if (controller.signal.aborted) return;
        setData(result); setDraft(setupDraft(result)); setStep(result.setup?.step || 1); setEditing(result.setup?.status !== "completed");
      }).catch(reason => { if (!controller.signal.aborted) setError(reason.message); });
    return () => controller.abort();
  }, [companyId, locationId, reload]);
  async function save(nextStep, status = "draft", exit = false) {
    if (busy || !draft) return;
    if (!draft.operatingMode) { setError("Choose who you maintain vehicles for."); return; }
    if ((status === "completed" || (step === 2 && nextStep === 3)) && (!draft.shopIdentity.legalName.trim() || !draft.shopIdentity.address.trim())) {
      setError("Enter your business name and address."); return;
    }
    const payload = { companyId, ...(locationId ? { locationId } : {}), expectedVersion: data.setup?.version || 0, ...draft, step: nextStep, status };
    pending.current = taxRequestKey(pending.current, payload, () => crypto.randomUUID());
    setBusy(true); onSavingChange(true); setError(""); setConflict(false);
    try {
      const result = await api("/api/admin/business-setup", { method: "PUT", body: JSON.stringify({ ...payload, idempotencyKey: pending.current.key }) });
      if (!active.current) return;
      pending.current = null; setData(result); setDraft(setupDraft(result)); setStep(nextStep); setEditing(status !== "completed");
      if (exit) window.location.assign("/?adminView=operations");
    } catch (reason) { if (active.current) { setError(reason.message); setConflict(reason.status === 409); } }
    finally { if (active.current) { setBusy(false); onSavingChange(false); } }
  }
  if (!draft) return <FormCard title="Business setup">{error ? <><p role="alert">{error}</p><Button onClick={() => setReload(value => value + 1)}>Retry setup</Button></> : <p role="status">Loading setup…</p>}</FormCard>;
  const customerBilling = usesCustomerBilling(draft.operatingMode);
  const identity = draft.shopIdentity;
  const updateIdentity = (key, value) => setDraft(valueDraft => ({ ...valueDraft, shopIdentity: { ...valueDraft.shopIdentity, [key]: value } }));
  if (!editing) return <FormCard title="Setup complete">
    <p role="status">Fleet maintenance ready.</p>
    <dl className="business-setup-summary"><dt>Business</dt><dd>{identity.legalName}</dd><dt>Work</dt><dd>{BUSINESS_MODES.find(mode => mode.id === draft.operatingMode)?.label}</dd></dl>
    {customerBilling ? <p role="status">{data.billing.ready ? "Customer billing ready." : "Customer billing not set up. You can finish it later."}</p> : null}
    <ActionFooter><Button onClick={() => { setEditing(true); setStep(1); }}>Edit setup</Button>{customerBilling && !data.billing.ready ? <Button onClick={() => onOpenBilling(companyId, locationId)}>Set up billing</Button> : null}<Button variant="primary" onClick={() => window.location.assign("/?adminView=operations")}>Open workorders</Button></ActionFooter>
  </FormCard>;
  return <FormCard title={step === 1 ? "Who do you maintain vehicles for?" : step === 2 ? "Business details" : "Customer billing"} description={`Step ${step} of ${customerBilling || !draft.operatingMode ? 3 : 2}`}>
    <form className="operational-form business-setup-form" onSubmit={event => { event.preventDefault(); if (step === 1) save(2); else if (step === 2) save(customerBilling ? 3 : 2, customerBilling ? "draft" : "completed"); else save(3, "completed"); }}>
      <fieldset disabled={busy} className="business-setup-fields">
        {step === 1 ? <FormField label="Maintenance work"><Dropdown aria-label="Maintenance work" value={draft.operatingMode} onChange={event => setDraft(value => ({ ...value, operatingMode: event.target.value }))}><option value="">Choose an option</option>{BUSINESS_MODES.map(mode => <option value={mode.id} key={mode.id}>{mode.label}</option>)}</Dropdown></FormField> : null}
        {step === 2 ? <div className="operational-form-grid">
          <FormField label="Business name" required><input value={identity.legalName} onChange={event => updateIdentity("legalName", event.target.value)} maxLength={300} /></FormField>
          <BusinessAddressField value={identity.address} onChange={value => updateIdentity("address", value)} scope={companyId} request={api} disabled={busy} />
          <details><summary>Contact details (optional)</summary><div className="operational-form-grid business-setup-contact"><FormField label="Phone"><input type="tel" value={identity.phone} onChange={event => updateIdentity("phone", event.target.value)} maxLength={100} /></FormField><FormField label="Email"><input type="email" value={identity.email} onChange={event => updateIdentity("email", event.target.value)} maxLength={320} /></FormField></div></details>
        </div> : null}
        {step === 3 ? <div><p>{data.billing.ready ? "Customer billing ready. Your saved document and tax settings are unchanged." : "Set up customer documents and tax when you are ready to bill outside customers."}</p><Button type="button" onClick={() => onOpenBilling(companyId, locationId)}>{data.billing.ready ? "Review billing settings" : "Set up billing"}</Button><p className="business-setup-note">You can keep managing maintenance while billing setup is pending.</p></div> : null}
        {error ? <p role="alert">{error}</p> : null}{conflict ? <Button type="button" onClick={() => setReload(value => value + 1)}>Reload saved setup</Button> : null}
        <ActionFooter message={busy ? "Saving…" : ""}>
          {step > 1 ? <Button type="button" onClick={() => save(step - 1)}>Back</Button> : null}
          <Button type="button" disabled={!draft.operatingMode} onClick={() => save(step, "draft", true)}>Save and exit</Button>
          <Button type="submit" variant="primary" disabled={!draft.operatingMode}>{step === 2 && !customerBilling ? "Finish setup" : step === 3 ? (data.billing.ready ? "Finish setup" : "Set up later") : "Continue"}</Button>
        </ActionFooter>
      </fieldset>
    </form>
  </FormCard>;
}

export function BusinessSetupPage({ locations = [], onOpenBilling }) {
  const scope = commercialProfileInitialScope(locations, window.location.search);
  const [companyId, setCompanyId] = useState(scope.companyId);
  const [saving, setSaving] = useState(false);
  useEffect(() => { if (!companyId && scope.companyId) { setCompanyId(scope.companyId); setRequestedLocation(scope.locationId); } }, [companyId, scope.companyId, scope.locationId]);
  const companies = [...new Map(locations.map(location => [location.company_id || location.companyId, location.company_name || location.companyName || "Company"])).entries()];
  const companyLocations = locations.filter(location => (location.company_id || location.companyId) === companyId);
  const [requestedLocation, setRequestedLocation] = useState(scope.locationId);
  const locationId = companyLocations.some(location => location.id === requestedLocation) ? requestedLocation : "";
  function selectScope(nextCompanyId, nextLocationId = "") {
    const nextLocation = nextLocationId;
    setCompanyId(nextCompanyId); setRequestedLocation(nextLocation);
    window.history.replaceState(window.history.state, "", businessSetupUrl(nextCompanyId, nextLocation));
  }
  useEffect(() => {
    const syncScope = () => {
      const next = commercialProfileInitialScope(locations, window.location.search);
      setCompanyId(next.companyId); setRequestedLocation(next.locationId); setSaving(false);
    };
    window.addEventListener("popstate", syncScope);
    return () => window.removeEventListener("popstate", syncScope);
  }, [locations]);
  return <section className="admin-content business-setup-page" aria-label="Business setup workspace">
    <PageHeader title="Business setup" subtitle="A few details to get your shop or fleet ready." />
    {companies.length > 1 || companyLocations.length > 0 ? <div className="business-setup-scope">{companies.length > 1 ? <FormField label="Company"><Dropdown aria-label="Setup company" value={companyId} disabled={saving} onChange={event => selectScope(event.target.value)}>{companies.map(([id, name]) => <option key={id} value={id}>{name}</option>)}</Dropdown></FormField> : null}{companyLocations.length > 0 ? <FormField label="Location"><Dropdown aria-label="Setup location" value={locationId} disabled={saving} onChange={event => selectScope(companyId, event.target.value)}><option value="">All locations</option>{companyLocations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></FormField> : null}</div> : null}
    {companyId && !locationId ? <p className="business-setup-note">Company-wide setup. Billing defaults apply to all locations unless a location has its own settings.</p> : null}
    {companyId ? <SetupForm key={`${companyId}:${locationId}`} companyId={companyId} locationId={locationId} onOpenBilling={onOpenBilling} onSavingChange={setSaving} /> : <FormCard title="Add a location first"><p>Create your first location to start business setup.</p><Button onClick={() => window.location.assign("/?adminView=locations")}>Open locations</Button></FormCard>}
  </section>;
}
