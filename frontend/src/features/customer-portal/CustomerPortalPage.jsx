import { useEffect, useRef, useState } from "react";
import { CustomerDocumentRenderer } from "../customer-documents/CustomerDocumentRenderer.jsx";
import { loadCustomerDocumentChat, loadCustomerPortal, respondToCustomerDocument, sendCustomerDocumentChat } from "./customer-portal-api.js";
import "./customer-portal.css";

function key() { return globalThis.crypto?.randomUUID?.() || `portal-${Date.now()}-${Math.random()}`; }
const terminalResponses = new Set(["accepted", "declined", "changes_requested"]);

function currentResponse(data, document) {
  return data?.currentResponse || data?.response || document?.response || { status: "pending" };
}

function grantCanRespond(data) {
  const eligibility = data?.eligibility || data?.grant?.eligibility || {};
  return data?.canRespond === true || data?.grant?.canRespond === true || data?.grant?.responseEligible === true || eligibility.canRespond === true || eligibility.respondRevision === true;
}

function portalRespondable(data, portalDocument) {
  const response = currentResponse(data, portalDocument);
  return data?.approvalRequired === true && portalDocument?.type === "estimate" && portalDocument.status === "issued" && response.status === "pending" && grantCanRespond(data);
}

function portalApprovalRequired(data, portalDocument) {
  return data?.approvalRequired === true || portalDocument?.approvalRequired === true;
}

function chatEnabled(data) {
  return data?.grant?.allowedActions?.includes("customer_chat") === true;
}

function CustomerDiscussion({ grant, enabled }) {
  const [chat, setChat] = useState({ loading: enabled, messages: [], error: "", sending: false });
  const [name, setName] = useState("");
  const [body, setBody] = useState("");
  const messageKey = useRef(key());
  useEffect(() => {
    let active = true;
    if (!enabled) { setChat({ loading: false, messages: [], error: "", sending: false }); return () => { active = false; }; }
    loadCustomerDocumentChat(grant).then((result) => {
      if (active) setChat({ loading: false, messages: result.messages || [], error: "", sending: false });
    }).catch((error) => {
      if (active) setChat({ loading: false, messages: [], error: error.message || "The discussion is unavailable.", sending: false });
    });
    return () => { active = false; };
  }, [grant, enabled]);
  const send = async (event) => {
    event.preventDefault();
    if (!name.trim() || !body.trim() || chat.sending) return;
    setChat((current) => ({ ...current, sending: true, error: "" }));
    try {
      const result = await sendCustomerDocumentChat({ grant, customerName: name.trim(), body: body.trim(), idempotencyKey: messageKey.current });
      messageKey.current = key();
      setBody("");
      setChat((current) => ({ ...current, sending: false, messages: [...current.messages, result.message] }));
    } catch (error) {
      setChat((current) => ({ ...current, sending: false, error: error.message || "Your message was not sent." }));
    }
  };
  if (!enabled) return null;
  return <section className="customer-portal-discussion" aria-labelledby="customer-discussion-title"><h2 id="customer-discussion-title">Message the shop</h2><p>Messages are about this repair document. They do not approve or change the estimate.</p>{chat.loading ? <p role="status">Loading messages…</p> : null}{chat.messages.length ? <ol className="customer-portal-message-list">{chat.messages.map((message) => <li key={message.id} className={`is-${message.senderType}`}><strong>{message.senderName}</strong><p>{message.body}</p><time dateTime={message.createdAt}>{new Date(message.createdAt).toLocaleString()}</time></li>)}</ol> : <p>No messages yet.</p>}{chat.error ? <p role="alert">{chat.error}</p> : null}<form onSubmit={send} className="customer-portal-chat-form"><label>Your name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label>Message<textarea required value={body} onChange={(event) => setBody(event.target.value)} rows="3" maxLength="5000" /></label><button type="submit" className="primary" disabled={chat.sending}>{chat.sending ? "Sending…" : "Send message"}</button></form></section>;
}

export function CustomerPortalPage({ grant }) {
  const [state, setState] = useState({ loading: true, data: null, error: "", response: "", submitting: false, confirmation: false });
  const [name, setName] = useState(""); const [note, setNote] = useState(""); const requestKey = useRef(key());
  useEffect(() => { let active = true; setState((current) => ({ ...current, loading: true, error: "" })); loadCustomerPortal(grant).then((data) => { if (active) setState({ loading: false, data, error: "", response: "", submitting: false, confirmation: false }); }).catch((error) => { if (active) setState({ loading: false, data: null, error: error.message || "This document is unavailable.", response: "", submitting: false, confirmation: false }); }); return () => { active = false; }; }, [grant]);
  const portalDocument = state.data?.document;
  const respondable = portalRespondable(state.data, portalDocument);
  const approvalRequired = portalApprovalRequired(state.data, portalDocument);
  useEffect(() => {
    if (!respondable) return undefined;
    let active = true;
    const refresh = async () => {
      if (globalThis.document?.hidden) return;
      try {
        const data = await loadCustomerPortal(grant);
        if (active) setState((current) => ({ ...current, data, error: "", confirmation: portalRespondable(data, data.document) ? current.confirmation : false }));
      } catch (error) {
        if (active) setState((current) => ({ ...current, data: current.data ? { ...current.data, grant: { ...(current.data.grant || {}), responseEligible: false } } : null, confirmation: false, error: error.message || "The document status could not be verified." }));
      }
    };
    const interval = setInterval(refresh, 3000);
    globalThis.document?.addEventListener?.("visibilitychange", refresh);
    return () => { active = false; clearInterval(interval); globalThis.document?.removeEventListener?.("visibilitychange", refresh); };
  }, [grant, respondable]);
  const submit = async () => {
    if (!state.response || !name.trim()) return;
    setState((current) => ({ ...current, submitting: true, error: "" }));
    try {
      const fresh = await loadCustomerPortal(grant);
      if (!portalRespondable(fresh, fresh.document)) {
        setState((current) => ({ ...current, data: fresh, submitting: false, confirmation: false, error: "This Estimate is no longer available for a response." }));
        return;
      }
      await respondToCustomerDocument({ grant, response: state.response, customerName: name.trim(), note: note.trim(), idempotencyKey: requestKey.current });
      setState((current) => ({
        ...current,
        submitting: false,
        confirmation: false,
        data: { ...current.data, currentResponse: { status: state.response, customerName: name.trim() }, document: { ...current.data.document, response: { ...(current.data.document.response || {}), status: state.response, customerName: name.trim() }, status: current.data.document.status } },
      }));
    } catch (error) {
      setState((current) => ({ ...current, submitting: false, error: error.message || "Your response was not saved. Try again." }));
    }
  };
  if (state.loading) return <main className="customer-portal-page"><p role="status">Loading your document…</p></main>;
  if (state.error && !portalDocument) return <main className="customer-portal-page"><section className="customer-portal-state" role="alert"><h1>Document unavailable</h1><p>{state.error}</p><p>Check the link or contact the shop for a new secure link.</p></section></main>;
  const response = currentResponse(state.data, portalDocument);
  return <main className="customer-portal-page"><header className="customer-portal-header"><p>Customer repair portal</p><h1>{portalDocument.shop.name || "Repair estimate"}</h1></header><CustomerDocumentRenderer projection={portalDocument}/>{state.error ? <p role="alert">{state.error}</p> : null}{respondable ? <section className="customer-portal-response" aria-labelledby="customer-response-title"><h2 id="customer-response-title">Respond to this estimate</h2><p>Your response applies only to {portalDocument.number}{portalDocument.revision ? ` ${portalDocument.revision}` : ""}.</p>{!state.confirmation ? <div className="customer-portal-response-actions"><button type="button" onClick={() => setState((current) => ({ ...current, response: "changes_requested", confirmation: true }))}>Request changes</button><button type="button" onClick={() => setState((current) => ({ ...current, response: "declined", confirmation: true }))}>Decline</button><button type="button" className="primary" onClick={() => setState((current) => ({ ...current, response: "accepted", confirmation: true }))}>Approve estimate</button></div> : <form onSubmit={(event) => { event.preventDefault(); submit(); }}><h3>{state.response === "accepted" ? "Approve estimate" : state.response === "declined" ? "Decline estimate" : "Request changes"}</h3><p><strong>{portalDocument.number}{portalDocument.revision ? ` · ${portalDocument.revision}` : ""}</strong></p><label>Your name<input required value={name} onChange={(event) => setName(event.target.value)} autoComplete="name" /></label><label>Note {state.response === "changes_requested" ? "(recommended)" : "(optional)"}<textarea value={note} onChange={(event) => setNote(event.target.value)} rows="3" /></label><div className="customer-portal-response-actions"><button type="button" onClick={() => setState((current) => ({ ...current, confirmation: false }))} disabled={state.submitting}>Back</button><button className="primary" type="submit" disabled={state.submitting}>{state.submitting ? "Saving response…" : "Confirm response"}</button></div></form>}</section> : <section className="customer-portal-state" role="status"><h2>{!approvalRequired ? "No approval needed" : terminalResponses.has(response.status) ? "Response recorded" : "Response unavailable"}</h2><p>{!approvalRequired ? "This estimate is for your review. You can message the shop with questions, but no approval is required." : terminalResponses.has(response.status) ? `Your response is ${response.status.replaceAll("_", " ")}.` : `This ${portalDocument.type} is ${portalDocument.status.replaceAll("_", " ")}.`}</p></section>}<CustomerDiscussion grant={grant} enabled={chatEnabled(state.data)} /></main>;
}
