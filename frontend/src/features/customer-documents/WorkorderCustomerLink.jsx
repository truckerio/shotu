import { useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { createRepairLink, emailRepairLink, repairRequestKey, revokeRepairLink } from "../customer-portal/customer-repair-api.js";

export function WorkorderCustomerLink({ companyId, locationId, workorderId, recipientEmail = "", disabled = false }) {
  const [link, setLink] = useState(null);
  const [expanded, setExpanded] = useState(false);
  const [email, setEmail] = useState(recipientEmail);
  const [state, setState] = useState({ busy: false, error: "", message: "" });
  const active = useRef(true);
  const createKey = useRef("");
  const sendKey = useRef("");
  const expiry = useRef("");
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  async function create() {
    if (state.busy || disabled) return;
    setExpanded(true);
    if (link) { setState((s) => ({ ...s, error: "" })); return; }
    setState({ busy: true, error: "", message: "" });
    try {
      createKey.current ||= repairRequestKey();
      expiry.current ||= new Date(Date.now() + 30 * 86400000).toISOString();
      const result = await createRepairLink({ companyId, locationId, workorderId, expiresAt: expiry.current, idempotencyKey: createKey.current });
      if (!active.current) return;
      if (!result.rawToken) { createKey.current = ""; expiry.current = ""; throw new Error("The link secret is no longer available. Create a new link to continue."); }
      setLink({ ...result, link: result.link || `${window.location.origin}/#customerRepair=${result.rawToken}` });
      setState({ busy: false, error: "", message: "" });
    } catch (error) { if (active.current) setState({ busy: false, error: error.message, message: "" }); }
  }
  async function copy() {
    try { await navigator.clipboard.writeText(link.link); setState((s) => ({ ...s, message: "Link copied", error: "" })); }
    catch { setState((s) => ({ ...s, error: "Copy failed. Open the customer page and copy its address." })); }
  }
  async function send(event) {
    event.preventDefault(); if (!link || state.busy) return;
    if (["failed", "not_configured"].includes(state.deliveryStatus)) sendKey.current = "";
    setState({ busy: true, error: "", message: "" });
    try {
      sendKey.current ||= repairRequestKey();
      const result = await emailRepairLink({ companyId, locationId, workorderId, grantId: link.grant.id, rawToken: link.rawToken, recipientEmail: email.trim(), idempotencyKey: sendKey.current });
      if (!active.current) return;
      if (!result.providerAccepted) {
        setState({ busy: false, deliveryStatus: result.status, message: "", error: result.status === "not_configured" ? "Email sending is not configured. Copy the customer link instead." : result.status === "requested" ? "Email status is unconfirmed. Copy the link or check with the shop before sending again." : "The email was not accepted. Copy the link or retry." });
        return;
      }
      setState({ busy: false, error: "", message: "Email accepted by mail server" });
    } catch (error) { if (active.current) setState({ busy: false, error: error.message, message: "" }); }
  }
  async function revoke() {
    if (state.busy) return;
    setState({ busy: true, error: "", message: "" });
    try {
      await revokeRepairLink({ companyId, locationId, workorderId, grantId: link.grant.id });
      if (!active.current) return;
      setLink(null); createKey.current = ""; expiry.current = ""; sendKey.current = "";
      setState({ busy: false, error: "", message: "Link disabled" });
    } catch (error) { if (active.current) setState({ busy: false, error: error.message, message: "" }); }
  }
  return <section className="workorder-customer-link" aria-label="Customer repair link">
    {!expanded ? <Button variant="secondary" disabled={disabled} onClick={create}>Customer link</Button> : <>
      <div className="workorder-link-actions">
        {link ? <><Button variant="secondary" onClick={copy} disabled={state.busy}>Copy link</Button><a className="button secondary" href={link.link} target="_blank" rel="noopener noreferrer">Open customer view</a><details><summary>More</summary><button type="button" onClick={revoke} disabled={state.busy}>Disable link</button></details></> : <Button variant="secondary" onClick={create} disabled={state.busy}>{state.busy ? "Creating link…" : "Create customer link"}</Button>}
        <button type="button" className="workorder-link-close" onClick={() => setExpanded(false)} aria-label="Close customer link options">×</button>
      </div>
      {link ? <form className="workorder-link-email" onSubmit={send}><label htmlFor="repair-link-email">Customer email</label><div><input id="repair-link-email" type="email" autoComplete="email" required maxLength={320} value={email} disabled={state.busy} placeholder="customer@example.com" onChange={(event) => { setEmail(event.target.value); sendKey.current = ""; setState((s) => ({ ...s, message: "", error: "" })); }} /><Button type="submit" variant="primary" disabled={state.busy}>{state.busy ? "Sending…" : ["failed", "not_configured"].includes(state.deliveryStatus) ? "Retry email" : "Send link"}</Button></div></form> : null}
    </>}
    {state.error ? <p role="alert">{state.error}</p> : null}{state.message ? <p role="status">{state.message}</p> : null}
  </section>;
}
