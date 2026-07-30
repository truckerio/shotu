import {
  AlertCircle,
  CheckCircle,
  Link01,
  RefreshCw01,
  Trash01,
} from "@untitledui/icons";
import { Button } from "../../../components/ui/Button.jsx";

function dateTime(value) {
  if (!value) return "Never";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "Not available";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

function authLabel(value) {
  if (value === "oauth") return "OAuth";
  if (value === "api_token") return "API token";
  return "Not connected";
}

function normalizedState(status) {
  if (status?.status === "error" || status?.latestSync?.status === "failed") return "error";
  if (status?.configured) return "connected";
  return "disconnected";
}

export function SamsaraIntegrationCard({
  action = "",
  actionError = "",
  onConnect,
  onDisconnect,
  onSync,
  onTest,
  provider,
  status,
}) {
  const state = normalizedState(status);
  const connected = state !== "disconnected";
  const serverManagedToken = status?.authType === "api_token";
  const lastSuccessfulSync = status?.lastSuccessfulSyncAt
    || status?.last_full_sync_at
    || status?.lastFullSyncAt
    || status?.latestSync?.completedAt
    || null;
  const latestSyncAt = status?.latestSync?.finishedAt
    || status?.latestSync?.startedAt
    || status?.latestSyncAt
    || lastSuccessfulSync;
  const latestSyncStatus = status?.latestSync?.status || (lastSuccessfulSync ? "completed" : "Not run");
  const error = actionError || status?.error || status?.lastError || status?.latestSync?.error || "";
  const ProviderIcon = provider.icon;

  return (
    <article className="integration-card">
      <header className="integration-card-header">
        <span className="integration-provider-icon"><ProviderIcon /></span>
        <div>
          <h2>{provider.name}</h2>
          <p>{provider.category}</p>
        </div>
        <span className={`integration-status ${state}`}>
          {state === "connected" ? <CheckCircle /> : state === "error" ? <AlertCircle /> : null}
          {state === "connected" ? "Connected" : state === "error" ? "Needs attention" : "Not connected"}
        </span>
      </header>

      <p className="integration-description">{provider.description}</p>

      <dl className="integration-metadata">
        <div><dt>Authentication</dt><dd>{authLabel(status?.authType)}</dd></div>
        <div><dt>Last successful sync</dt><dd>{dateTime(lastSuccessfulSync)}</dd></div>
        <div><dt>Latest sync</dt><dd>{latestSyncStatus === "Not run" ? latestSyncStatus : `${latestSyncStatus} · ${dateTime(latestSyncAt)}`}</dd></div>
      </dl>

      {error ? <p className="integration-card-error" role="alert"><AlertCircle /> <span>{error}</span></p> : null}
      {serverManagedToken ? (
        <p className="integration-card-note">
          This connection uses a server-managed API token. Connect with OAuth to manage it here.
        </p>
      ) : null}

      <footer className="integration-card-actions">
        <Button variant={connected ? "secondary" : "primary"} icon={Link01} onClick={onConnect} disabled={Boolean(action)}>
          {serverManagedToken ? "Connect with OAuth" : connected ? "Reconnect" : "Connect"}
        </Button>
        <Button onClick={onTest} disabled={!connected || Boolean(action)}>
          {action === "test" ? "Testing" : "Test connection"}
        </Button>
        <Button icon={RefreshCw01} onClick={onSync} disabled={!connected || Boolean(action)}>
          {action === "sync" ? "Syncing" : "Sync now"}
        </Button>
        {connected && !serverManagedToken ? (
          <Button variant="danger" icon={Trash01} onClick={onDisconnect} disabled={Boolean(action)}>
            Disconnect
          </Button>
        ) : null}
      </footer>
    </article>
  );
}
