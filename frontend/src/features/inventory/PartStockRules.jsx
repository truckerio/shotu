import { useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";

export function PartStockRules({ part, onSaved }) {
  const [editing, setEditing] = useState("");
  const [draft, setDraft] = useState({ minimum: "", target: "", enabled: true });
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  function edit(location) {
    setEditing(location.locationId);
    setDraft({
      minimum: location.minimumAvailable ?? "",
      target: location.targetQuantity ?? "",
      enabled: location.policyVersion ? location.alertEnabled !== false : true,
    });
    setMessage("");
  }

  async function save(location) {
    const minimumAvailable = Number(draft.minimum);
    const targetQuantity = draft.target === "" ? null : Number(draft.target);
    if (!Number.isFinite(minimumAvailable) || minimumAvailable < 0 || (targetQuantity !== null && targetQuantity < minimumAvailable)) {
      setMessage("Enter a minimum of zero or more. Target must be at least the minimum.");
      return;
    }
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/office/inventory/parts/${encodeURIComponent(part.catalogPartId)}/stock-rule`, {
        method: "PATCH",
        body: JSON.stringify({ locationId: location.locationId, expectedVersion: location.policyVersion ?? null, minimumAvailable, targetQuantity, alertEnabled: draft.enabled }),
      });
      setEditing("");
      onSaved?.();
    } catch (error) { setMessage(error.message || "Stock rule could not be saved."); }
    finally { setBusy(false); }
  }

  return <div className="inventory-stock-rules">
    {message ? <p role="alert" className="ops-error">{message}</p> : null}
    {part.locations.map((location) => <section key={location.locationId} className={location.lowStock ? "is-low" : ""}>
      <header><div><strong>{location.locationName}</strong><small>{location.lowStock ? "Minimum reached" : location.policyVersion ? "Stock alert configured" : "No minimum set"}</small></div>{editing !== location.locationId ? <Button type="button" onClick={() => edit(location)}>Set rule</Button> : null}</header>
      {editing === location.locationId ? <div className="inventory-stock-rule-form">
        <label><span>Minimum available</span><input type="number" min="0" step="any" value={draft.minimum} onChange={(event) => setDraft((value) => ({ ...value, minimum: event.target.value }))} disabled={busy} /></label>
        <label><span>Target quantity</span><input type="number" min="0" step="any" placeholder="Optional" value={draft.target} onChange={(event) => setDraft((value) => ({ ...value, target: event.target.value }))} disabled={busy} /></label>
        <label className="inventory-stock-rule-toggle"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft((value) => ({ ...value, enabled: event.target.checked }))} disabled={busy} /><span>Notify Office when minimum is reached</span></label>
        <div><Button type="button" onClick={() => setEditing("")} disabled={busy}>Cancel</Button><Button type="button" variant="primary" onClick={() => save(location)} disabled={busy}>{busy ? "Saving" : "Save rule"}</Button></div>
      </div> : location.policyVersion ? <p>{location.minimumAvailable} {part.uomCode} minimum{location.targetQuantity === null ? "" : ` · ${location.targetQuantity} ${part.uomCode} target`}</p> : null}
    </section>)}
  </div>;
}
