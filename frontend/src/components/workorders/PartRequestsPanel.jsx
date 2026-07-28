import { useMemo, useRef, useState } from "react";
import { CheckCircle, Plus, SearchMd, Trash01 } from "@untitledui/icons";
import { api } from "../../lib/api.js";
import { QuantityUnitInput } from "../forms/QuantityUnitInput.jsx";
import { formatQuantityUnit } from "../forms/quantity-unit-model.js";
import { Button } from "../ui/Button.jsx";
import { UsedPartsEditor } from "./UsedPartsEditor.jsx";
import { usedPartsAccessState } from "./used-parts-model.js";
import { normalizeUomCode } from "../../../../shared/units-of-measure.js";
import "./part-requests-panel.css";

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
  uomCode: "ea",
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

function requestUomCode(request) {
  return normalizeUomCode(request?.uomCode);
}

function RequestSummary({ request }) {
  return (
    <div className="part-request-summary">
      <div>
        <strong>{request.partNumber || request.description || request.rawQuery}</strong>
        <span>{[request.manufacturer, request.description].filter(Boolean).join(" · ")}</span>
      </div>
      <div className="part-request-meta">
        <span>{formatQuantityUnit(request.quantity, requestUomCode(request))}</span>
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
            <span key={allocation.id}>{SOURCE_LABELS[allocation.sourceType]} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)} · {ALLOCATION_STATUS_LABELS[allocation.status]}</span>
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

function AllocationEditor({ allocations, setAllocations, quantity, uomCode, inventory }) {
  function update(index, field, value) {
    setAllocations((current) => current.map((allocation, allocationIndex) => (
      allocationIndex === index ? { ...allocation, [field]: value } : allocation
    )));
  }

  function add() {
    setAllocations((current) => [...current, {
      sourceType: "unknown",
      status: "proposed",
      quantity: 1,
      uomCode,
      vendor: "",
    }]);
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
          <QuantityUnitInput
            id={`allocation-quantity-${index}`}
            quantity={allocation.quantity}
            uomCode={allocation.uomCode || uomCode}
            onQuantityChange={(value) => update(index, "quantity", value)}
            onUomCodeChange={() => {}}
            quantityLabel={`Supply quantity ${index + 1}`}
            unitLabel={`Supply unit ${index + 1}`}
            max={quantity}
            unitReadOnly
            compact
          />
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
  const firstInventory = request.inventory.find(
    (item) => item.uomCode === requestUomCode(request) && item.quantityAvailable > 0,
  );
  const [form, setForm] = useState({
    partNumber: request.partNumber,
    manufacturer: request.manufacturer,
    description: request.description,
    category: request.category,
    quantity: request.quantity,
    uomCode: requestUomCode(request),
    repairOrder: request.repairOrder,
    fitmentStatus: request.fitmentStatus,
    fitmentNotes: request.fitmentNotes,
    reason: "",
  });
  const [allocations, setAllocations] = useState([firstInventory ? {
    sourceType: "inventory",
    status: "reserved",
    quantity: Math.min(request.quantity, firstInventory.quantityAvailable),
    uomCode: requestUomCode(request),
    inventoryItemId: firstInventory.id,
    locationId: firstInventory.locationId,
    vendor: "",
  } : {
    sourceType: "unknown",
    status: "proposed",
    quantity: request.quantity,
    uomCode: requestUomCode(request),
    vendor: "",
  }]);
  const [busy, setBusy] = useState("");
  const [message, setMessage] = useState("");
  const [messageTone, setMessageTone] = useState("error");
  const [pricing, setPricing] = useState(null);
  const responseRef = useRef(null);

  function update(field, value) {
    setForm((current) => ({ ...current, [field]: value }));
  }

  function updateRequestUnit(value) {
    update("uomCode", value);
    setAllocations((current) => current.map((allocation) => ({ ...allocation, uomCode: value })));
  }

  async function decide(decision) {
    if (decision !== "approved" && !form.reason.trim()) {
      setMessageTone("error");
      setMessage(decision === "needs_info"
        ? "Write the question the mechanic needs to answer."
        : "Explain why the request is being declined.");
      responseRef.current?.focus();
      return;
    }
    if (decision === "approved" && !form.partNumber.trim() && !form.description.trim()) {
      setMessageTone("error");
      setMessage("Add a part number or description before approval.");
      return;
    }
    if (decision === "approved" && form.fitmentStatus === "conflict") {
      setMessageTone("error");
      setMessage("This part has conflicting fitment. Resolve the fitment before approval.");
      return;
    }
    const allocatedQuantity = allocations.reduce((sum, allocation) => sum + Number(allocation.quantity || 0), 0);
    if (decision === "approved" && Math.abs(allocatedQuantity - Number(form.quantity)) > 0.0005) {
      setMessageTone("error");
      setMessage(`Supply quantities must total ${formatQuantityUnit(form.quantity, form.uomCode)}.`);
      return;
    }
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
      setMessageTone("success");
      setMessage(decision === "approved"
        ? "Approved. The mechanic was notified in chat."
        : decision === "needs_info"
          ? "Question sent to the mechanic."
          : "Request declined. The mechanic was notified.");
    } catch (error) {
      setMessageTone("error");
      setMessage(error.message);
    } finally {
      setBusy("");
    }
  }

  async function findSuggestion() {
    setBusy("identify");
    setMessage("");
    try {
      const result = await api("/api/parts-helper/identify", {
        method: "POST",
        body: JSON.stringify({
          query: form.partNumber || request.rawQuery,
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      const suggestedUomCode = normalizeUomCode(result.part.uomCode || form.uomCode);
      setForm((current) => ({
        ...current,
        partNumber: result.part.normalizedPartNumber || current.partNumber,
        manufacturer: result.part.manufacturer || current.manufacturer,
        description: result.part.description || current.description,
        category: result.part.category || current.category,
        quantity: result.part.suggestedQuantity || current.quantity,
        uomCode: suggestedUomCode,
        repairOrder: result.part.repairOrder || current.repairOrder,
        fitmentStatus: result.part.fitmentStatus || "unknown",
        fitmentNotes: result.part.evidenceSummary || current.fitmentNotes,
      }));
      setAllocations((current) => current.map((allocation) => ({
        ...allocation,
        uomCode: suggestedUomCode,
      })));
      setMessageTone("success");
      setMessage(result.resolutionSource === "company_catalog"
        ? "Matched company-approved part data."
        : "AI suggestion loaded for review. Nothing has been approved yet.");
    } catch (error) {
      setMessageTone("error");
      setMessage(`${error.message} Review and enter the part manually.`);
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
      setMessageTone("success");
      setMessage(`Supply updated to ${ALLOCATION_STATUS_LABELS[status]}. The mechanic was notified.`);
    } catch (error) {
      setMessageTone("error");
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
          uomCode: requestUomCode(request),
          vehicle: vehicleInput(detail),
          location: purchasingLocation(detail),
        }),
      });
      setPricing(result);
    } catch (error) {
      setMessageTone("error");
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
          <div className="part-review-heading">
            <div>
              <strong>Review request</strong>
              <span>Verify the part, decide how it will be supplied, and send one clear response.</span>
            </div>
            <div className="part-review-heading-actions">
              {request.requestedByName ? <span>Requested by {request.requestedByName}</span> : null}
              <button type="button" onClick={findSuggestion} disabled={Boolean(busy)}>
                <SearchMd />
                {busy === "identify" ? "Finding" : "Find suggestion"}
              </button>
            </div>
          </div>
          <div className="part-office-fields">
            <label>Part number<input value={form.partNumber} onChange={(event) => update("partNumber", event.target.value)} /></label>
            <QuantityUnitInput
              id={`request-quantity-${request.id}`}
              quantity={form.quantity}
              uomCode={form.uomCode}
              onQuantityChange={(value) => update("quantity", value)}
              onUomCodeChange={updateRequestUnit}
              quantityLabel="Quantity"
              unitLabel="Unit"
            />
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
            <label>Fitment note<input value={form.fitmentNotes} onChange={(event) => update("fitmentNotes", event.target.value)} placeholder="How fitment was checked" /></label>
          </div>
          <div className="part-review-section">
            <div className="part-review-section-heading">
              <strong>Supply</strong>
              <span>Approved quantity: {formatQuantityUnit(form.quantity, form.uomCode)}</span>
            </div>
            <div className="inventory-summary">
              {request.inventory.length ? request.inventory.map((item) => (
                <span key={item.id}><strong>{formatQuantityUnit(item.quantityAvailable, item.uomCode || form.uomCode)}</strong> available · {item.locationName || "Inventory"}{item.binLocation ? ` · ${item.binLocation}` : ""}</span>
              )) : <span>Inventory is not tracked for this part yet.</span>}
            </div>
            <AllocationEditor
              allocations={allocations}
              setAllocations={setAllocations}
              quantity={form.quantity}
              uomCode={form.uomCode}
              inventory={request.inventory}
            />
          </div>
          <div className="part-response-composer">
            <label htmlFor={`part-response-${request.id}`}>Message to mechanic</label>
            <textarea
              id={`part-response-${request.id}`}
              ref={responseRef}
              value={form.reason}
              onChange={(event) => update("reason", event.target.value)}
              placeholder="Optional for approval. Required when asking a question or declining."
              rows="3"
            />
            <span>This response will also appear in the workorder chat and activity history.</span>
            <div className="part-decision-actions">
              <Button variant="primary" icon={CheckCircle} onClick={() => decide("approved")} disabled={Boolean(busy)}>
                {busy === "approved" ? "Approving" : "Approve request"}
              </Button>
              <button type="button" onClick={() => decide("needs_info")} disabled={Boolean(busy)}>
                {busy === "needs_info" ? "Sending question" : "Ask mechanic"}
              </button>
              <button className="part-decline-button" type="button" onClick={() => decide("rejected")} disabled={Boolean(busy)}>
                {busy === "rejected" ? "Declining" : "Decline"}
              </button>
            </div>
          </div>
        </>
      ) : (
        <>
          {request.repairOrder ? <p className="part-repair-order">{request.repairOrder}</p> : null}
          {request.allocations.length ? (
            <div className="part-allocation-list office-allocation-list">
              {request.allocations.map((allocation) => (
                <label key={allocation.id}>
                  <span>{SOURCE_LABELS[allocation.sourceType]} · {formatQuantityUnit(allocation.quantity, allocation.uomCode || request.uomCode)}</span>
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
      {message ? (
        <p
          className={messageTone === "success" ? "part-request-message part-request-success" : "part-request-error"}
          role={messageTone === "success" ? "status" : "alert"}
        >
          {message}
        </p>
      ) : null}
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
        uomCode: normalizeUomCode(result.part.uomCode || current.uomCode),
        repairOrder: result.part.repairOrder,
        fitmentStatus: result.part.fitmentStatus,
        fitmentNotes: result.part.evidenceSummary,
      }));
      setMessage(result.resolutionSource === "company_catalog"
        ? "Company-approved part filled. Verify fitment for this unit."
        : result.part.status === "ambiguous"
          ? "Exact input preserved. Review the AI suggestion before approval."
          : "AI suggestion filled. Office remains responsible for fitment.");
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
            uomCode: draft.uomCode,
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
        <QuantityUnitInput
          id="office-part-quantity"
          quantity={draft.quantity}
          uomCode={draft.uomCode}
          onQuantityChange={(value) => update("quantity", value)}
          onUomCodeChange={(value) => update("uomCode", value)}
          quantityLabel="Quantity"
          unitLabel="Unit"
        />
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
  const usedPartsAccess = usedPartsAccessState(role, detail.allowedActions || {});
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
        disabled={!usedPartsAccess.editable}
        readonlyMessage={usedPartsAccess.message}
        minimumRows={0}
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
