import { useCallback, useEffect, useRef, useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import {
  customerDocumentCommandKey,
  readWorkorderCustomerChat,
  sendWorkorderCustomerChat,
} from "./customer-estimate-api.js";

function senderLabel(message) {
  if (message.senderName) return message.senderName;
  return (message.senderType || message.senderRole) === "customer" ? "Customer" : "Shop team";
}

function senderClass(message) {
  return (message.senderType || message.senderRole) === "customer" ? "is-customer" : "is-staff";
}

function messageTime(value) {
  if (!value) return "";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? "" : date.toLocaleString();
}

export function WorkorderCustomerChat({ companyId, locationId, workorderId, document }) {
  const [messages, setMessages] = useState([]);
  const [body, setBody] = useState("");
  const [state, setState] = useState({ loading: true, sending: false, error: "" });
  const messageKey = useRef(customerDocumentCommandKey("staff-customer-chat"));
  const documentId = document?.documentId;
  const revisionId = document?.id;
  const scopeKey = `${companyId || ""}:${locationId || ""}:${workorderId || ""}:${documentId || ""}:${revisionId || ""}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const load = useCallback(async () => {
    if (!documentId || !revisionId) return;
    const requestedScope = scopeKey;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await readWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId });
      if (scopeKeyRef.current !== requestedScope) return;
      setMessages(result.messages || []);
      setState((current) => ({ ...current, loading: false }));
    } catch (error) {
      if (scopeKeyRef.current !== requestedScope) return;
      setState((current) => ({ ...current, loading: false, error: error.message || "Customer messages could not be loaded." }));
    }
  }, [companyId, locationId, workorderId, documentId, revisionId, scopeKey]);

  useEffect(() => {
    let active = true;
    if (!documentId || !revisionId) {
      setMessages([]);
      setState({ loading: false, sending: false, error: "" });
      return () => { active = false; };
    }
    setMessages([]);
    setState({ loading: true, sending: false, error: "" });
    readWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId }).then((result) => {
      if (active) {
        setMessages(result.messages || []);
        setState({ loading: false, sending: false, error: "" });
      }
    }).catch((error) => {
      if (active) setState({ loading: false, sending: false, error: error.message || "Customer messages could not be loaded." });
    });
    return () => { active = false; };
  }, [companyId, locationId, workorderId, documentId, revisionId]);

  async function send(event) {
    event.preventDefault();
    const trimmedBody = body.trim();
    if (!trimmedBody || state.sending || !documentId || !revisionId) return;
    const requestedScope = scopeKey;
    setState((current) => ({ ...current, sending: true, error: "" }));
    try {
      const result = await sendWorkorderCustomerChat({
        companyId, locationId, workorderId, documentId, revisionId,
        body: trimmedBody,
        idempotencyKey: messageKey.current,
      });
      if (scopeKeyRef.current !== requestedScope) return;
      messageKey.current = customerDocumentCommandKey("staff-customer-chat");
      setBody("");
      setMessages((current) => result.message ? [...current.filter((message) => message.id !== result.message.id), result.message] : current);
      setState((current) => ({ ...current, sending: false }));
    } catch (error) {
      if (scopeKeyRef.current !== requestedScope) return;
      setState((current) => ({ ...current, sending: false, error: error.message || "The customer message was not sent." }));
    }
  }

  if (!documentId || !revisionId) return null;
  return <section className="workorder-customer-chat" aria-labelledby="workorder-customer-chat-title">
    <header>
      <div>
        <p className="workorder-customer-chat-audience">Customer audience</p>
        <h3 id="workorder-customer-chat-title">Customer messages</h3>
        <p>Visible to the customer through their secure document link. This is separate from internal Workorder chat and does not approve or change the document response.</p>
      </div>
      <Button variant="secondary" type="button" onClick={load} disabled={state.loading || state.sending}>Refresh messages</Button>
    </header>
    {state.loading ? <p role="status">Loading customer messages…</p> : null}
    {!state.loading && messages.length === 0 ? <p className="workorder-customer-chat-empty">No customer-audience messages yet.</p> : null}
    {messages.length ? <ol className="workorder-customer-chat-list" aria-label="Customer-audience message history">
      {messages.map((message) => {
        const time = messageTime(message.createdAt);
        return <li key={message.id} className={senderClass(message)}>
          <div><strong>{senderLabel(message)}</strong>{time ? <time dateTime={message.createdAt}>{time}</time> : null}</div>
          <p>{message.body}</p>
        </li>;
      })}
    </ol> : null}
    {state.error ? <p role="alert" className="workorder-customer-document-error">{state.error}</p> : null}
    <form className="workorder-customer-chat-form" onSubmit={send}>
      <label htmlFor="workorder-customer-chat-message">Message to customer</label>
      <textarea id="workorder-customer-chat-message" value={body} onChange={(event) => setBody(event.target.value)} rows="3" maxLength="5000" required disabled={state.sending} />
      <div><span>{body.length}/5000</span><Button variant="primary" type="submit" disabled={state.sending || !body.trim()}>{state.sending ? "Sending…" : "Send to customer"}</Button></div>
    </form>
  </section>;
}
