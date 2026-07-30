import { useState } from "react";
import { Button } from "../../../components/ui/Button.jsx";
import { textEntryProps } from "../../../components/forms/text-entry-policy.js";

function dateLabel(value) {
  if (!value) return "Never";
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(new Date(value));
}

export function IntegrationClientsCard({
  clients,
  busy,
  createdToken,
  onCreate,
  onRevoke,
  onDismissToken,
}) {
  const [name, setName] = useState("Odoo production");
  const [copied, setCopied] = useState(false);

  async function create(event) {
    event.preventDefault();
    await onCreate(name);
  }

  async function copyToken() {
    await navigator.clipboard.writeText(createdToken);
    setCopied(true);
  }

  return (
    <article className="integration-card integration-access-card">
      <header className="integration-access-header">
        <div>
          <p className="integration-eyebrow">External API access</p>
          <h2>Machine clients</h2>
        </div>
        <span className="integration-client-count">{clients.length}</span>
      </header>
      <p className="integration-description">
        Issue a company-scoped credential for Odoo or another trusted server. The raw token is shown once.
      </p>

      {createdToken ? (
        <section className="integration-token-result" aria-live="polite">
          <strong>Copy this token now</strong>
          <p>It cannot be shown again. Store it in the external system&apos;s secret manager.</p>
          <code>{createdToken}</code>
          <div>
            <Button type="button" variant="primary" onClick={copyToken}>{copied ? "Copied" : "Copy token"}</Button>
            <Button type="button" onClick={onDismissToken}>Done</Button>
          </div>
        </section>
      ) : (
        <form className="integration-client-form" onSubmit={create}>
          <label htmlFor="integration-client-name">Client name</label>
          <div>
            <input
              {...textEntryProps("name")}
              id="integration-client-name"
              value={name}
              onChange={(event) => setName(event.target.value)}
              maxLength="120"
              required
            />
            <Button variant="primary" type="submit" disabled={busy || !name.trim()}>
              {busy ? "Creating" : "Create client"}
            </Button>
          </div>
          <p>Scopes: read workorders and report Odoo results.</p>
        </form>
      )}

      <div className="integration-client-list">
        {clients.length ? clients.map((client) => (
          <article key={client.id}>
            <div>
              <strong>{client.name}</strong>
              <span>Prefix {client.token_prefix} · Last used {dateLabel(client.last_used_at)}</span>
            </div>
            <span className={`integration-status ${client.active ? "connected" : "disconnected"}`}>
              {client.active ? "Active" : "Revoked"}
            </span>
            {client.active ? (
              <Button type="button" variant="danger" disabled={busy} onClick={() => onRevoke(client.id)}>
                Revoke
              </Button>
            ) : null}
          </article>
        )) : <p className="integration-empty">No machine clients created.</p>}
      </div>
    </article>
  );
}
