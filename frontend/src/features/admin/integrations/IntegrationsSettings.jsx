import { useCallback, useEffect, useState } from "react";
import { AlertCircle, Key01, RefreshCw01, Trash01, XClose } from "@untitledui/icons";
import { PageHeader } from "../../../components/layout/PageHeader.jsx";
import { Button } from "../../../components/ui/Button.jsx";
import { ContextBreadcrumbs } from "../../../components/ui/ContextBreadcrumbs.jsx";
import { isPlainPrimaryActivation } from "../../../components/ui/context-navigation.js";
import { api } from "../../../lib/api.js";
import { integrationProvider } from "./provider-registry.js";
import { SamsaraIntegrationCard } from "./SamsaraIntegrationCard.jsx";
import { IntegrationClientsCard } from "./IntegrationClientsCard.jsx";
import { IntegrationSummaryCard } from "./IntegrationSummaryCard.jsx";
import { OdooIntegrationCard } from "./OdooIntegrationCard.jsx";
import { samsaraPresentation } from "./samsara-status.js";
import "./integrations.css";

const samsaraProvider = integrationProvider("samsara");
const odooProvider = integrationProvider("odoo");
const INTEGRATION_DETAILS = new Set(["samsara", "odoo", "clients"]);

function selectedIntegrationFromLocation() {
  const selected = new URLSearchParams(window.location.search).get("integration");
  return INTEGRATION_DETAILS.has(selected) ? selected : "";
}

function dateLabel(value) {
  if (!value) return "Not yet synced";
  return new Intl.DateTimeFormat(undefined, { dateStyle: "medium" }).format(new Date(value));
}

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
  const [odooStatus, setOdooStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [action, setAction] = useState("");
  const [notice, setNotice] = useState(() => callbackResult() || { message: "", error: "", target: "" });
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [clients, setClients] = useState([]);
  const [createdToken, setCreatedToken] = useState("");
  const [selectedIntegration, setSelectedIntegration] = useState(selectedIntegrationFromLocation);

  const loadStatus = useCallback(async () => {
    setLoading(true);
    try {
      const [result, odooResult, clientResult] = await Promise.all([
        api("/api/integrations/samsara/status"),
        api("/api/integrations/odoo/status"),
        api("/api/integrations/clients"),
      ]);
      setStatus(result);
      setOdooStatus(odooResult);
      setClients(clientResult.clients || []);
    } catch (error) {
      setNotice({ message: "", error: error.message, target: "samsara" });
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadStatus();
  }, [loadStatus]);

  useEffect(() => {
    function syncDetailFromHistory() {
      setSelectedIntegration(selectedIntegrationFromLocation());
    }
    window.addEventListener("popstate", syncDetailFromHistory);
    return () => window.removeEventListener("popstate", syncDetailFromHistory);
  }, []);

  function showIntegration(integrationId) {
    const params = new URLSearchParams(window.location.search);
    if (integrationId) params.set("integration", integrationId);
    else params.delete("integration");
    window.history.pushState({}, "", `/?${params.toString()}`);
    setSelectedIntegration(integrationId);
  }

  function followSettingsBreadcrumb(event) {
    if (!isPlainPrimaryActivation(event)) return;
    event.preventDefault();
    const returnTitle = detailTitle;
    showIntegration("");
    window.requestAnimationFrame(() => window.requestAnimationFrame(() => {
      const origin = [...document.querySelectorAll(".integration-summary-card")]
        .find((card) => card.querySelector("h2")?.textContent?.trim() === returnTitle);
      origin?.querySelector("button")?.focus({ preventScroll: true });
    }));
  }

  function connect() {
    window.location.assign("/api/integrations/samsara/oauth/start");
  }

  async function runAction(name, path, successMessage) {
    setAction(name);
    setNotice({ message: "", error: "", target: "" });
    try {
      const result = await api(path, { method: "POST", timeoutMs: name === "sync" ? 120_000 : 20_000 });
      if (result?.status === "failed") throw new Error(result.error || "Samsara sync failed.");
      setNotice({ message: successMessage, error: "", target: "samsara" });
      await loadStatus();
    } catch (error) {
      setNotice({ message: "", error: error.message, target: "samsara" });
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
      setNotice({ message: "Samsara disconnected.", error: "", target: "samsara" });
      await loadStatus();
    } catch (error) {
      setNotice({ message: "", error: error.message, target: "samsara" });
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
      setNotice({ message: "", error: error.message, target: "clients" });
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
      setNotice({ message: "Integration client revoked.", error: "", target: "clients" });
    } catch (error) {
      setNotice({ message: "", error: error.message, target: "clients" });
    } finally {
      setAction("");
    }
  }

  const samsaraState = samsaraPresentation(status);
  const activeClientCount = clients.filter((client) => client.active).length;
  const detailTitle = selectedIntegration === "samsara"
    ? samsaraProvider.name
    : selectedIntegration === "odoo"
      ? odooProvider.name
      : selectedIntegration === "clients"
        ? "Machine clients"
        : "Settings";
  const detailSubtitle = selectedIntegration === "samsara"
    ? samsaraProvider.description
    : selectedIntegration === "odoo"
      ? odooProvider.description
      : selectedIntegration === "clients"
        ? "Manage company-scoped credentials for trusted external systems."
        : "Company-level connections and configuration.";

  return (
    <section className="admin-content admin-settings-content">
      <PageHeader
        title={detailTitle}
        subtitle={detailSubtitle}
        leading={selectedIntegration ? <ContextBreadcrumbs
          items={[{
            label: "Settings",
            href: "/?adminView=settings&settingsTab=integrations",
            onClick: followSettingsBreadcrumb,
          }]}
          current={detailTitle}
        /> : null}
      />
      <nav className="admin-settings-tabs" aria-label="Company settings">
        <button className="active" type="button">Integrations</button>
      </nav>

      {!selectedIntegration ? (
        <div className="integration-page-heading">
          <div>
            <h2>Integrations</h2>
            <p>Connect external systems once for every authorized company location.</p>
          </div>
        </div>
      ) : null}

      {notice.error && notice.target !== "samsara" ? <p className="integration-notice error" role="alert"><AlertCircle /> <span>{notice.error}</span></p> : null}
      {notice.message ? <p className="integration-notice success" role="status">{notice.message}</p> : null}

      {loading && !status ? (
        <div className="integration-loading"><RefreshCw01 className="loading-icon" /><span>Loading integrations</span></div>
      ) : !selectedIntegration ? (
        <div className="integration-provider-grid">
          <IntegrationSummaryCard
            category={samsaraProvider.category}
            description={samsaraProvider.description}
            facts={[{ label: "Last successful sync", value: dateLabel(status?.lastSuccessfulSyncAt || status?.last_full_sync_at || status?.lastFullSyncAt) }]}
            icon={samsaraProvider.icon}
            onManage={() => showIntegration("samsara")}
            statusLabel={samsaraState.label}
            statusTone={samsaraState.tone}
            title={samsaraProvider.name}
          />
          <IntegrationSummaryCard
            category={odooProvider.category}
            description={odooProvider.description}
            facts={[{ label: "Location mappings", value: `${odooStatus?.mappedCount || 0} mapped · ${odooStatus?.unmatchedCount || 0} to review` }]}
            icon={odooProvider.icon}
            onManage={() => showIntegration("odoo")}
            statusLabel={odooStatus?.configured ? "Configured" : "Not configured"}
            statusTone={odooStatus?.configured ? "connected" : "disconnected"}
            title={odooProvider.name}
          />
          <IntegrationSummaryCard
            category="External API access"
            description="Issue company-scoped credentials for Odoo or another trusted server."
            facts={[{ label: "Active clients", value: activeClientCount }]}
            icon={Key01}
            onManage={() => showIntegration("clients")}
            statusLabel={activeClientCount ? "Active" : "Not configured"}
            statusTone={activeClientCount ? "connected" : "disconnected"}
            title="Machine clients"
          />
        </div>
      ) : (
        <div className="integration-detail-view">
          {selectedIntegration === "samsara" ? (
            <SamsaraIntegrationCard
              action={action}
              actionError={notice.target === "samsara" ? notice.error : ""}
              provider={samsaraProvider}
              status={status}
              onConnect={connect}
              onTest={() => runAction("test", "/api/integrations/samsara/test", "Samsara connection verified.")}
              onSync={() => runAction("sync", "/api/integrations/samsara/sync", "Samsara sync completed.")}
              onDisconnect={() => setConfirmDisconnect(true)}
            />
          ) : null}
          {selectedIntegration === "odoo" ? <OdooIntegrationCard provider={odooProvider} status={odooStatus} onStatusChange={setOdooStatus} /> : null}
          {selectedIntegration === "clients" ? (
            <IntegrationClientsCard
              clients={clients}
              busy={action.startsWith("create-client") || action.startsWith("revoke-")}
              createdToken={createdToken}
              onCreate={createClient}
              onRevoke={revokeClient}
              onDismissToken={() => setCreatedToken("")}
            />
          ) : null}
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
