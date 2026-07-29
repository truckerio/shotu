import { useCallback, useEffect, useState } from "react";
import { AlertCircle, RefreshCw01, Trash01, XClose } from "@untitledui/icons";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { api } from "../../../lib/api.js";
import { integrationProvider } from "./provider-registry.js";
import { SamsaraIntegrationCard } from "./SamsaraIntegrationCard.jsx";
import { IntegrationClientsCard } from "./IntegrationClientsCard.jsx";
import "./integrations.css";

const samsaraProvider = integrationProvider("samsara");

function callbackResult() {
  const params = new URLSearchParams(window.location.search);
  const result = params.get("samsara");
  const message = params.get("message") || "";
  if (!result) return null;
  params.set("adminView", "settings");
  params.set("settingsTab", "integrations");
  params.delete("samsara");
  params.delete("message");
  window.history.replaceState({}, "", `/?${params.toString()}`);
  return result === "connected"
    ? { message: "Samsara connected.", error: "" }
    : { message: "", error: message || "Samsara connection failed." };
}

export function IntegrationsSettings() {
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(() => callbackResult() || { message: "", error: "" });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [clients, setClients] = useState([]);
  const [createdToken, setCreatedToken] = useState("");

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [result, clientResult] = await Promise.all([
        api("/api/integrations/samsara/status"),
        api("/api/integrations/clients"),
      ]);
      setStatus(result);
      setClients(clientResult.clients || []);
    } catch (error) {
      setNotice((current) => ({ ...current, error: error.message }));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  function connect() {
    window.location.assign("/api/integrations/samsara/oauth/start");
  }

  async function runAction(name, path, successMessage) {
    setAction(name);
    setNotice({ message: "", error: "" });
    try {
      const result = await api(path, { method: "POST", timeoutMs: name === "sync" ? 120_000 : 20_000 });
      if (result?.status === "failed") throw new Error(result.error || "Samsara sync failed.");
      setNotice({ message: successMessage, error: "" });
      await loadStatus();
    } catch (error) {
      setStatus((current) => ({ ...(current || {}), status: "error", error: error.message }));
      setNotice({ message: "", error: error.message });
    } finally {
      setAction("");
    }
  }

  async function disconnect() {
    setAction("disconnect");
    setNotice({ message: "", error: "" });
    try {
      await api("/api/integrations/samsara", { method: "DELETE", timeoutMs: 20_000 });
      setConfirmDisconnect(false);
      setStatus(null);
      setNotice({ message: "Samsara disconnected.", error: "" });
      await loadStatus();
    } catch (error) {
      setNotice({ message: "", error: error.message });
    } finally {
      setAction("");
    }
  }

  async function createClient(name) {
    setAction("create-client");
    setNotice({ message: "", error: "" });
    try {
      const result = await api("/api/integrations/clients", {
        method: "POST",
        body: JSON.stringify({
          name,
          scopes: ["workorders:read", "workorders:write"],
        }),
      });
      setCreatedToken(result.token || "");
      setClients((current) => [result.client, ...current]);
    } catch (error) {
      setNotice({ message: "", error: error.message });
    } finally {
      setAction("");
    }
  }

  async function revokeClient(clientId) {
    setAction(`revoke-${clientId}`);
    setNotice({ message: "", error: "" });
    try {
      const result = await api(`/api/integrations/clients/${encodeURIComponent(clientId)}/revoke`, {
        method: "POST",
        body: "{}",
      });
      setClients((current) => current.map((client) => client.id === clientId ? result.client : client));
      setNotice({ message: "Integration client revoked.", error: "" });
    } catch (error) {
      setNotice({ message: "", error: error.message });
    } finally {
      setAction("");
    }
  }

  return (
    <section className="admin-content admin-settings-content">
      <PageHeader
        title="Settings"
        subtitle="Company-level connections and configuration."
      />
      <nav className="admin-settings-tabs" aria-label="Company settings">
        <button className="active" type="button">Integrations</button>
      </nav>

      <div className="integration-page-heading">
        <div>
          <h2>Integrations</h2>
          <p>Connect external systems once for every authorized company location.</p>
        </div>
      </div>

      {notice.error ? <p className="integration-notice error" role="alert"><AlertCircle /> <span>{notice.error}</span></p> : null}
      {notice.message ? <p className="integration-notice success" role="status">{notice.message}</p> : null}

      {loading && !status ? (
        <div className="integration-loading"><RefreshCw01 className="loading-icon" /><span>Loading integrations</span></div>
      ) : (
        <div className="integration-provider-grid">
          <SamsaraIntegrationCard
            action={action}
            provider={samsaraProvider}
            status={status}
            onConnect={connect}
            onTest={() => runAction("test", "/api/integrations/samsara/test", "Samsara connection verified.")}
            onSync={() => runAction("sync", "/api/integrations/samsara/sync", "Samsara sync completed.")}
            onDisconnect={() => setConfirmDisconnect(true)}
          />
          <IntegrationClientsCard
            clients={clients}
            busy={action.startsWith("create-client") || action.startsWith("revoke-")}
            createdToken={createdToken}
            onCreate={createClient}
            onRevoke={revokeClient}
            onDismissToken={() => setCreatedToken("")}
          />
        </div>
      )}

      {confirmDisconnect ? (
        <div className="integration-confirm-backdrop" role="presentation" onMouseDown={(event) => event.target === event.currentTarget && setConfirmDisconnect(false)}>
          <section className="integration-confirm" role="alertdialog" aria-modal="true" aria-labelledby="disconnect-title" aria-describedby="disconnect-description">
            <header>
              <span className="integration-confirm-icon"><Trash01 /></span>
              <button type="button" onClick={() => setConfirmDisconnect(false)} aria-label="Close"><XClose /></button>
            </header>
            <h2 id="disconnect-title">Disconnect Samsara?</h2>
            <p id="disconnect-description">Automatic unit, odometer, and location updates will stop. Existing workorders and cached unit data remain.</p>
            <footer>
              <Button onClick={() => setConfirmDisconnect(false)} disabled={Boolean(action)}>Cancel</Button>
              <Button variant="danger" icon={Trash01} onClick={disconnect} disabled={Boolean(action)}>
                {action === "disconnect" ? "Disconnecting" : "Disconnect Samsara"}
              </Button>
            </footer>
          </section>
        </div>
      ) : null}
    </section>
  );
}
