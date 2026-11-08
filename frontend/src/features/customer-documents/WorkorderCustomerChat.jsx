import { useCallback, useEffect, useRef, useState } from "react";
import { loadStaffRepairChat, sendStaffRepairChat } from "../customer-portal/customer-repair-api.js";
import { ChatComposer } from "../../components/workorders/ChatComposer.jsx";
import { ChatThread } from "../../components/workorders/ChatThread.jsx";
import { Button } from "../../components/ui/Button.jsx";
import {
  customerDocumentCommandKey,
  readWorkorderCustomerChat,
  sendWorkorderCustomerChat,
} from "./customer-estimate-api.js";

export function WorkorderCustomerChat({ companyId, locationId, workorderId, document, canSend = false, repairScope = false }) {
  const [messages, setMessages] = useState([]);
  const [state, setState] = useState({ loading: true, sending: false, error: "" });
  const messageKey = useRef(customerDocumentCommandKey("staff-customer-chat"));
  const documentId = repairScope ? "repair" : document?.documentId;
  const revisionId = repairScope ? "repair" : document?.id;
  const scopeKey = `${companyId || ""}:${locationId || ""}:${workorderId || ""}:${documentId || ""}:${revisionId || ""}`;
  const scopeKeyRef = useRef(scopeKey);
  scopeKeyRef.current = scopeKey;

  const load = useCallback(async () => {
    if (!documentId || !revisionId) return;
    const requestedScope = scopeKey;
    setState((current) => ({ ...current, loading: true, error: "" }));
    try {
      const result = await (repairScope ? loadStaffRepairChat({ companyId, locationId, workorderId }) : readWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId }));
      if (scopeKeyRef.current !== requestedScope) return;
      setMessages(result.messages || []);
      setState((current) => ({ ...current, loading: false }));
    } catch (error) {
      if (scopeKeyRef.current !== requestedScope) return;
      setState((current) => ({ ...current, loading: false, error: error.message || "Customer messages could not be loaded." }));
    }
  }, [companyId, locationId, workorderId, documentId, revisionId, scopeKey, repairScope]);

  useEffect(() => {
    let active = true;
    messageKey.current = customerDocumentCommandKey("staff-customer-chat");
    if (!documentId || !revisionId) {
      setMessages([]);
      setState({ loading: false, sending: false, error: "" });
      return () => { active = false; };
    }
    setMessages([]);
    setState({ loading: true, sending: false, error: "" });
    (repairScope ? loadStaffRepairChat({ companyId, locationId, workorderId }) : readWorkorderCustomerChat({ companyId, locationId, workorderId, documentId, revisionId })).then((result) => {
      if (active) {
        setMessages(result.messages || []);
        setState({ loading: false, sending: false, error: "" });
      }
    }).catch((error) => {
      if (active) setState({ loading: false, sending: false, error: error.message || "Customer messages could not be loaded." });
    });
    return () => { active = false; };
  }, [companyId, locationId, workorderId, documentId, revisionId, repairScope]);

  async function send({ body, clientMessageId }) {
    const trimmedBody = body.trim();
    if (!canSend || !trimmedBody || state.sending || state.loading || !documentId || !revisionId) return false;
    const requestedScope = scopeKey;
    setState((current) => ({ ...current, sending: true, error: "" }));
    try {
      const result = await (repairScope ? sendStaffRepairChat : sendWorkorderCustomerChat)({
        companyId, locationId, workorderId, ...(repairScope ? {} : { documentId, revisionId }),
        body: trimmedBody,
        idempotencyKey: clientMessageId || messageKey.current,
      });
      if (scopeKeyRef.current !== requestedScope) return false;
      messageKey.current = customerDocumentCommandKey("staff-customer-chat");
      setMessages((current) => result.message ? [...current.filter((message) => message.id !== result.message.id), result.message] : current);
      setState((current) => ({ ...current, sending: false }));
      return true;
    } catch (error) {
      if (scopeKeyRef.current !== requestedScope) return false;
      setState((current) => ({ ...current, sending: false, error: error.message || "The customer message was not sent." }));
      return false;
    }
  }

  if (!documentId || !revisionId || (repairScope && !document?.id)) return <section className="workorder-customer-chat" aria-label="Customer chat">
    <p className="workorder-customer-chat-audience">Visible to customer</p>
    <p className="workorder-customer-chat-empty">No issued customer document yet.</p>
  </section>;
  return <section className="workorder-customer-chat" aria-label="Customer chat">
    <header>
      <p className="workorder-customer-chat-audience">Visible to customer</p>
      <Button variant="secondary" type="button" onClick={load} disabled={state.loading || state.sending}>Refresh</Button>
    </header>
    {state.error ? <p role="alert" className="workorder-customer-document-error">{state.error}</p> : null}
    <div className="chat-content">
      <ChatThread
        messages={messages.map((message) => ({
          id: message.id,
          body: message.body,
          createdAt: message.createdAt,
          senderName: message.senderName || ((message.senderType || message.senderRole) === "customer" ? "Customer" : "Shop team"),
          senderRole: (message.senderType || message.senderRole) === "customer" ? "customer" : "staff",
        }))}
        currentRole="shop-viewer"
        empty={state.loading ? "Loading customer messages…" : "No customer messages yet."}
      />
      {canSend ? <ChatComposer
        key={scopeKey}
        onSend={send}
        disabled={state.loading}
        sending={state.sending}
        textareaLabel="Message to customer"
        placeholder="Write a message..."
        sendLabel="Send to customer"
        maxLength={5000}
        allowAttachments={false}
      /> : null}
    </div>
  </section>;
}
