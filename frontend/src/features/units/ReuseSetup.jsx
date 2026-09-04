import { useEffect, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { SectionHelpDisclosure } from "../../components/workorders/SectionHelpDisclosure.jsx";
import { api } from "../../lib/api.js";
import "./reuse-setup.css";

const actionLabels = { remove: "Record removal", receive: "Receive returned parts", release: "Inspect and release for reuse" };

// Configuration is optional and separate from physical actions. No grants are implicit.
export function ReuseSetup({ companyId, locationId, onSaved }) {
  const [open, setOpen] = useState(false);
  const [data, setData] = useState(null);
  const [revision, setRevision] = useState(0);
  const [userId, setUserId] = useState("");
  const [capabilities, setCapabilities] = useState([]);
  const [reason, setReason] = useState("");
  const [catalogPartId, setCatalogPartId] = useState("");
  const [reuseAllowed, setReuseAllowed] = useState(false);
  const [evidence, setEvidence] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [message, setMessage] = useState("");

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

  return <details className="reuse-setup" open={open} onToggle={(event) => setOpen(event.currentTarget.open)}>
    <summary>Reuse permissions and part policy</summary>
    {error ? <div role="alert"><p>{error}</p>{!data ? <Button onClick={() => setRevision((value) => value + 1)}>Try again</Button> : null}</div> : null}
    {message ? <p role="status">{message}</p> : null}
    {!data && !error ? <p role="status">Loading settings…</p> : null}
    {data ? <>
      {data.possiblyTruncated ? <p role="status">This setup list is limited to {data.limits?.staff || 200} staff and {data.limits?.parts || 500} parts. If your item is missing, ask your administrator before continuing.</p> : null}
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
      <form onSubmit={(event) => { event.preventDefault(); void save("policy", { catalogPartId, reuseAllowed, evidence }); }}>
        <div className="reuse-setup-heading"><h4>Part reuse policy</h4><SectionHelpDisclosure label="About part reuse policy"><p>Approve only parts your shop may safely reuse. Physical receipt and inspection are still required before a returned part becomes available.</p></SectionHelpDisclosure></div>
        <label>Part<Dropdown aria-label="Part reuse policy" value={catalogPartId} onChange={(event) => {
          const id = event.target.value; setCatalogPartId(id);
          const policy = data.policies.find((item) => item.catalogPartId === id);
          setReuseAllowed(policy?.reuseAllowed === true); setEvidence(policy?.evidence || "");
        }} required disabled={busy}><option value="">Choose a part</option>{data.parts.map((part) => <option key={part.id} value={part.id}>{part.partNumber} · {part.description}</option>)}</Dropdown></label>
        <label className="reuse-setup-check"><input type="checkbox" checked={reuseAllowed} onChange={(event) => setReuseAllowed(event.target.checked)} disabled={busy || !catalogPartId} />May be reused after inspection</label>
        <label>Policy evidence<textarea value={evidence} onChange={(event) => setEvidence(event.target.value)} placeholder="Manufacturer guidance or approved shop policy" required maxLength={2000} disabled={busy} /></label>
        <Button type="submit" disabled={busy || !catalogPartId || !evidence.trim()}>Save part policy</Button>
      </form>
    </> : null}
  </details>;
}
