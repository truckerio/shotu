import { useMemo, useState } from "react";
import { CheckCircle, Plus, SearchMd, Trash01 } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { UsedPartsEditor } from "./UsedPartsEditor.jsx";

const SOURCE_LABELS = {
  inventory: "Inventory",
  purchase: "Purchase",
  transfer: "Transfer",
  customer_supplied: "Customer supplied",
  mechanic_supplied: "Mechanic supplied",
  unknown: "Decide later",
};

const ALLOCATION_STATUS_LABELS = {
  proposed: "Planned",
  reserved: "Reserved",
  issued: "Issued",
  ordered: "Ordered",
  received: "Received",
  transferred: "Transferred",
  installed: "Installed",
  returned: "Returned",
  cancelled: "Cancelled",
};

const APPROVAL_LABELS = {
  submitted: "Waiting for office",
  needs_info: "Needs information",
  approved: "Approved",
  rejected: "Rejected",
  cancelled: "Cancelled",
};

const emptyDraft = () => ({
  query: "",
  partNumber: "",
  manufacturer: "",
  description: "",
  category: "",
  quantity: "",
  repairOrder: "",
  fitmentStatus: "unknown",
  fitmentNotes: "",
});

function vehicleInput(detail) {
  const asset = detail.workorder.asset || {};
  return {
    assetId: asset.id || detail.workorder.assetId || undefined,
    unitNo: asset.unitNo || asset.name || "",
    vin: asset.vin || detail.workorder.formData?.vinNo || "",
    make: asset.make || "",
    model: asset.model || detail.workorder.formData?.model || "",
    year: asset.year || undefined,
    engine: asset.engine || detail.workorder.formData?.engine || "",
    engineSerial: asset.engineSerial || detail.workorder.formData?.engineSerial || "",
  };
}

function purchasingLocation(detail) {
  const name = detail.workorder.location?.name || "Chino";
  return {
    country: "US",
    city: name.replace(/\s+yard$/i, "") || "Chino",
    region: "CA",
    timezone: "America/Los_Angeles",
  };
}

function statusText(value) {
  return String(value || "").replaceAll("_", " ");
}

function RequestSummary({ request }) {
  return (
    <div className="part-request-summary">
      <div>
        <strong>{request.partNumber || request.description || request.rawQuery}</strong>
        <span>{[request.manufacturer, request.description].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="part-request-meta">
        <span>Qty {request.quantity}</span>
        <span className={`part-state part-state-${request.approvalStatus}`}>{APPROVAL_LABELS[request.approvalStatus] || statusText(request.approvalStatus)}</span>
      </div>
    </div>
  );
}

function MechanicRequestCard({ request, detail, onChanged }) {
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  async function updateUsage(usageStatus) {
    setBusy(true);
    setMessage("");
    try {
      await api(`/api/mechanic/workorders/${detail.workorder.id}/parts/${request.id}/usage`, {
        method: "PATCH",
        body: JSON.stringify({ usageStatus }),
      });
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <article className="part-request-card">
      <RequestSummary request={request} />
      {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
      {request.decisionReason ? <p className="part-request-note">{request.decisionReason}</p> : null}
      {request.allocations.length ? (
        <div className="part-allocation-list">
          {request.allocations.map((allocation) => (
            <span key={allocation.id}>{SOURCE_LABELS[allocation.sourceType]} · {allocation.quantity} · {ALLOCATION_STATUS_LABELS[allocation.status]}</span>
          ))}
        </div>
      ) : null}
      {request.approvalStatus === "approved" ? (
        <label className="part-usage-control">
          Usage
          <select value={request.usageStatus} onChange={(event) => updateUsage(event.target.value)} disabled={busy}>
            <option value="not_issued">Not issued</option>
            <option value="issued">Issued</option>
            <option value="partially_installed">Partially installed</option>
            <option value="installed">Installed</option>
            <option value="not_used">Not used</option>
            <option value="returned">Returned</option>
            <option value="damaged">Damaged</option>
          </select>
        </label>
      ) : null}
      {message ? <p className="part-request-error">{message}</p> : null}
    </article>
  );
}

function AllocationEditor({ allocations, setAllocations, quantity, inventory }) {
  function update(index, field, value) {
    setAllocations((current) => current.map((allocation, allocationIndex) => (
      allocationIndex === index ? { ...allocation, [field]: value } : allocation
    )));
  }

  function add() {
    setAllocations((current) => [...current, { sourceType: "unknown", status: "proposed", quantity: 1, vendor: "" }]);
  }

  function remove(index) {
    setAllocations((current) => current.length <= 1 ? current : current.filter((_, allocationIndex) => allocationIndex !== index));
  }

  return (
    <div className="allocation-editor">
      <div className="allocation-editor-head">
        <strong>Supply</strong>
        <button type="button" onClick={add} title="Split supply source" aria-label="Add supply source"><Plus /></button>
      </div>
      {allocations.map((allocation, index) => (
        <div className="allocation-row" key={index}>
          <select value={allocation.sourceType} onChange={(event) => {
            const sourceType = event.target.value;
            update(index, "sourceType", sourceType);
            update(index, "status", sourceType === "inventory" ? "reserved" : "proposed");
            if (sourceType === "inventory" && inventory[0]) {
              update(index, "inventoryItemId", inventory[0].id);
              update(index, "locationId", inventory[0].locationId);
            }
          }} aria-label={`Supply source ${index + 1}`}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
          <input type="number" min="1" max={quantity} value={allocation.quantity} onChange={(event) => update(index, "quantity", Number(event.target.value) || 1)} aria-label={`Supply quantity ${index + 1}`} />
          {allocation.sourceType === "purchase" ? (
            <input value={allocation.vendor || ""} onChange={(event) => update(index, "vendor", event.target.value)} placeholder="Vendor optional" aria-label={`Vendor ${index + 1}`} />
          ) : <span className="allocation-source-status">{ALLOCATION_STATUS_LABELS[allocation.status]}</span>}
          <button type="button" onClick={() => remove(index)} disabled={allocations.length <= 1} title="Remove supply source" aria-label="Remove supply source"><Trash01 /></button>
        </div>
      ))}
    </div>
  );
}

function OfficeRequestCard({ request, detail, onChanged }) {
  const firstInventory = request.inventory.find((item) => item.quantityAvailable > 0);
  const [form, setForm] = useState({
    partNumber: request.partNumber,
    manufacturer: request.manufacturer,
    description: request.description,
    category: request.category,
    quantity: request.quantity,
    repairOrder: request.repairOrder,
    fitmentStatus: request.fitmentStatus,
    fitmentNotes: request.fitmentNotes,
    reason: "",
  });
  const [allocations, setAllocations] = useState([firstInventory ? {
    sourceType: "inventory",
    status: "reserved",
    quantity: Math.min(request.quantity, firstInventory.quantityAvailable),
    inventoryItemId: firstInventory.id,
    locationId: firstInventory.locationId,
    vendor: "",
  } : { sourceType: "unknown", status: "proposed", quantity: request.quantity, vendor: "" }]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [pricing, setPricing] = useState(null);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  async function decide(decision) {
    setBusy(decision);
    setMessage("");
    try {
      await api(`/api/office/workorders/${detail.workorder.id}/parts/${request.id}/decision`, {
        method: "POST",
        body: JSON.stringify({
          decision,
          ...form,
          allocations: decision === "approved" ? allocations : [],
        }),
      });
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function updateAllocation(allocation, status) {
    setBusy(allocation.id);
    setMessage("");
    try {
      await api(`/api/office/workorders/${detail.workorder.id}/parts/${request.id}/allocations/${allocation.id}`, {
        method: "PATCH",
        body: JSON.stringify({ status }),
      });
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function findPrices() {
    setBusy("prices");
    setMessage("");
    try {
      const result = await api("/api/parts-helper/live-prices", {
        method: "POST",
        body: JSON.stringify({
          partNumber: request.partNumber,
          manufacturer: request.manufacturer,
          description: request.description,
          quantity: request.quantity,
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      setPricing(result);
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  const pending = ["submitted", "needs_info"].includes(request.approvalStatus);
  return (
    <article className="part-request-card office-part-request-card">
      <RequestSummary request={request} />
      {pending ? (
        <>
          <div className="part-office-fields">
            <label>Part number<input value={form.partNumber} onChange={(event) => update("partNumber", event.target.value)} /></label>
            <label>Quantity<input type="number" min="1" max="999" value={form.quantity} onChange={(event) => update("quantity", Number(event.target.value) || 1)} /></label>
            <label className="part-field-wide">Description<input value={form.description} onChange={(event) => update("description", event.target.value)} /></label>
            <label className="part-field-wide">Repair order<input value={form.repairOrder} onChange={(event) => update("repairOrder", event.target.value)} /></label>
            <label>Fitment
              <select value={form.fitmentStatus} onChange={(event) => update("fitmentStatus", event.target.value)}>
                <option value="unknown">Not verified</option>
                <option value="possible">Possible</option>
                <option value="confirmed">Confirmed</option>
                <option value="conflict">Conflict</option>
              </select>
            </label>
            <label>Reason / question<input value={form.reason} onChange={(event) => update("reason", event.target.value)} placeholder="Required for reject or question" /></label>
          </div>
          <div className="inventory-summary">
            {request.inventory.length ? request.inventory.map((item) => (
              <span key={item.id}><strong>{item.quantityAvailable}</strong> available · {item.locationName || "Inventory"}{item.binLocation ? ` · ${item.binLocation}` : ""}</span>
            )) : <span>Inventory is not tracked for this part yet.</span>}
          </div>
          <AllocationEditor allocations={allocations} setAllocations={setAllocations} quantity={form.quantity} inventory={request.inventory} />
          <div className="part-decision-actions">
            <Button variant="primary" onClick={() => decide("approved")} disabled={Boolean(busy)}>{busy === "approved" ? "Approving" : "Approve"}</Button>
            <button type="button" onClick={() => decide("needs_info")} disabled={Boolean(busy)}>Ask mechanic</button>
            <button type="button" onClick={() => decide("rejected")} disabled={Boolean(busy)}>Reject</button>
          </div>
        </>
      ) : (
        <>
          {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
          {request.allocations.length ? (
            <div className="part-allocation-list office-allocation-list">
              {request.allocations.map((allocation) => (
                <label key={allocation.id}>
                  <span>{SOURCE_LABELS[allocation.sourceType]} · Qty {allocation.quantity}</span>
                  <select value={allocation.status} onChange={(event) => updateAllocation(allocation, event.target.value)} disabled={busy === allocation.id}>
                    {Object.entries(ALLOCATION_STATUS_LABELS).map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                  </select>
                </label>
              ))}
            </div>
          ) : null}
          {request.approvalStatus === "approved" && request.allocations.some((allocation) => ["purchase", "unknown"].includes(allocation.sourceType)) ? (
            <button className="part-price-button" type="button" onClick={findPrices} disabled={busy === "prices"}>
              <SearchMd /> {busy === "prices" ? "Searching current prices" : "Find current prices"}
            </button>
          ) : null}
          {pricing?.listings?.length ? (
            <div className="part-price-results">
              {pricing.listings.slice(0, 3).map((listing) => (
                <a href={listing.url} target="_blank" rel="noreferrer" key={listing.url}>
                  <span>{listing.vendor}</span>
                  <strong>${listing.itemPrice.toFixed(2)}</strong>
                </a>
              ))}
            </div>
          ) : null}
        </>
      )}
      {message ? <p className="part-request-error">{message}</p> : null}
    </article>
  );
}

function OfficePartComposer({ detail, onChanged }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(emptyDraft);
  const [sourceType, setSourceType] = useState("inventory");
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");

  function update(field, value) {
    setDraft((current) => ({ ...current, [field]: value }));
  }

  async function identify() {
    setBusy("identify");
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({ query: draft.query, vehicle: vehicleInput(detail), location: purchasingLocation(detail) }),
      });
      setDraft((current) => ({
        ...current,
        partNumber: result.part.normalizedPartNumber || current.query,
        manufacturer: result.part.manufacturer,
        description: result.part.description,
        category: result.part.category,
        quantity: result.part.suggestedQuantity || 1,
        repairOrder: result.part.repairOrder,
        fitmentStatus: result.part.fitmentStatus,
        fitmentNotes: result.part.evidenceSummary,
      }));
      setMessage("Candidate filled. Office remains responsible for fitment.");
    } catch (error) {
      setMessage(`${error.message} Manual entry remains available.`);
      if (!draft.partNumber) update("partNumber", draft.query);
    } finally {
      setBusy("");
    }
  }

  async function addPart() {
    setBusy("submit");
    setMessage("");
    try {
      await api(`/api/office/workorders/${detail.workorder.id}/parts`, {
        method: "POST",
        body: JSON.stringify({
          ...draft,
          allocations: [{
            sourceType,
            status: sourceType === "inventory" ? "reserved" : "proposed",
            quantity: draft.quantity,
          }],
        }),
      });
      setDraft(emptyDraft());
      setOpen(false);
      await onChanged();
    } catch (error) {
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  if (!open) {
    return <Button onClick={() => setOpen(true)}><Plus /> Add office part</Button>;
  }

  return (
    <div className="office-add-part">
      <div className="office-add-part-head">
        <strong>Add approved part</strong>
        <button type="button" onClick={() => setOpen(false)}>Cancel</button>
      </div>
      <label>
        Part number or description
        <div className="part-search-control">
          <input value={draft.query} onChange={(event) => update("query", event.target.value)} placeholder="Part number or description" />
          <button type="button" onClick={identify} disabled={draft.query.trim().length < 2 || Boolean(busy)}><SearchMd /> {busy === "identify" ? "Finding" : "Find"}</button>
        </div>
      </label>
      <div className="part-suggestion-fields">
        <label>Part number<input value={draft.partNumber} onChange={(event) => update("partNumber", event.target.value)} /></label>
        <label>Qty<input type="number" min="1" max="999" value={draft.quantity} onChange={(event) => update("quantity", event.target.value === "" ? "" : Number(event.target.value))} /></label>
        <label className="part-field-wide">Description<input value={draft.description} onChange={(event) => update("description", event.target.value)} /></label>
        <label className="part-field-wide">Repair order<input value={draft.repairOrder} onChange={(event) => update("repairOrder", event.target.value)} /></label>
        <label>Fitment
          <select value={draft.fitmentStatus} onChange={(event) => update("fitmentStatus", event.target.value)}>
            <option value="unknown">Not verified</option>
            <option value="possible">Possible</option>
            <option value="confirmed">Confirmed</option>
            <option value="conflict">Conflict</option>
          </select>
        </label>
        <label>Supply
          <select value={sourceType} onChange={(event) => setSourceType(event.target.value)}>
            {Object.entries(SOURCE_LABELS).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
          </select>
        </label>
      </div>
      <Button variant="primary" onClick={addPart} disabled={draft.query.trim().length < 2 || Number(draft.quantity) < 1 || Boolean(busy)}>{busy === "submit" ? "Adding" : "Add approved part"}</Button>
      {message ? <p className="part-request-message" role="status">{message}</p> : null}
    </div>
  );
}

export function PartRequestsPanel({ role, detail, parts, onPartsChange, onSaveParts, onChanged }) {
  const requests = detail.partRequests || [];
  const reviewCount = useMemo(() => requests.filter((request) => request.approvalStatus === "submitted").length, [requests]);
  const clarificationCount = useMemo(() => requests.filter((request) => request.approvalStatus === "needs_info").length, [requests]);
  const officeQueueText = [
    reviewCount ? `${reviewCount} request${reviewCount === 1 ? "" : "s"} need review` : "",
    clarificationCount ? `${clarificationCount} waiting for mechanic` : "",
  ].filter(Boolean).join(" · ") || "No pending part requests";

  return (
    <div className="part-requests-panel">
      <UsedPartsEditor
        detail={detail}
        parts={parts}
        onChange={onPartsChange}
        onSave={onSaveParts}
        disabled={role === "mechanic" && !detail.allowedActions?.saveNotes}
        minimumRows={role === "mechanic" ? 1 : 3}
        suggestionsEnabled={role !== "mechanic"}
      />
      {role === "office" ? (
        <div className="office-part-overview">
          <strong>{officeQueueText}</strong>
        </div>
      ) : null}

      {requests.length || role === "office" ? (
        <div className="part-request-list">
          {requests.length ? requests.map((request) => role === "office"
            ? <OfficeRequestCard request={request} detail={detail} onChanged={onChanged} key={request.id} />
            : <MechanicRequestCard request={request} detail={detail} onChanged={onChanged} key={request.id} />
          ) : <p className="part-request-empty">No part requests yet.</p>}
        </div>
      ) : null}
    </div>
  );
}
