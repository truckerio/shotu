import { useEffect, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SectionHelpDisclosure } from "../../components/workorders/SectionHelpDisclosure.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { api } from "../../lib/api.js";
import "./reuse-setup.css";

const actionLabels = { remove: "Record removal", receive: "Receive returned parts", route: "Inspect and route", release: "Inspect and release for reuse", repair: "Start or complete repair", disposition: "Confirm core return or scrap", quarantine: "Resolve quarantine" };

// Configuration is optional and separate from physical actions. No grants are implicit.
export function ReuseSetup({ companyId, locationId, onSaved }) {
  const policyRequestSequence = useRef(0);
  const policyRequestController = useRef(null);
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [userId, setUserId] = useState("");
  const [capabilities, setCapabilities] = useState([]);
  const [reason, setReason] = useState("");
  const [catalogPartId, setCatalogPartId] = useState("");
  const [catalogPartQuery, setCatalogPartQuery] = useState("");
  const [reuseAllowed, setReuseAllowed] = useState(false);
  const [repairAllowed, setRepairAllowed] = useState(false);
  const [coreReturnAllowed, setCoreReturnAllowed] = useState(false);
  const [scrapAllowed, setScrapAllowed] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

  useEffect(() => {
    policyRequestSequence.current += 1;
    policyRequestController.current?.abort();
    policyRequestController.current = null;
    setCatalogPartId(""); setCatalogPartQuery("");
    setReuseAllowed(false); setRepairAllowed(false); setCoreReturnAllowed(false); setScrapAllowed(false); setEvidence("");
    setBusy(false);
    return () => {
      policyRequestSequence.current += 1;
      policyRequestController.current?.abort();
      policyRequestController.current = null;
    };
  }, [companyId, locationId]);

  useEffect(() => {
    if (!open) return undefined;
    const controller = new AbortController();
    let active = true;
    setError("");
    setData(null);
    api(`/api/inventory-reuse/config?${new URLSearchParams({ companyId, locationId })}`, { signal: controller.signal })
      .then((result) => { if (active) setData(result); })
      .catch((failure) => { if (active) setError(failure.message); });
    return () => { active = false; controller.abort(); };
  }, [open, companyId, locationId, revision]);

  async function save(kind, body) {
    setBusy(true); setError(""); setMessage("");
    try {
      await api(`/api/inventory-reuse/config/${kind}`, { method: "POST", body: JSON.stringify({ companyId, locationId, ...body }) });
      setMessage("Settings saved.");
      setRevision((value) => value + 1);
      onSaved?.();
    } catch (failure) { setError(failure.message); }
    finally { setBusy(false); }
  }

  async function selectPolicyPart(part) {
    policyRequestController.current?.abort();
    const controller = new AbortController();
    policyRequestController.current = controller;
    const sequence = ++policyRequestSequence.current;
    setCatalogPartId(part.id);
    setCatalogPartQuery([part.partNumber, part.description].filter(Boolean).join(" · "));
    setReuseAllowed(false); setRepairAllowed(false); setCoreReturnAllowed(false); setScrapAllowed(false); setEvidence("");
    setBusy(true); setError(""); setMessage("");
    try {
      const result = await api(`/api/inventory-reuse/config?${new URLSearchParams({ companyId, locationId, catalogPartId: part.id })}`, { signal: controller.signal });
      if (sequence !== policyRequestSequence.current) return;
      const policy = result.policies.find((item) => item.catalogPartId === part.id);
      setReuseAllowed(policy?.reuseAllowed === true); setRepairAllowed(policy?.repairAllowed === true); setCoreReturnAllowed(policy?.coreReturnAllowed === true); setScrapAllowed(policy?.scrapAllowed === true); setEvidence(policy?.evidence || "");
    } catch (failure) { if (sequence === policyRequestSequence.current) setError(failure.message); }
    finally {
      if (sequence === policyRequestSequence.current) {
        policyRequestController.current = null;
        setBusy(false);
      }
    }
  }

  return <details className="reuse-setup" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Reuse permissions and part policy</summary>
    {error ? <div role="alert"><p>{error}</p>{!data ? <Button onClick={() => setRevision((value) => value + 1)}>Try again</Button> : null}</div> : null}
    {message ? <p role="status">{message}</p> : null}
    {!data && !error ? <p role="status">Loading settings…</p> : null}
    {data ? <>
      {data.possiblyTruncated ? <p role="status">The staff or saved-policy list is large. Search for the exact part below; ask your administrator if a staff member is missing.</p> : null}
      <form onSubmit={(event) => { event.preventDefault(); void save("grant", { userId, capabilities, reason }); }}>
        <div className="reuse-setup-heading"><h4>Staff permissions</h4><SectionHelpDisclosure label="About reuse permissions"><p>Choose who can handle returned parts at this location. The person removing a part cannot receive or approve its reuse. Changing settings does not change inventory.</p></SectionHelpDisclosure></div>
        <label>Staff member<Dropdown aria-label="Staff member" value={userId} onChange={(event) => {
          const id = event.target.value; setUserId(id);
          setCapabilities(data.staff.find((staff) => staff.id === id)?.capabilities || []);
        }} required disabled={busy}><option value="">Choose staff</option>{data.staff.map((staff) => <option key={staff.id} value={staff.id}>{staff.name} · {staff.role}</option>)}</Dropdown></label>
        <fieldset disabled={busy || !userId}><legend>Allowed actions</legend>{Object.entries(actionLabels).map(([action, label]) => <label className="reuse-setup-check" key={action}><input type="checkbox" checked={capabilities.includes(action)} onChange={(event) => setCapabilities((current) => event.target.checked ? [...current, action] : current.filter((item) => item !== action))} />{label}</label>)}</fieldset>
        <label>Reason<input value={reason} onChange={(event) => setReason(event.target.value)} required maxLength={2000} disabled={busy} /></label>
        <Button type="submit" disabled={busy || !userId || !reason.trim()}>Save permissions</Button>
      </form>
      <form onSubmit={(event) => { event.preventDefault(); void save("policy", { catalogPartId, reuseAllowed, repairAllowed, coreReturnAllowed, scrapAllowed, evidence }); }}>
        <div className="reuse-setup-heading"><h4>Part reuse policy</h4><SectionHelpDisclosure label="About part reuse policy"><p>Approve only parts your shop may safely reuse. Physical receipt and inspection are still required before a returned part becomes available.</p></SectionHelpDisclosure></div>
        <PartCatalogCombobox
          locationId={locationId}
          catalogEndpoint="/api/office/inventory/catalog"
          purpose="master_match"
          value={catalogPartQuery}
          onChange={(value) => {
            policyRequestSequence.current += 1;
            policyRequestController.current?.abort();
            policyRequestController.current = null;
            setCatalogPartQuery(value); setCatalogPartId("");
            setReuseAllowed(false); setRepairAllowed(false); setCoreReturnAllowed(false); setScrapAllowed(false); setEvidence("");
            setBusy(false);
          }}
          onSelect={(part) => { void selectPolicyPart(part); }}
          allowManualEntry={false}
          resultLimit={12}
          label="Part"
          inputAriaLabel="Part reuse policy"
          placeholder="Search part number or description"
          popupAriaLabel="Matching inventory parts"
          disabled={busy}
        />
        <label className="reuse-setup-check"><input type="checkbox" checked={reuseAllowed} onChange={(event) => setReuseAllowed(event.target.checked)} disabled={busy || !catalogPartId} />May be reused after inspection</label>
        <label className="reuse-setup-check"><input type="checkbox" checked={repairAllowed} onChange={(event) => setRepairAllowed(event.target.checked)} disabled={busy || !catalogPartId} />May be repaired or refurbished</label>
        <label className="reuse-setup-check"><input type="checkbox" checked={coreReturnAllowed} onChange={(event) => setCoreReturnAllowed(event.target.checked)} disabled={busy || !catalogPartId} />May be returned as a core</label>
        <label className="reuse-setup-check"><input type="checkbox" checked={scrapAllowed} onChange={(event) => setScrapAllowed(event.target.checked)} disabled={busy || !catalogPartId} />May be scrapped with approval</label>
        <label>Policy evidence<textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Manufacturer guidance or approved shop policy" required maxLength={2000} disabled={busy} /></label>
        <Button type="submit" disabled={busy || !catalogPartId || !evidence.trim()}>Save part policy</Button>
      </form>
    </> : null}
  </details>;
}
