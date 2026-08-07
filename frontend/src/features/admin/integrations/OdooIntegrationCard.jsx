import { useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle, CheckCircle, RefreshCw01, Settings01 } from "@untitledui/icons";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";

const EMPTY_CONFIGURATION = { baseUrl: "", database: "", username: "", apiKey: "" };
const EMPTY_OUTBOUND = {
  state: "needs_setup",
  vehicles: { confirmedCount: 0, unresolvedCount: 0 },
  warehouses: { confirmedCount: 0, unresolvedCount: 0, items: [], available: [] },
  labor: { status: "unresolved", products: [] },
};

function mappingValue(item) {
  if (item.status === "mapped") return item.locationId || "";
  if (item.status === "ignored") return "__ignored";
  return "";
}

export function OdooIntegrationCard({ provider, status, onStatusChange }) {
  const Icon = provider.icon;
  const [configuration, setConfiguration] = useState(EMPTY_CONFIGURATION);
  const [editing, setEditing] = useState(false);
  const [mappingData, setMappingData] = useState({ items: [], appLocations: [] });
  const [outbound, setOutbound] = useState(EMPTY_OUTBOUND);
  const [vehicleData, setVehicleData] = useState({ items: [], nextCursor: null });
  const [vehicleQuery, setVehicleQuery] = useState("");
  const [odooVehicleQuery, setOdooVehicleQuery] = useState("");
  const [odooVehicleOptions, setOdooVehicleOptions] = useState([]);
  const [vehicleDrafts, setVehicleDrafts] = useState({});
  const [warehouseDrafts, setWarehouseDrafts] = useState({});
  const [laborProductDraft, setLaborProductDraft] = useState("");
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ error: "", message: "" });
  const vehicleRequestSequence = useRef(0);
  const odooVehicleRequestSequence = useRef(0);

  const loadMappings = useCallback(async () => {
    if (!status?.configured) return;
    const result = await api("/api/integrations/odoo/locations");
    setMappingData(result);
  }, [status?.configured]);

  const loadOutboundReadiness = useCallback(async () => {
    if (!status?.configured) return;
    const result = await api("/api/integrations/odoo/outbound/readiness");
    setOutbound({ ...EMPTY_OUTBOUND, ...result });
    setLaborProductDraft(result.labor?.productExternalId || "");
  }, [status?.configured]);

  const loadVehicles = useCallback(async ({ query = "", cursor = "", append = false } = {}) => {
    if (!status?.configured) return;
    const sequence = ++vehicleRequestSequence.current;
    const params = new URLSearchParams({ status: "all", limit: "25" });
    if (query.trim()) params.set("q", query.trim());
    if (cursor) params.set("cursor", cursor);
    const result = await api(`/api/integrations/odoo/outbound/vehicles?${params}`);
    if (sequence !== vehicleRequestSequence.current) return;
    setVehicleData((current) => ({
      items: append
        ? [...new Map([...current.items, ...(result.items || [])].map((item) => [(item.asset || item).id, item])).values()]
        : result.items || [],
      nextCursor: result.nextCursor || null,
    }));
  }, [status?.configured]);

  const loadOdooVehicles = useCallback(async (query = "") => {
    if (!status?.configured) return;
    const sequence = ++odooVehicleRequestSequence.current;
    const params = new URLSearchParams({ q: query.trim(), limit: "25" });
    const result = await api(`/api/integrations/odoo/outbound/odoo-vehicles?${params}`);
    if (sequence !== odooVehicleRequestSequence.current) return;
    setOdooVehicleOptions(result.items || []);
  }, [status?.configured]);

  useEffect(() => {
    Promise.all([loadMappings(), loadOutboundReadiness(), loadVehicles(), loadOdooVehicles()])
      .catch((error) => setNotice({ error: error.message, message: "" }));
  }, [loadMappings, loadOutboundReadiness, loadOdooVehicles, loadVehicles]);

  function updateConfiguration(field, value) {
    setConfiguration((current) => ({ ...current, [field]: value }));
  }

  async function saveConfiguration(event) {
    event.preventDefault();
    setBusy("configure");
    setNotice({ error: "", message: "" });
    try {
      const result = await api("/api/integrations/odoo/configuration", {
        method: "PUT",
        body: JSON.stringify(configuration),
        timeoutMs: 25_000,
      });
      setConfiguration(EMPTY_CONFIGURATION);
      setEditing(false);
      onStatusChange(result);
      setNotice({ error: "", message: "Odoo.sh connection verified and saved." });
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function runAction(name, path) {
    setBusy(name);
    setNotice({ error: "", message: "" });
    try {
      const result = await api(path, { method: "POST", body: "{}", timeoutMs: 120_000 });
      if (name === "discover") {
        setMappingData(result);
        setNotice({ error: "", message: "Odoo locations refreshed. New locations are waiting for a match." });
      } else if (name === "sync") {
        const historySummary = result.historyWarning
          ? result.historyWarning
          : `Imported ${result.historyOrderCount || 0} service orders and ${result.historyLineCount || 0} ordered history lines.`;
        setNotice({ error: "", message: `Imported ${result.changedCount} catalog and inventory records. ${historySummary} ${result.skippedUnmappedCount} inventory rows were skipped because their locations are not mapped.` });
      } else {
        setNotice({ error: "", message: "Odoo.sh connection verified." });
      }
      if (name !== "test") {
        const nextStatus = await api("/api/integrations/odoo/status");
        onStatusChange(nextStatus);
        if (name === "sync") await loadMappings();
      }
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function changeMapping(item, value) {
    setBusy(`mapping-${item.externalId}`);
    setNotice({ error: "", message: "" });
    const payload = value === "__ignored"
      ? { status: "ignored" }
      : value
        ? { status: "mapped", locationId: value }
        : { status: "unmatched" };
    try {
      const result = await api(`/api/integrations/odoo/locations/${encodeURIComponent(item.externalId)}/mapping`, {
        method: "PUT",
        body: JSON.stringify(payload),
      });
      setMappingData(result);
      onStatusChange(await api("/api/integrations/odoo/status"));
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function discoverOutbound() {
    setBusy("discover-outbound");
    setNotice({ error: "", message: "" });
    try {
      await api("/api/integrations/odoo/outbound/discover", {
        method: "POST",
        body: "{}",
        timeoutMs: 120_000,
      });
      await Promise.all([
        loadOutboundReadiness(),
        loadVehicles({ query: vehicleQuery }),
        loadOdooVehicles(odooVehicleQuery),
      ]);
      setNotice({ error: "", message: "Odoo vehicles, warehouses, and labor products refreshed." });
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function confirmVehicleMapping(item) {
    const assetId = item.asset?.id || item.assetId;
    const externalId = vehicleDrafts[assetId]
      ?? ((item.mappingStatus || item.status) === "ignored" ? "__ignored" : item.mapping?.externalId)
      ?? "";
    setBusy(`vehicle-${assetId}`);
    setNotice({ error: "", message: "" });
    try {
      await api(`/api/integrations/odoo/outbound/assets/${encodeURIComponent(assetId)}/mapping`, {
        method: "PUT",
        body: JSON.stringify(externalId === "__ignored"
          ? { status: "ignored" }
          : externalId
            ? { status: "mapped", externalId }
            : { status: "unmatched" }),
      });
      await Promise.all([loadOutboundReadiness(), loadVehicles({ query: vehicleQuery })]);
      setNotice({
        error: "",
        message: externalId === "__ignored"
          ? "Unit excluded from Odoo outbound mapping."
          : externalId
            ? "Vehicle mapping confirmed."
            : "Vehicle mapping cleared.",
      });
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function confirmWarehouseMapping(item) {
    const locationId = item.location?.id || item.locationId;
    const externalId = warehouseDrafts[locationId] ?? item.mapping?.externalId ?? "";
    setBusy(`warehouse-${locationId}`);
    setNotice({ error: "", message: "" });
    try {
      await api(`/api/integrations/odoo/outbound/locations/${encodeURIComponent(locationId)}/warehouse`, {
        method: "PUT",
        body: JSON.stringify(externalId ? { status: "mapped", externalId } : { status: "unmatched" }),
      });
      await loadOutboundReadiness();
      setNotice({ error: "", message: externalId ? "Warehouse mapping confirmed." : "Warehouse mapping cleared." });
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  async function confirmLaborProduct() {
    if (!laborProductDraft) return;
    setBusy("labor-product");
    setNotice({ error: "", message: "" });
    try {
      await api("/api/integrations/odoo/outbound/labor-product", {
        method: "PUT",
        body: JSON.stringify({ productExternalId: laborProductDraft }),
      });
      await loadOutboundReadiness();
      setNotice({ error: "", message: "Labor product confirmed." });
    } catch (error) {
      setNotice({ error: error.message, message: "" });
    } finally {
      setBusy("");
    }
  }

  const connected = status?.configured;
  const showConfiguration = editing || !connected;
  return (
    <article className="integration-card odoo-integration-card">
      <header className="integration-card-header">
        <span className="integration-provider-icon"><Icon /></span>
        <div><h2>{provider.name}</h2><p>{provider.category}</p></div>
        <span className={`integration-status ${connected ? "connected" : "disconnected"}`}>
          {connected ? <CheckCircle /> : <AlertCircle />}{connected ? "Configured" : "Not configured"}
        </span>
      </header>
      <p className="integration-description">{provider.description}</p>

      {notice.error ? <p className="integration-card-error" role="alert"><AlertCircle /><span>{notice.error}</span></p> : null}
      {notice.message ? <p className="integration-notice success" role="status">{notice.message}</p> : null}

      {showConfiguration ? (
        <form className="odoo-configuration" onSubmit={saveConfiguration}>
          <label>Odoo.sh URL<input type="url" required placeholder="https://company.odoo.com" value={configuration.baseUrl} onChange={(event) => updateConfiguration("baseUrl", event.target.value)} /></label>
          <label>Database<input required autoComplete="off" value={configuration.database} onChange={(event) => updateConfiguration("database", event.target.value)} /></label>
          <label>Integration user<input required autoComplete="username" value={configuration.username} onChange={(event) => updateConfiguration("username", event.target.value)} /></label>
          <label>API key<input type="password" required minLength={8} autoComplete="new-password" value={configuration.apiKey} onChange={(event) => updateConfiguration("apiKey", event.target.value)} /></label>
          <p>The API key is encrypted. Use a dedicated least-privilege Odoo user with read access to Products, Inventory, Fleet, and Warehouses, plus create/write access to draft Sales service orders.</p>
          <div className="integration-card-actions">
            {connected ? <Button type="button" onClick={() => setEditing(false)}>Cancel</Button> : null}
            <Button type="submit" variant="primary" disabled={Boolean(busy)}>{busy === "configure" ? "Verifying" : "Verify and save"}</Button>
          </div>
        </form>
      ) : (
        <>
          <dl className="integration-metadata">
            <div><dt>Database</dt><dd>{status.database || "Connected"}</dd></div>
            <div><dt>Mapped</dt><dd>{status.mappedCount || 0} of {status.locationCount || 0}</dd></div>
            <div><dt>Needs review</dt><dd>{status.unmatchedCount || 0}</dd></div>
          </dl>
          <div className="integration-card-actions">
            <Button icon={Settings01} onClick={() => setEditing(true)} disabled={Boolean(busy)}>Connection</Button>
            <Button icon={RefreshCw01} onClick={() => runAction("discover", "/api/integrations/odoo/discover-locations")} disabled={Boolean(busy)}>{busy === "discover" ? "Refreshing" : "Refresh locations"}</Button>
            <Button variant="primary" onClick={() => runAction("sync", "/api/integrations/odoo/sync")} disabled={Boolean(busy)}>{busy === "sync" ? "Syncing" : "Sync parts, inventory & history"}</Button>
          </div>
        </>
      )}

      {connected && mappingData.items.length ? (
        <section className="odoo-location-mappings" aria-labelledby="odoo-location-heading">
          <div><h3 id="odoo-location-heading">Inbound inventory stock locations</h3><p>Map Odoo stock locations to the app locations that receive their inventory balances.</p></div>
          <div className="odoo-location-list">
            {mappingData.items.map((item) => (
              <label key={item.externalId} className={item.status === "unmatched" ? "needs-review" : ""}>
                <span><strong>{item.completeName || item.displayName}</strong><small>Odoo ID {item.externalId}</small></span>
                <select aria-label={`App location for ${item.completeName || item.displayName}`} value={mappingValue(item)} disabled={busy === `mapping-${item.externalId}`} onChange={(event) => changeMapping(item, event.target.value)}>
                  <option value="">Unmatched</option>
                  {mappingData.appLocations.map((location) => <option key={location.id} value={location.id}>{location.name}</option>)}
                  <option value="__ignored">Ignore this location</option>
                </select>
              </label>
            ))}
          </div>
        </section>
      ) : connected ? <p className="integration-empty">Refresh locations to load Odoo inventory locations for matching.</p> : null}

      {connected ? (
        <section className="odoo-outbound-setup" aria-labelledby="odoo-outbound-heading">
          <div className="odoo-outbound-heading">
            <div>
              <h3 id="odoo-outbound-heading">Odoo outbound setup</h3>
              <p>Confirm the exact vehicle, warehouse, and labor product used when a workorder is sent to Odoo.</p>
            </div>
            <Button icon={RefreshCw01} onClick={discoverOutbound} disabled={Boolean(busy)}>
              {busy === "discover-outbound" ? "Refreshing" : "Refresh Odoo choices"}
            </Button>
          </div>

          <dl className="odoo-outbound-summary">
            <div><dt>Outbound</dt><dd className={outbound.state === "ready" ? "is-ready" : "needs-review"}>{outbound.state === "ready" ? "Ready" : "Needs setup"}</dd></div>
            <div><dt>Vehicles</dt><dd>{outbound.vehicles?.confirmedCount ?? outbound.vehicles?.mappedCount ?? 0} confirmed · {outbound.vehicles?.ignoredCount || 0} ignored · {outbound.vehicles?.unresolvedCount ?? outbound.vehicles?.unmatchedCount ?? 0} unresolved</dd></div>
            <div><dt>Warehouses</dt><dd>{outbound.warehouses?.confirmedCount ?? outbound.warehouses?.mappedCount ?? 0} confirmed · {outbound.warehouses?.unresolvedCount ?? outbound.warehouses?.unmatchedCount ?? 0} unresolved</dd></div>
            <div><dt>Labor</dt><dd>{outbound.labor?.status === "ready" ? "Ready" : outbound.labor?.status === "uom_warning" ? "UoM warning" : "Needs setup"}</dd></div>
          </dl>

          <div className="odoo-outbound-group" aria-labelledby="odoo-warehouse-heading">
            <div><h4 id="odoo-warehouse-heading">App locations to Odoo warehouses</h4><p>Each app location and Odoo warehouse can be confirmed only once.</p></div>
            <div className="odoo-outbound-list">
              {(outbound.warehouses?.items || []).map((item) => {
                const location = item.location || item;
                const currentValue = warehouseDrafts[location.id] ?? item.mapping?.externalId ?? "";
                const choices = item.candidates || outbound.warehouses?.available || [];
                return (
                  <div className={`odoo-outbound-row ${(item.mappingStatus || item.status) === "mapped" ? "" : "needs-review"}`} key={location.id}>
                    <span><strong>{location.name}</strong><small>{[location.type, location.address].filter(Boolean).join(" · ") || "App location"}</small></span>
                    <select aria-label={`Odoo warehouse for ${location.name}`} value={currentValue} disabled={busy === `warehouse-${location.id}`} onChange={(event) => setWarehouseDrafts((current) => ({ ...current, [location.id]: event.target.value }))}>
                      <option value="">Not mapped</option>
                      {choices.map((warehouse) => <option disabled={warehouse.assigned && warehouse.externalId !== item.mapping?.externalId} key={warehouse.externalId} value={warehouse.externalId}>{warehouse.code ? `${warehouse.code} · ` : ""}{warehouse.name}</option>)}
                    </select>
                    <Button aria-label={`Confirm Odoo warehouse for ${location.name}`} onClick={() => confirmWarehouseMapping(item)} disabled={busy === `warehouse-${location.id}`}>Confirm</Button>
                  </div>
                );
              })}
              {!outbound.warehouses?.items?.length ? <p className="integration-empty">No app locations are available for outbound warehouse matching.</p> : null}
            </div>
          </div>

          <div className="odoo-outbound-group" aria-labelledby="odoo-vehicle-heading">
            <div><h4 id="odoo-vehicle-heading">Vehicle mappings</h4><p>Suggestions are never confirmed automatically. Verify the Odoo ID, VIN, or plate before saving.</p></div>
            <form className="odoo-outbound-search" onSubmit={(event) => { event.preventDefault(); loadVehicles({ query: vehicleQuery }).catch((error) => setNotice({ error: error.message, message: "" })); }}>
              <label htmlFor="odoo-vehicle-search">Find app unit</label>
              <div><input id="odoo-vehicle-search" type="search" value={vehicleQuery} onChange={(event) => setVehicleQuery(event.target.value)} placeholder="Unit, VIN, or plate" /><Button type="submit">Search</Button></div>
            </form>
            <form className="odoo-outbound-search" onSubmit={(event) => { event.preventDefault(); loadOdooVehicles(odooVehicleQuery).catch((error) => setNotice({ error: error.message, message: "" })); }}>
              <label htmlFor="odoo-provider-vehicle-search">Find Odoo vehicle</label>
              <div><input id="odoo-provider-vehicle-search" type="search" value={odooVehicleQuery} onChange={(event) => setOdooVehicleQuery(event.target.value)} placeholder="Odoo name, ID, VIN, unit, or plate" /><Button type="submit">Search Odoo</Button></div>
            </form>
            <div className="odoo-outbound-list">
              {vehicleData.items.map((item) => {
                const asset = item.asset || item;
                const mappingStatus = item.mappingStatus || item.status;
                const currentValue = vehicleDrafts[asset.id]
                  ?? (mappingStatus === "ignored" ? "__ignored" : item.mapping?.externalId)
                  ?? "";
                const choices = [...new Map([...(item.candidates || []), ...odooVehicleOptions]
                  .map((candidate) => [candidate.externalId, candidate])).values()];
                const helperId = `odoo-vehicle-helper-${asset.id}`;
                return (
                  <div className={`odoo-outbound-row ${mappingStatus === "mapped" ? "" : mappingStatus === "ignored" ? "is-ignored" : "needs-review"}`} key={asset.id}>
                    <span><strong>{asset.unitNo || asset.name || "Unnamed unit"}</strong><small>{[asset.unitType, asset.vin && `VIN ${asset.vin}`, asset.licensePlate && `Plate ${asset.licensePlate}`].filter(Boolean).join(" · ")}</small></span>
                    <div className="odoo-vehicle-choice">
                      <input
                        aria-label={`Odoo vehicle ID for ${asset.unitNo || asset.name}`}
                        aria-describedby={helperId}
                        list={`odoo-vehicle-candidates-${asset.id}`}
                        value={currentValue}
                        disabled={busy === `vehicle-${asset.id}`}
                        onChange={(event) => setVehicleDrafts((current) => ({ ...current, [asset.id]: event.target.value }))}
                        placeholder="Odoo vehicle ID"
                      />
                      <datalist id={`odoo-vehicle-candidates-${asset.id}`}>
                        {choices.map((candidate) => <option key={candidate.externalId} value={candidate.externalId}>{candidate.name || "Odoo vehicle"} · VIN {candidate.vin || "not recorded"} · Plate {candidate.licensePlate || "not recorded"}{candidate.assigned ? " · Already assigned" : ""}</option>)}
                        <option value="__ignored">Ignore this unit for Odoo outbound</option>
                      </datalist>
                      <small id={helperId}>{mappingStatus === "ignored" ? "This unit is intentionally excluded." : "Search Odoo above, choose a result, or enter the exact Odoo vehicle ID."}</small>
                    </div>
                    <Button aria-label={`Confirm Odoo vehicle for ${asset.unitNo || asset.name || "unit"}`} onClick={() => confirmVehicleMapping(item)} disabled={busy === `vehicle-${asset.id}`}>Confirm</Button>
                  </div>
                );
              })}
              {!vehicleData.items.length ? <p className="integration-empty">No vehicle mappings match this view.</p> : null}
            </div>
            {vehicleData.nextCursor ? <Button aria-label="Load more application units" onClick={() => loadVehicles({ query: vehicleQuery, cursor: vehicleData.nextCursor, append: true }).catch((error) => setNotice({ error: error.message, message: "" }))}>Load more vehicles</Button> : null}
          </div>

          <div className="odoo-outbound-group" aria-labelledby="odoo-labor-heading">
            <div><h4 id="odoo-labor-heading">Labor product</h4><p>Choose the service product that will carry the work-performed description.</p></div>
            <div className={`odoo-labor-row ${outbound.labor?.status === "ready" ? "" : "needs-review"}`}>
              <select aria-label="Odoo labor product" value={laborProductDraft} disabled={busy === "labor-product"} onChange={(event) => setLaborProductDraft(event.target.value)}>
                <option value="">Not selected</option>
                {(outbound.labor?.products || outbound.laborProducts || []).map((product) => <option key={product.externalId} value={product.externalId}>{product.code ? `[${product.code}] ` : ""}{product.name} · {product.uomName || "Unknown UoM"}</option>)}
              </select>
              <Button onClick={confirmLaborProduct} disabled={!laborProductDraft || busy === "labor-product"}>Confirm labor product</Button>
            </div>
            {outbound.labor?.status === "uom_warning" ? <p className="odoo-outbound-warning" role="alert"><AlertCircle /> <span>{outbound.labor.warning || `The selected labor product uses ${outbound.labor.uomName || "an unknown unit"}, not a verified time UoM. Outbound entry remains disabled.`}</span></p> : null}
          </div>
        </section>
      ) : null}
    </article>
  );
}
