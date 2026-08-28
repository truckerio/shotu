import { useCallback, useEffect, useRef, useState } from "react";
import { ArrowLeft, ChevronRight, Plus, Printer, QrCode01, RefreshCw01, XClose } from "@untitledui/icons";
import { Button } from "../../components/ui/Button.jsx";
import { api } from "../../lib/api.js";

function quantity(value) {
  return new Intl.NumberFormat(undefined, { maximumFractionDigits: 3 }).format(Number(value || 0));
}

function unitStatus(status) {
  return {
    in_stock: "In stock",
    issued: "Issued",
    installed: "Installed",
    removed: "Removed",
    returned: "Returned",
    scrapped: "Scrapped",
    pending: "Pending",
  }[status] || status;
}

function sourceLabel(source) {
  return {
    invoice: "Invoice receipt",
    stock_count: "Inventory count",
    manual: "Added manually",
    receipt: "Inventory receipt",
  }[source?.type] || "Inventory receipt";
}

function eventLabel(type) {
  return {
    receipt_staged: "Receipt staged",
    receipt_confirmed: "Receipt confirmed",
    receipt_recorded: "Created",
    reconciliation_required: "Reconciliation required",
    issued: "Issued to work order",
    installed: "Installed",
    returned: "Returned",
    void: "Voided",
  }[type] || String(type || "Updated").replaceAll("_", " ");
}

function eventContext(event) {
  const references = [];
  if (event.workorderSerial) references.push(`Work order ${event.workorderSerial}`);
  const asset = event.asset?.unitNo || event.asset?.name;
  if (asset) references.push(`Unit ${asset}`);
  if (!references.length && event.providerReference) references.push(event.providerReference);
  return references.join(" · ");
}

function dateTime(value) {
  if (!value) return "Unknown time";
  return new Date(value).toLocaleString();
}

export function PartSerializationPanel({ item, location, onBack, onInventoryChanged }) {
  const rootRef = useRef(null);
  const backRef = useRef(null);
  const [data, setData] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [quantityToCreate, setQuantityToCreate] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [creating, setCreating] = useState(false);
  const [createdBatch, setCreatedBatch] = useState(null);
  const [createOpen, setCreateOpen] = useState(false);
  const [selectedUnitId, setSelectedUnitId] = useState("");
  const [selectedUnit, setSelectedUnit] = useState(null);
  const [unitLoading, setUnitLoading] = useState(false);
  const [unitError, setUnitError] = useState("");

  const endpoint = `/api/office/inventory/parts/${encodeURIComponent(item.catalogPartId)}/locations/${encodeURIComponent(location.locationId)}/units`;
  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setData(await api(endpoint));
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setLoading(false);
    }
  }, [endpoint]);

  useEffect(() => {
    setCreatedBatch(null);
    setConfirmed(false);
    setQuantityToCreate("1");
    setCreateOpen(false);
    setSelectedUnitId("");
    setSelectedUnit(null);
    setUnitError("");
    load();
  }, [load]);

  useEffect(() => {
    if (!selectedUnitId) return undefined;
    let active = true;
    setUnitLoading(true);
    setUnitError("");
    api(`/api/office/inventory/units/${encodeURIComponent(selectedUnitId)}`)
      .then((result) => { if (active) setSelectedUnit(result); })
      .catch((nextError) => { if (active) setUnitError(nextError.message); })
      .finally(() => { if (active) setUnitLoading(false); });
    return () => { active = false; };
  }, [selectedUnitId]);

  useEffect(() => {
    if (selectedUnitId) backRef.current?.focus();
  }, [selectedUnitId]);

  function returnToUnits() {
    const unitId = selectedUnitId;
    setSelectedUnitId("");
    setSelectedUnit(null);
    setUnitError("");
    window.requestAnimationFrame(() => rootRef.current?.querySelector(`[data-unit-id="${unitId}"]`)?.focus());
  }

  async function createUnits(event) {
    event.preventDefault();
    const parsedQuantity = Number(quantityToCreate);
    if (!Number.isInteger(parsedQuantity) || parsedQuantity < 1 || parsedQuantity > 500) {
      setError("Enter a whole quantity from 1 to 500.");
      return;
    }
    if (!confirmed) {
      setError("Confirm that these physical units are present at this location.");
      return;
    }
    setCreating(true);
    setError("");
    try {
      const result = await api(endpoint, {
        method: "POST",
        body: JSON.stringify({
          quantity: parsedQuantity,
          confirmation: "physically_present_at_location",
          idempotencyKey: crypto.randomUUID(),
        }),
      });
      setCreatedBatch(result.batch);
      setConfirmed(false);
      setQuantityToCreate("1");
      setCreateOpen(false);
      await load();
      onInventoryChanged?.();
    } catch (nextError) {
      setError(nextError.message);
    } finally {
      setCreating(false);
    }
  }

  return (
    <div className="inventory-serial-drilldown" ref={rootRef}>
      <button className="inventory-detail-back" ref={backRef} type="button" onClick={selectedUnitId ? returnToUnits : onBack}><ArrowLeft />{selectedUnitId ? "Serialized units" : "All locations"}</button>

      {loading ? <div className="inventory-serial-loading"><RefreshCw01 className="loading-icon" />Loading serialized units</div> : null}
      {error ? <p className="ops-error" role="alert">{error}</p> : null}

      {!loading && data && selectedUnitId ? <div className="inventory-unit-detail">
        {unitLoading ? <div className="inventory-serial-loading"><RefreshCw01 className="loading-icon" />Loading unit history</div> : null}
        {unitError ? <p className="ops-error" role="alert">{unitError}</p> : null}
        {!unitLoading && selectedUnit ? <>
          <header className="inventory-unit-header">
            <div><span>Serialized unit</span><code>{selectedUnit.serialNumber}</code></div>
            <span className={`inventory-unit-status is-${selectedUnit.status}`}>{unitStatus(selectedUnit.status)}</span>
          </header>
          <div className="inventory-unit-actions">
            <a className="button primary" href={selectedUnit.printUrl} target="_blank" rel="noreferrer"><Printer />Print QR</a>
            {selectedUnit.labelBatch?.status === "ready" ? <a className="button secondary" href={selectedUnit.labelBatch.printUrl} target="_blank" rel="noreferrer"><Printer />Print batch · {selectedUnit.labelBatch.itemCount}</a> : null}
          </div>
          <dl className="inventory-unit-facts">
            <div><dt>Location</dt><dd>{selectedUnit.locationName}</dd></div>
            <div><dt>Source</dt><dd>{sourceLabel(selectedUnit.source)}</dd></div>
            <div><dt>Created</dt><dd>{dateTime(selectedUnit.createdAt)}{selectedUnit.createdBy?.name ? ` by ${selectedUnit.createdBy.name}` : ""}</dd></div>
            {selectedUnit.providerLotExternalId ? <div><dt>Provider serial</dt><dd>{selectedUnit.providerLotExternalId}</dd></div> : null}
          </dl>
          <section className="inventory-unit-timeline" aria-labelledby="inventory-unit-timeline-title">
            <h4 id="inventory-unit-timeline-title">Timeline</h4>
            {selectedUnit.events?.length ? <ol>{selectedUnit.events.map((event) => <li key={event.id || `${event.type}-${event.at}`}>
              <span aria-hidden="true" />
              <div><strong>{eventLabel(event.type)}</strong><small>{dateTime(event.at)}{event.actor?.name ? ` · ${event.actor.name}` : ""}</small>{eventContext(event) ? <p>{eventContext(event)}</p> : null}</div>
            </li>)}</ol> : <p>No recorded activity yet.</p>}
          </section>
        </> : null}
      </div> : !loading && data ? <>
        <div className="inventory-location-overview">
          <div className="inventory-location-overview-heading"><strong>{location.locationName}</strong><span>{data.units.length} serialized unit{data.units.length === 1 ? "" : "s"}</span></div>
          <dl>
            <div><dt>Our stock</dt><dd>{quantity(data.location.localQuantityOnHand)} {data.part.uomCode}</dd></div>
            <div><dt>Available</dt><dd>{quantity(Math.max(data.location.localQuantityOnHand - data.location.localQuantityReserved, 0))} {data.part.uomCode}</dd></div>
            <div><dt>Odoo · read-only</dt><dd>{quantity(data.location.odooQuantityOnHand)} {data.part.uomCode}</dd></div>
          </dl>
        </div>

        <div className="inventory-serial-toolbar">
          <strong>Serialized units</strong>
          <div className="inventory-serial-actions">
            {data.printUrl ? <a className="button secondary" href={data.printUrl} target="_blank" rel="noreferrer"><Printer /><span>{data.truncated ? "Print first 500" : "Print all"}</span></a> : null}
            {data.units.length > 0 && data.canCreateAtLocation && data.canCreateSerializedUnits && !createOpen ? <Button type="button" icon={Plus} onClick={() => setCreateOpen(true)}>Add units</Button> : null}
            {createdBatch ? <a className="inventory-created-labels" href={createdBatch.printUrl} target="_blank" rel="noreferrer"><Printer />Print new batch · {createdBatch.itemCount}</a> : null}
          </div>
        </div>

        {data.units.length ? <div className="inventory-serial-list" aria-label={`Serialized units at ${location.locationName}`}>
          {data.units.map((unit) => <article key={unit.id}>
            <button type="button" className="inventory-serial-unit-open" data-unit-id={unit.id} onClick={() => setSelectedUnitId(unit.id)} aria-label={`View ${unit.serialNumber}`}><span><code>{unit.serialNumber}</code><small>{unitStatus(unit.status)}</small></span><ChevronRight aria-hidden="true" /></button>
            <a href={unit.printUrl} target="_blank" rel="noreferrer" aria-label={`Print QR label for ${unit.serialNumber}`}><Printer />Print QR</a>
          </article>)}
          {data.truncated ? <p>Showing the first 500 serialized units.</p> : null}
        </div> : <div className="inventory-serial-empty"><QrCode01 /><strong>No serialized children yet</strong><p>Add the physical units currently at this location.</p>{data.canCreateAtLocation && data.canCreateSerializedUnits && !createOpen ? <Button type="button" variant="primary" icon={Plus} onClick={() => setCreateOpen(true)}>Add units</Button> : null}</div>}

        {data.canCreateAtLocation && data.canCreateSerializedUnits && createOpen ? <form className="inventory-serial-create" onSubmit={createUnits}>
          <div className="inventory-serial-create-heading"><div><strong>Add units</strong><p>One serial number and QR label per unit.</p></div><button type="button" onClick={() => setCreateOpen(false)} aria-label="Close add units"><XClose /></button></div>
          <label><span>Quantity</span><input autoFocus type="number" min="1" max="500" step="1" value={quantityToCreate} onChange={(event) => setQuantityToCreate(event.target.value)} disabled={creating} /></label>
          <label className="inventory-serial-confirm"><input type="checkbox" checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={creating} /><span>I confirm these units are physically present at {location.locationName}.</span></label>
          <Button type="submit" variant="primary" icon={Plus} disabled={creating || !confirmed}>{creating ? "Adding units…" : `Add ${quantityToCreate || 0} unit${Number(quantityToCreate) === 1 ? "" : "s"}`}</Button>
        </form> : !data.canCreateAtLocation ? <p className="inventory-serial-note">An assigned Office user or Admin can add units here.</p> : !data.canCreateSerializedUnits ? <p className="inventory-serial-note">This unit cannot be serialized individually.</p> : null}
      </> : null}
    </div>
  );
}
