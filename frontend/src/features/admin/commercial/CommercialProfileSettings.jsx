import { useEffect, useMemo, useState } from "react";
import { Dropdown } from "../../../components/forms/Dropdown.jsx";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";
import { CustomerDocumentRenderer } from "../../customer-documents/CustomerDocumentRenderer.jsx";
import { customerDocumentProjection } from "../../customer-documents/customer-document-model.js";
import { CustomerDocumentReports } from "./CustomerDocumentReports.jsx";
import "./commercial-profile.css";

function commandKey() { return globalThis.crypto?.randomUUID?.() || `commercial-${Date.now()}-${Math.random()}`; }
function companiesFrom(locations) { return [...new Map(locations.map((l) => [l.company_id || l.companyId, l.company_name || l.companyName || "Company"]).filter(([id]) => id)).entries()].map(([id, name]) => ({ id, name })); }
const TAX_TYPES = [["labor", "Labor"], ["part", "Parts"], ["shop_supply", "Shop supplies"], ["fee", "Fees"], ["core_charge", "Core charges"], ["credit", "Credits"]];
function blank() { return { legalName: "", tradeName: "", address: "", phone: "", email: "", registrationIdentifiers: {}, logoUrl: "", accentColor: "", estimateTerms: "", invoiceTerms: "", warrantyTerms: "", footerTerms: "", authorizationText: "", currency: "USD", taxProfileVersionId: "", maxOfficePercentage: "0", lineTaxPolicy: {}, estimatePrefix: "EST-", estimateDigits: "6", invoicePrefix: "INV-", invoiceDigits: "6", estimateValidityDays: "", expectedVersion: 0, profileId: null }; }
function fromProfile(profile = {}) { const identity = profile.shopIdentity || {}; const terms = profile.documentTerms || {}; const discount = profile.discountPolicy || {}; const numbering = profile.documentNumbering || {}; return { ...blank(), legalName: identity.legalName || "", tradeName: identity.tradeName || "", address: identity.address || "", phone: identity.phone || "", email: identity.email || "", registrationIdentifiers: identity.registrationIdentifiers || {}, logoUrl: identity.logoUrl || "", accentColor: identity.accentColor || "", estimateTerms: terms.estimate || "", invoiceTerms: terms.invoice || "", warrantyTerms: terms.warranty || "", footerTerms: terms.footer || "", authorizationText: profile.authorizationText || "", currency: profile.defaultCurrency || "USD", taxProfileVersionId: profile.taxProfileVersionId || "", maxOfficePercentage: discount.maxOfficePercentage || "0", lineTaxPolicy: profile.lineTaxPolicy || {}, estimatePrefix: numbering.estimate?.prefix || "EST-", estimateDigits: String(numbering.estimate?.digits || 6), invoicePrefix: numbering.invoice?.prefix || "INV-", invoiceDigits: String(numbering.invoice?.digits || 6), estimateValidityDays: profile.estimateValidityDays == null ? "" : String(profile.estimateValidityDays), expectedVersion: profile.version || 0, profileId: profile.profileId || profile.profile_id || null }; }

function ProfileSection({ title, summary, required = false, initiallyOpen = false, children }) {
  return <details className="commercial-profile-section" open={initiallyOpen}>
    <summary><span><h2>{title}</h2><small>{summary}</small></span>{required ? <span className="commercial-profile-required">Required</span> : null}</summary>
    <div className="commercial-profile-section-fields">{children}</div>
  </details>;
}

export function CommercialProfileSettings({ locations = [] }) {
  const companies = useMemo(() => companiesFrom(locations), [locations]);
  const [companyId, setCompanyId] = useState(""); const [locationId, setLocationId] = useState(""); const [draft, setDraft] = useState(blank); const [state, setState] = useState("loading"); const [error, setError] = useState(""); const [message, setMessage] = useState("");
  useEffect(() => { if (!companyId && companies[0]) setCompanyId(companies[0].id); }, [companies, companyId]);
  useEffect(() => { if (!companyId) { setState("blocked"); return; } let active = true; setState("loading"); setError(""); const params = new URLSearchParams({ companyId, ...(locationId ? { locationId } : {}) }); api(`/api/customer-documents/profile?${params}`).then(({ profile }) => { if (active) { setDraft(fromProfile(profile)); setState("ready"); } }).catch((reason) => { if (!active) return; if (reason.status === 404) { setDraft(blank()); setState("ready"); } else { setError(reason.message || "Commercial profile could not be loaded."); setState("error"); } }); return () => { active = false; }; }, [companyId, locationId]);
  const update = (key, value) => setDraft((current) => ({ ...current, [key]: value }));
  const validDiscount = /^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/.test(draft.maxOfficePercentage.trim());
  const validDigits = (value) => /^([4-9]|1[0-2])$/.test(value);
  const validValidityDays = !draft.estimateValidityDays || /^(?:[1-9]|[1-9]\d|[12]\d{2}|3[0-5]\d|36[0-5])$/.test(draft.estimateValidityDays);
  const missing = !companyId || !draft.legalName.trim() || !draft.authorizationText.trim() || !draft.taxProfileVersionId.trim() || !validDiscount || !draft.estimatePrefix.trim() || !draft.invoicePrefix.trim() || !validDigits(draft.estimateDigits) || !validDigits(draft.invoiceDigits) || !validValidityDays || TAX_TYPES.some(([key]) => !draft.lineTaxPolicy[key]);
  async function publish(event) { event.preventDefault(); if (missing) return; setState("saving"); setError(""); try { const result = await api("/api/admin/customer-document-profiles", { method: "POST", body: JSON.stringify({ companyId, locationId: locationId || null, profileId: draft.profileId, expectedVersion: draft.expectedVersion, shopIdentity: { legalName: draft.legalName.trim(), tradeName: draft.tradeName.trim() || null, address: draft.address.trim() || null, phone: draft.phone.trim() || null, email: draft.email.trim() || null, registrationIdentifiers: draft.registrationIdentifiers, logoUrl: draft.logoUrl.trim() || null, accentColor: draft.accentColor.trim() || null }, documentTerms: { estimate: draft.estimateTerms, invoice: draft.invoiceTerms, warranty: draft.warrantyTerms, footer: draft.footerTerms }, authorizationText: draft.authorizationText.trim(), discountPolicy: { maxOfficePercentage: draft.maxOfficePercentage.trim(), reasonRequired: true }, lineTaxPolicy: draft.lineTaxPolicy, documentNumbering: { estimate: { prefix: draft.estimatePrefix.trim(), digits: Number(draft.estimateDigits) }, invoice: { prefix: draft.invoicePrefix.trim(), digits: Number(draft.invoiceDigits) } }, estimateValidityDays: draft.estimateValidityDays ? Number(draft.estimateValidityDays) : null, defaultCurrency: draft.currency, taxProfileVersionId: draft.taxProfileVersionId.trim(), idempotencyKey: commandKey() }) }); setDraft(fromProfile(result.profileVersion || result.profile)); setState("ready"); setMessage("Commercial profile published. Existing documents keep their original version."); } catch (reason) { setState("error"); setError(reason.message || "Commercial profile could not be published."); } }
  const projection = customerDocumentProjection({ document: { type: "estimate", state: "draft_projection" }, shop: { legalName: draft.legalName || "Your shop", tradeName: draft.tradeName || null, phone: draft.phone || null }, customer: { name: "Customer" }, unit: { label: "Unit" }, lines: [], totals: { currency: draft.currency, subtotal: "0", discountTotal: "0", tax: "0", total: "0" }, terms: draft.estimateTerms, authorizationText: draft.authorizationText });
  const scopeLocations = locations.filter((location) => (location.company_id || location.companyId) === companyId);
  const taxMissing = !draft.taxProfileVersionId.trim() || TAX_TYPES.some(([key]) => !draft.lineTaxPolicy[key]);
  const numberingMissing = !draft.estimatePrefix.trim() || !draft.invoicePrefix.trim() || !validDigits(draft.estimateDigits) || !validDigits(draft.invoiceDigits) || !validValidityDays;
  const busy = state === "loading" || state === "saving";
  return (
    <section className="commercial-profile-settings">
      <PageHeader title="Customer commercial profile" actions={
        <Button variant="primary" type="submit" form="commercial-profile-form" disabled={missing || state === "loading" || state === "saving"}>
          {state === "saving" ? "Publishing…" : "Publish profile"}
        </Button>
      } />
      {error ? <p role="alert">{error}</p> : null}
      {message ? <p role="status">{message}</p> : null}
      <div className="commercial-profile-scope">
        {companies.length > 1 ? <label>Company<Dropdown value={companyId} onChange={(event) => { setCompanyId(event.target.value); setLocationId(""); }}>{companies.map((company) => <option key={company.id} value={company.id}>{company.name}</option>)}</Dropdown></label> : null}
        <label>Location<Dropdown value={locationId} onChange={(event) => setLocationId(event.target.value)}><option value="">Company default</option>{scopeLocations.map((location) => <option key={location.id || location.location?.id} value={location.id || location.location?.id}>{location.name || location.location?.name}</option>)}</Dropdown></label>
      </div>
      <div className="commercial-profile-grid">
        <form id="commercial-profile-form" onSubmit={publish} aria-busy={busy}
          onInvalidCapture={(event) => event.target.closest("details")?.setAttribute("open", "")}>
          <ProfileSection title="Shop details" summary={draft.tradeName || draft.legalName || "Not configured"} required={!draft.legalName.trim()} initiallyOpen>
            <label>Legal name<input required value={draft.legalName} onChange={(event) => update("legalName", event.target.value)} /></label>
            <label>Trade name<input value={draft.tradeName} onChange={(event) => update("tradeName", event.target.value)} /></label>
            <label>Address<textarea rows="2" value={draft.address} onChange={(event) => update("address", event.target.value)} /></label>
            <label>Phone<input type="tel" value={draft.phone} onChange={(event) => update("phone", event.target.value)} /></label>
            <label>Email<input type="email" value={draft.email} onChange={(event) => update("email", event.target.value)} /></label>
          </ProfileSection>
          <ProfileSection title="Tax" summary={taxMissing ? "Not configured" : "6 line types configured"} required={taxMissing}>
            <label>Tax profile version<input required value={draft.taxProfileVersionId} onChange={(event) => update("taxProfileVersionId", event.target.value)} /></label>
            {TAX_TYPES.map(([key, label]) => <label key={key}>{label}<Dropdown value={draft.lineTaxPolicy[key] || ""} onChange={(event) => update("lineTaxPolicy", { ...draft.lineTaxPolicy, [key]: event.target.value })}><option value="">Unconfigured — choose before publishing</option>{(key === "credit" ? ["zero_rated", "exempt", "out_of_scope"] : ["exclusive", "inclusive", "zero_rated", "exempt", "out_of_scope"]).map((value) => <option key={value} value={value}>{value.replaceAll("_", " ")}</option>)}</Dropdown></label>)}
          </ProfileSection>
          <ProfileSection title="Pricing" summary={`${draft.currency} · Discount limit ${draft.maxOfficePercentage}%`} required={!validDiscount}>
            <label>Currency<input required value={draft.currency} maxLength="3" onChange={(event) => update("currency", event.target.value.toUpperCase())} /></label>
            <label>Maximum office discount %<input required inputMode="decimal" value={draft.maxOfficePercentage} aria-invalid={!validDiscount} onChange={(event) => update("maxOfficePercentage", event.target.value)} /></label>
          </ProfileSection>
          <ProfileSection title="Document numbering" summary={`${draft.estimatePrefix} / ${draft.invoicePrefix}`} required={numberingMissing}>
            <fieldset className="commercial-profile-numbering"><legend>Estimate</legend>
              <label>Prefix<input required maxLength="20" value={draft.estimatePrefix} onChange={(event) => update("estimatePrefix", event.target.value)} /></label>
              <label>Digits<input required inputMode="numeric" value={draft.estimateDigits} onChange={(event) => update("estimateDigits", event.target.value)} /></label>
            </fieldset>
            <fieldset className="commercial-profile-numbering"><legend>Invoice</legend>
              <label>Prefix<input required maxLength="20" value={draft.invoicePrefix} onChange={(event) => update("invoicePrefix", event.target.value)} /></label>
              <label>Digits<input required inputMode="numeric" value={draft.invoiceDigits} onChange={(event) => update("invoiceDigits", event.target.value)} /></label>
            </fieldset>
            <label>Estimate validity (days)<input inputMode="numeric" placeholder="No expiry" value={draft.estimateValidityDays} aria-invalid={!validValidityDays} onChange={(event) => update("estimateValidityDays", event.target.value)} /></label>
          </ProfileSection>
          <ProfileSection title="Document text" summary={draft.authorizationText.trim() ? "Authorization configured" : "Authorization required"} required={!draft.authorizationText.trim()}>
            <label>Authorization<textarea required rows="3" value={draft.authorizationText} onChange={(event) => update("authorizationText", event.target.value)} /></label>
            <label>Estimate terms<textarea rows="3" value={draft.estimateTerms} onChange={(event) => update("estimateTerms", event.target.value)} /></label>
            <label>Invoice terms<textarea rows="3" value={draft.invoiceTerms} onChange={(event) => update("invoiceTerms", event.target.value)} /></label>
            <label>Warranty terms<textarea rows="3" value={draft.warrantyTerms} onChange={(event) => update("warrantyTerms", event.target.value)} /></label>
            <label>Footer<textarea rows="3" value={draft.footerTerms} onChange={(event) => update("footerTerms", event.target.value)} /></label>
          </ProfileSection>
          {missing ? <p className="commercial-profile-feedback" role="status">Complete the sections marked Required.</p> : null}
        </form>
        <aside><h2>Document preview</h2><CustomerDocumentRenderer projection={projection} compact /></aside>
      </div>
      <details className="commercial-profile-reports"><summary>Documents</summary><CustomerDocumentReports companyId={companyId} locationId={locationId} /></details>
    </section>
  );
}
