import "./customer-estimate-delivery.css";

function deliveryCopy(status) {
  if (status === "provider_accepted") return "Accepted by email provider. This is not proof that the customer received or opened it.";
  if (status === "requested") return "Email request recorded.";
  if (status === "not_configured") return "Email not configured. Copy the secure link instead.";
  if (status === "failed") return "Email failed—copy link instead.";
  return "Enter the recipient email or use Copy customer link for manual delivery.";
}

export function CustomerEstimateDelivery({ email = "", status = "", busy = false, onEmailChange, onSend }) {
  return <section className="customer-estimate-delivery" aria-labelledby="customer-estimate-delivery-title">
    <h3 id="customer-estimate-delivery-title">Send estimate email</h3>
    <p>The secure link remains available to copy for manual delivery.</p>
    <label>Email address <span>(optional)</span><input type="email" value={email} onChange={(event) => onEmailChange?.(event.target.value)} autoComplete="email" /></label>
    <button type="button" className="button secondary" disabled={busy} onClick={onSend}>{busy ? "Requesting email…" : "Send estimate email"}</button>
    <p role="status">{deliveryCopy(status)}</p>
  </section>;
}
