import { useEffect, useId, useMemo, useState } from "react";
import { Heading } from "react-aria-components";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Checkbox } from "../../components/ui/Checkbox.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { ModalFrame } from "../../components/ui/ModalFrame.jsx";
import { PartCatalogCombobox } from "../../components/workorders/part-requests/PartCatalogCombobox.jsx";
import { api } from "../../lib/api.js";
import { ReceiptLinesEditor } from "../office/ReceiptLinesEditor.jsx";
import { directArrivalInitialLines, directArrivalReceiptFacts, directReceiptErrorMessage, directReceiptPayload, receiptDraftKey, restoreReceiptDraft } from "./direct-receipt-model.js";
import "./create-inventory-part-dialog.css";
import "./add-inventory-stock.css";

function freshDraft(locationId = "", part = {}, targetPositionId = "") {
  return { locationId, quantity: part.receiptQuantity || "", serials: "", reference: "", noPurchaseOrderReason: "", disposition: "accepted", holdLocation: "", damageDetails: "", targetPositionId: targetPositionId || part.receiptPositionId || "", confirmed: false, attempt: null };
}

function withFixedDestination(draft, locationId, targetPositionId) {
  if (draft.attempt) return draft;
  return {
    ...draft,
    locationId,
    targetPositionId,
    ...(Array.isArray(draft.receiptLines) ? {
      receiptLines: draft.receiptLines.map((line) => ({
        ...line,
        targetPositionId: line.outcome === "held" ? "" : targetPositionId,
      })),
    } : {}),
  };
}

function compactDestination(shopName, locationLabel) {
  const segments = String(locationLabel || "").split(" / ").map((segment) => segment.trim()).filter(Boolean);
  const codes = segments.map((segment) => segment.split(" · ")[0].trim()).filter(Boolean);
  const finalSegment = segments.at(-1) || "";
  const name = finalSegment.split(" · ").at(-1)?.trim() || shopName;
  return { name, path: [shopName, codes.join(" / ")].filter(Boolean).join(" · ") };
}

function trackingLabel(part) {
  const unit = part.canonicalUomCode || part.uomCode;
  if (part.trackingMode === "serialized") return `Serialized · ${unit}`;
  if (part.trackingMode === "measured") return `Measured · ${unit}`;
  return `Quantity · ${unit}`;
}

export function AddInventoryStockDialog({ part = null, locationParts = [], actorId, locations, initialLocationId = "", initialPositionId = "", lockLocation = false, locationContextLabel = "", onClose, onReceived }) {
  const titleId = useId();
  const initialPart = part?.catalogPartId ? part : null;
  const [selectedPart, setSelectedPart] = useState(initialPart);
  const [shopId, setShopId] = useState(() => initialLocationId || initialPart?.receiptLocationId || (locations.length === 1 ? locations[0].id : ""));
  const [preferredPositionId, setPreferredPositionId] = useState(() => initialPositionId || initialPart?.receiptPositionId || "");
  const [draft, setDraft] = useState(() => freshDraft(initialLocationId || initialPart?.receiptLocationId || "", initialPart || {}, initialPositionId));
  const [partQuery, setPartQuery] = useState(() => initialPart?.partNumber || "");
  const [positions, setPositions] = useState([]);
  const [positionLoading, setPositionLoading] = useState(false);
  const [positionError, setPositionError] = useState("");
  const [positionReload, setPositionReload] = useState(0);
  const [receiptReady, setReceiptReady] = useState(false);
  const [draftReady, setDraftReady] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [receipt, setReceipt] = useState(null);
  const [approvalRequest, setApprovalRequest] = useState(null);
  const contextualLocationLocked = lockLocation && Boolean(shopId);
  const selectedShopName = locations.find((location) => location.id === shopId)?.name || "Selected shop";
  const destinationLabel = [selectedShopName, locationContextLabel].filter((value, index, values) => value && values.indexOf(value) === index).join(" · ");
  const destination = compactDestination(selectedShopName, locationContextLabel);
  const storageKey = selectedPart ? receiptDraftKey(actorId, selectedPart.companyId, selectedPart.catalogPartId) + (selectedPart.purchaseLineId ? `:purchase:${selectedPart.purchaseLineId}` : selectedPart.purchaseRequestId ? `:request:${selectedPart.purchaseRequestId}` : "") + (contextualLocationLocked ? `:location:${shopId}:${preferredPositionId || "receiving"}` : "") : "";
  const locked = busy || Boolean(draft.attempt);
  const directFacts = useMemo(() => selectedPart ? directArrivalReceiptFacts(selectedPart) : [], [selectedPart]);

  useEffect(() => {
    if (!selectedPart) return;
    setDraftReady(false);
    const fresh = freshDraft(shopId, selectedPart, preferredPositionId);
    try {
      const restored = restoreReceiptDraft(JSON.parse(localStorage.getItem(storageKey)), fresh);
      setDraft(contextualLocationLocked ? withFixedDestination(restored, shopId, preferredPositionId) : restored);
    } catch { setDraft(fresh); }
    setDraftReady(true);
  }, [contextualLocationLocked, preferredPositionId, selectedPart, shopId, storageKey]);
  useEffect(() => {
    if (!shopId) { setPositions([]); setPositionError(""); return undefined; }
    let active = true;
    setPositionLoading(true);
    api(`/api/office/inventory/locations/${encodeURIComponent(shopId)}/positions`)
      .then((result) => { if (active) { setPositions(result.positions || result.items || []); setPositionError(""); } })
      .catch((next) => { if (active) setPositionError(next.message || "Storage locations could not be loaded."); })
      .finally(() => { if (active) setPositionLoading(false); });
    return () => { active = false; };
  }, [shopId, positionReload]);

  function persist(next) { if (storageKey) localStorage.setItem(storageKey, JSON.stringify(next)); setDraft(next); }
  function update(field, value) { const next = { ...draft, [field]: value }; try { persist(next); setError(""); } catch { setDraft(next); setError("Draft storage is unavailable. Enable browser storage before receiving stock."); } }
  function selectShop(nextShopId) { if (contextualLocationLocked || nextShopId === shopId) return; setShopId(nextShopId); setPreferredPositionId(""); setSelectedPart(null); setPartQuery(""); setPositions([]); setReceiptReady(false); setDraftReady(false); setDraft(freshDraft(nextShopId)); setError(""); }
  function selectPart(nextPart) {
    const normalizedPart = {
      ...nextPart,
      catalogPartId: nextPart.catalogPartId || nextPart.id,
      companyId: nextPart.companyId || locations.find((location) => location.id === shopId)?.companyId || "",
    };
    setSelectedPart(normalizedPart);
    setPartQuery(normalizedPart.partNumber || "");
    setReceipt(null);
    setReceiptReady(false);
    setDraftReady(false);
    setError("");
  }
  function updateReceiptLines(lines, ready) {
    const next = { ...draft, receiptLines: lines };
    try { persist(next); setReceiptReady(ready); } catch { setDraft(next); setReceiptReady(ready); setError("Draft storage is unavailable. Enable browser storage before receiving stock."); }
  }
  function complete(saved) { setReceipt(saved); try { localStorage.removeItem(storageKey); } catch { /* recovery remains available */ } onReceived?.(saved); }
  function awaitApproval(saved) { setApprovalRequest(saved); setError(""); }
  async function submit(event) {
    event.preventDefault(); if (busy || !selectedPart) return;
    setBusy(true); setError(""); let payload = draft.attempt;
    try {
      if (payload) { const outcome = await api(`/api/office/inventory/direct-receipts/${encodeURIComponent(payload.idempotencyKey)}`); if (outcome.status === "posted") { complete(outcome.receipt); return; } if (outcome.status === "approval_needed") { awaitApproval(outcome.approvalRequest); return; } if (["rejected", "cancelled"].includes(outcome.status)) { setApprovalRequest(outcome.approvalRequest); throw new Error(`This request was ${outcome.status}.`); } if (outcome.status !== "not_found") throw new Error("Receipt status is unavailable. Check again before continuing."); }
      else { payload = directReceiptPayload(selectedPart, { ...draft, locationId: shopId }, crypto.randomUUID()); persist({ ...draft, locationId: shopId, attempt: payload }); }
      const result = await api("/api/office/inventory/direct-receipts", { method: "POST", body: JSON.stringify(payload) });
      if (result.status === "approval_needed") { awaitApproval(result.approvalRequest); return; }
      complete(result.receipt);
    } catch (nextError) {
      if (nextError?.code === "INVENTORY_RECEIPT_POSITION_INVALID") setPositionReload((value) => value + 1);
      setError(directReceiptErrorMessage(nextError));
      if ([400, 403, 404, 409, 422].includes(nextError.status) && nextError.code !== "INVENTORY_RECEIPT_REPLAY_CONFLICT") try { persist({ ...draft, attempt: null }); } catch { /* preserve unknown command */ }
    } finally { setBusy(false); }
  }
  return <ModalFrame overlayClassName="create-inventory-part-overlay" modalClassName="create-inventory-part-modal" dialogClassName="create-inventory-part-dialog add-inventory-stock-dialog" ariaLabelledBy={titleId} isDismissable={!busy} onOpenChange={(open) => { if (!open && !busy) onClose(); }}>
    <form onSubmit={submit}>
      <header><div><Heading slot="title" id={titleId}>{receipt ? "Stock received" : approvalRequest?.status === "pending" ? "Approval needed" : "Add inventory"}</Heading></div></header>
      {error ? <p role="alert" className="create-inventory-part-error">{error}</p> : null}
      {receipt ? <div role="status"><p>Received {receipt.lines?.[0]?.quantity} {receipt.lines?.[0]?.uomCode} at {receipt.locationName}.</p><p>Receipt reference: {receipt.id}</p>{receipt.disposition === "held" ? <p>Held for inspection. Open Tasks / Stock damage to review these goods before release.</p> : null}{receipt.labelBatch?.printUrl ? <a href={receipt.labelBatch.printUrl} target="_blank" rel="noreferrer">Print unit labels</a> : null}</div> : approvalRequest?.status === "pending" ? <div role="status"><p>This no-PO arrival is saved and waiting for purchasing approval.</p><p>Request reference: {approvalRequest.id}</p><p>Stock will be added after an approver confirms the original arrival.</p></div> : <>
        <section className="add-inventory-section" aria-labelledby="add-inventory-context"><h3 id="add-inventory-context">{selectedPart ? "Part and location" : contextualLocationLocked ? "Choose part" : "Shop and part"}</h3><div className="create-inventory-part-fields">
          {contextualLocationLocked ? <div className="add-inventory-destination"><span>Location</span><strong>{destination.name}</strong><small>{destination.path}</small></div> : <label><span>Shop</span><Dropdown value={shopId} onChange={(event) => selectShop(event.target.value)} disabled={locked || Boolean(selectedPart?.purchaseLineId || selectedPart?.purchaseRequestId)} required><option value="">Choose shop</option>{locations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>}
          {selectedPart ? <div className="add-inventory-part-summary"><div><strong>{selectedPart.partNumber}</strong><span>{selectedPart.description}</span><small>{trackingLabel(selectedPart)}</small></div><Button type="button" onClick={() => { setSelectedPart(null); setPartQuery(""); }} disabled={locked}>Change part</Button></div> : <>
            {contextualLocationLocked && locationParts.length ? <section className="add-inventory-existing-parts" aria-labelledby="add-inventory-existing-parts-title"><div><strong id="add-inventory-existing-parts-title">Parts already here</strong><span>{locationParts.length}</span></div><div className="add-inventory-existing-part-list">{locationParts.map((entry) => <button type="button" key={entry.catalogPartId || entry.id} onClick={() => selectPart(entry)} disabled={locked}><span><strong>{entry.partNumber}</strong><small>{entry.description || "No description"}</small></span><span>{entry.subtreeQuantity ?? entry.directQuantity ?? 0} {entry.uomCode}</span></button>)}</div></section> : null}
            <PartCatalogCombobox label={contextualLocationLocked && locationParts.length ? "Search all company parts" : "Part number or description"} locationId={shopId} purpose="master_match" catalogEndpoint="/api/office/inventory/catalog" value={partQuery} onChange={setPartQuery} onSelect={selectPart} disabled={!shopId || locked} inputAriaLabel="Choose a master catalog part" popupAriaLabel="Matching master catalog parts" />
          </>}
        </div></section>
        {selectedPart ? <section className="add-inventory-section" aria-labelledby="add-inventory-quantity"><h3 id="add-inventory-quantity">Stock arrival</h3><div className="create-inventory-part-fields">
            {draftReady ? <ReceiptLinesEditor mode="direct-arrival" compactDirectArrival facts={directFacts} initialLines={directArrivalInitialLines(selectedPart, draft)} runId={`direct:${selectedPart.catalogPartId}:${shopId}`} runVersion={selectedPart.version || 0} positions={positions} positionLoading={positionLoading} positionError={positionError} targetLocked={contextualLocationLocked} fixedTargetPositionId={preferredPositionId} fixedTargetLabel={destinationLabel} disabled={locked} onChange={updateReceiptLines} /> : <p role="status">Loading saved arrival details…</p>}
            {positionError ? <Button type="button" onClick={() => setPositionReload((value) => value + 1)} disabled={locked || positionLoading}>Try storage locations again</Button> : null}
            {!selectedPart.purchaseLineId ? <label><span>Reason for no purchase order *</span><input required maxLength={240} value={draft.noPurchaseOrderReason || ""} onChange={(event) => update("noPurchaseOrderReason", event.target.value)} disabled={locked} /></label> : null}
            <label><span>Delivery reference <small>Optional</small></span><input maxLength={240} value={draft.reference} onChange={(event) => update("reference", event.target.value)} disabled={locked} /></label>
          </div><label className="direct-receipt-confirmation"><Checkbox checked={draft.confirmed} onChange={(event) => update("confirmed", event.target.checked)} disabled={locked} /><span>I confirm these company-owned goods physically arrived at this shop.</span></label>{draft.attempt ? <p role="status">A receipt was submitted. Check its result before changing or submitting another receipt.</p> : null}
          </section> : null}
      </>}
      <footer><Button type="button" onClick={onClose} disabled={busy}>{receipt || approvalRequest?.status === "pending" ? "Done" : "Close"}</Button>{!receipt && !approvalRequest && selectedPart ? <Button type="submit" variant="primary" disabled={busy || !selectedPart.trackingMode || !draftReady || (!draft.attempt && !receiptReady)}>{busy ? "Checking receipt…" : draft.attempt ? "Check receipt" : "Receive stock"}</Button> : null}</footer>
    </form>
  </ModalFrame>;
}
