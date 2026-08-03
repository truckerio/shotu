import { useCallback, useEffect, useState } from "react";
import { AlertCircle, CheckCircle, RefreshCw01, Settings01 } from "@untitledui/icons";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";

const EMPTY_CONFIGURATION = { baseUrl: "", database: "", username: "", apiKey: "" };

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
  const [busy, setBusy] = useState("");
  const [notice, setNotice] = useState({ error: "", message: "" });

  const loadMappings = useCallback(async () => {
    if (!status?.configured) return;
    const result = await api("/api/integrations/odoo/locations");
    setMappingData(result);
  }, [status?.configured]);

  useEffect(() => {
    loadMappings().catch((error) => setNotice({ error: error.message, message: "" }));
  }, [loadMappings]);

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
          <p>The API key is encrypted. Use a dedicated read-only Odoo user with access to Products, Inventory, and Sales service orders.</p>
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
          <div><h3 id="odoo-location-heading">Location matching</h3><p>Odoo names can differ. Choose the real app location for each Odoo stock location.</p></div>
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
    </article>
  );
}
