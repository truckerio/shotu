import { useCallback, useEffect, useRef, useState } from "react";
import { FileCheck02, MessageChatCircle } from "@untitledui/icons";
import { CustomerDocumentRenderer } from "../customer-documents/CustomerDocumentRenderer.jsx";
import { customerDocumentMoney, customerDocumentProjection } from "../customer-documents/customer-document-model.js";
import { downloadCustomerDocument, printCustomerDocument } from "../customer-documents/customer-document-export.js";
import { ChatThread } from "../../components/workorders/ChatThread.jsx";
import { ChatComposer } from "../../components/workorders/ChatComposer.jsx";
import { loadRepairPortal, loadRepairChat, repairHeaders, repairRequestKey, respondRepairEstimate, sendRepairChat } from "./customer-repair-api.js";
import { repairDocumentFromLocation, repairScreenFromLocation, repairScreenUrl } from "./repair-navigation.js";
import "./customer-repair-portal.css";

export function repairEstimateCanRespond(data, selected) {
  return Boolean(selected && selected.revisionId === data?.documents?.estimate?.revisionId && selected.canRespond === true && (selected.response?.status || "pending") === "pending");
}
function RepairDiscussion({ grant, visible }) {
  const [messages, setMessages] = useState([]);
  const [name, setName] = useState("");
  const [state, setState] = useState({ loading: true, sending: false, error: "" });
  const active = useRef(true);
  useEffect(() => { active.current = true; return () => { active.current = false; }; }, []);
  useEffect(() => {
    if (!visible) return;
    let current = true;
    async function refresh() {
      if (document.hidden) return;
      try { const result = await loadRepairChat(grant); if (current) { setMessages(result.messages || []); setState((s) => ({ ...s, loading: false, error: "" })); } }
      catch (error) { if (current) setState((s) => ({ ...s, loading: false, error: error.message })); }
    }
    void refresh(); const timer = setInterval(refresh, 8000);
    window.addEventListener("focus", refresh); document.addEventListener("visibilitychange", refresh);
    return () => { current = false; clearInterval(timer); window.removeEventListener("focus", refresh); document.removeEventListener("visibilitychange", refresh); };
  }, [grant, visible]);
  async function send({ body, clientMessageId }) {
    if (!name.trim() || state.sending) { setState((s) => ({ ...s, error: "Enter your name before sending." })); return false; }
    setState((s) => ({ ...s, sending: true, error: "" }));
    try {
      const result = await sendRepairChat(grant, { body, customerName: name.trim(), idempotencyKey: clientMessageId });
      if (!active.current) return false;
      if (result.message) setMessages((m) => [...m.filter((item) => item.id !== result.message.id), result.message]);
      setState((s) => ({ ...s, sending: false })); return true;
    } catch (error) { if (active.current) setState((s) => ({ ...s, sending: false, error: error.message })); return false; }
  }
  return <section id="repair-chat" className="repair-discussion" aria-label="Chat with the shop" hidden={!visible}><h2 className="repair-sr-only">Chat with the shop</h2>
    <label className="repair-name">Your name<input autoComplete="name" value={name} maxLength={160} onChange={(e) => setName(e.target.value)} /></label>
    <ChatThread messages={messages.map((m) => ({ ...m, senderUserId: undefined, receipt: undefined }))} currentRole="customer" empty={state.loading ? "Loading messages…" : "No messages yet."} />
    {state.error ? <p role="alert">{state.error}</p> : null}
    <ChatComposer textareaLabel="Message to shop" sendLabel="Send message to shop" onSend={send} sending={state.sending} disabled={state.loading} allowAttachments={false} maxLength={5000} />
  </section>;
}
export function CustomerRepairPortalPage({ grant }) {
  const [state, setState] = useState({ data: null, loading: true, error: "", fresh: false });
  const [selection, setSelection] = useState(() => typeof window === "undefined" ? "estimate" : repairDocumentFromLocation(window.location));
  const [screen, setScreen] = useState(() => typeof window === "undefined" ? "repair" : repairScreenFromLocation(window.location));
  const heading = useRef(null);
  useEffect(() => {
    const restore = () => { setScreen(repairScreenFromLocation(window.location)); setSelection(repairDocumentFromLocation(window.location)); };
    window.addEventListener("popstate", restore);
    return () => window.removeEventListener("popstate", restore);
  }, []);
  useEffect(() => {
    heading.current?.focus({ preventScroll: true });
    window.scrollTo(0, 0);
  }, [screen]);
  function navigate(next, replace = false, documentType = selection) {
    if (next === screen) return;
    window.history[replace ? "replaceState" : "pushState"]({ ...window.history.state, customerRepairFrom: screen }, "", repairScreenUrl(window.location.href, next, documentType));
    setScreen(next);
  }
  function selectDocument(type) {
    setSelection(type);
    window.history.replaceState(window.history.state, "", repairScreenUrl(window.location.href, "document", type));
  }
  function backToRepair() {
    if (window.history.state?.customerRepairFrom === "repair") window.history.back();
    else navigate("repair", true);
  }
  const [confirmation, setConfirmation] = useState(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [exportBusy, setExportBusy] = useState(false);
  const active = useRef(true);
  const responseKey = useRef("");
  const requestSequence = useRef(0);
  const refresh = useCallback(async () => {
    const sequence = ++requestSequence.current;
    try {
      const data = await loadRepairPortal(grant);
      if (active.current && sequence === requestSequence.current) setState({ data, loading: false, error: "", fresh: true });
      return data;
    } catch (error) {
      if (active.current && sequence === requestSequence.current) setState((s) => ({ ...s, loading: false, error: error.message, fresh: false }));
      throw error;
    }
  }, [grant]);
  useEffect(() => {
    active.current = true; void refresh().catch(() => {});
    const poll = () => { if (!document.hidden) void refresh().catch(() => {}); };
    const timer = setInterval(poll, 8000); window.addEventListener("focus", poll); document.addEventListener("visibilitychange", poll);
    return () => { active.current = false; clearInterval(timer); window.removeEventListener("focus", poll); document.removeEventListener("visibilitychange", poll); };
  }, [refresh]);
  const data = state.data;
  const selected = data?.documents?.[selection] || data?.documents?.estimate || data?.documents?.invoice;
  const documentProjection = selected ? customerDocumentProjection(selected.document || selected.snapshot || selected.projection) : null;
  const canRespond = state.fresh && repairEstimateCanRespond(data, selected);
  async function confirm(event) {
    event.preventDefault(); if (submitting || !confirmation || !name.trim()) return;
    setSubmitting(true);
    try {
      const latest = await refresh();
      if (!repairEstimateCanRespond(latest, latest.documents?.estimate) || latest.documents.estimate.revisionId !== confirmation.revisionId) throw new Error("The estimate changed. Review the latest revision before responding.");
      responseKey.current ||= repairRequestKey();
      await respondRepairEstimate(grant, { revisionId: confirmation.revisionId, response: confirmation.response, customerName: name.trim(), note: note.trim(), idempotencyKey: responseKey.current });
      if (!active.current) return;
      setConfirmation(null); responseKey.current = ""; await refresh();
    } catch (error) { if (active.current) setState((s) => ({ ...s, error: error.message })); }
    finally { if (active.current) setSubmitting(false); }
  }
  async function download() {
    if (!selected || exportBusy) return; setExportBusy(true);
    try { await downloadCustomerDocument(null, { method: "GET", endpoint: `/api/customer-repair/export?revisionId=${encodeURIComponent(selected.revisionId)}`, headers: repairHeaders(grant), projection: documentProjection }); }
    catch (error) { if (active.current) setState((s) => ({ ...s, error: error.message })); }
    finally { if (active.current) setExportBusy(false); }
  }
  if (state.loading) return <main className="customer-repair-page"><p role="status">Loading your repair…</p></main>;
  if (!data) return <main className="customer-repair-page"><section className="repair-state"><h1>Customer link unavailable</h1><p role="alert">{state.error}</p><p>Ask the shop for a new link.</p></section></main>;
  const estimate = data.documents?.estimate;
  const invoice = data.documents?.invoice;
  const responseLabel = (document) => document.response?.status === "accepted" ? "Approved" : document.response?.status && document.response.status !== "pending" ? document.response.status.replaceAll("_", " ") : document.approvalRequired === false ? "No approval required" : document.canRespond ? "Awaiting your approval" : "Approval unavailable";
  return <main className={`customer-repair-page is-${screen}`}>
    <header className="repair-heading"><div><p>{screen === "chat" ? "Chat with the shop" : screen === "document" ? "Repair document" : "Your repair"}</p><h1 ref={heading} tabIndex={-1}>{data.workorder.unit?.label || data.workorder.unit?.name || "Your vehicle"}</h1></div><button type="button" onClick={() => void refresh().catch(() => {})}>Refresh</button></header>
    <nav className="repair-navigation" aria-label="Repair navigation"><button type="button" aria-current={screen !== "chat" ? "page" : undefined} onClick={() => navigate("repair")}><FileCheck02 aria-hidden="true" />Repair</button><button type="button" aria-current={screen === "chat" ? "page" : undefined} onClick={() => navigate("chat")}><MessageChatCircle aria-hidden="true" />Chat</button></nav>
    {state.error ? <p className="repair-error" role="alert">{state.error}</p> : null}
    {screen === "repair" ? <div className="repair-home">
      <section className="repair-progress" aria-label="Vehicle status"><strong>{data.workorder.statusLabel || String(data.workorder.status || "").replaceAll("_", " ")}</strong><span>{state.fresh ? "Up to date" : "Updates unavailable"}{data.workorder.updatedAt ? ` · ${new Date(data.workorder.updatedAt).toLocaleString()}` : ""}</span></section>
      <section className="repair-document-summaries" aria-label="Repair documents">
        {[ ["estimate", estimate], ["invoice", invoice] ].filter(([, document]) => document).map(([type, document]) => {
          const projection = customerDocumentProjection(document.document || document.snapshot || document.projection);
          return <article className="repair-document-summary" key={type}><div className="repair-summary-title"><h2>{type === "invoice" ? "Invoice" : "Estimate"}</h2><strong>{customerDocumentMoney(projection.total, projection.currency)}</strong></div><p>{projection.number}{projection.revision ? ` · ${projection.revision}` : ""}</p><p className="repair-summary-status">{type === "estimate" ? responseLabel(document) : "Issued"}</p><button type="button" onClick={() => { setSelection(type); navigate("document", false, type); }}>{type === "estimate" ? "View estimate" : "View invoice"}</button></article>;
        })}
        {!estimate && !invoice ? <p className="repair-empty">The shop has not issued an estimate yet.</p> : null}
      </section>
      {data.history?.length > 1 ? <details className="repair-history"><summary>Document history ({data.history.length})</summary>{data.history.map((item) => <p key={item.revisionId || item.id}>{item.documentNumber || item.number} · R{item.revisionNumber || item.revision} {item.response?.status || ""}</p>)}</details> : null}
    </div> : null}
    {screen === "document" ? <div className="repair-document-screen">
      <button type="button" className="repair-back" aria-label="Back to repair" onClick={backToRepair}>← Back to repair</button>
      <section className="repair-document-workspace" aria-label="Document preview"><div className="repair-document-toolbar"><div role="group" aria-label="Document type">{estimate ? <button type="button" aria-pressed={documentProjection?.type === "estimate"} onClick={() => selectDocument("estimate")}>Estimate</button> : null}{invoice ? <button type="button" aria-pressed={documentProjection?.type === "invoice"} onClick={() => selectDocument("invoice")}>Invoice</button> : null}</div>{selected ? <><button type="button" onClick={() => { try { printCustomerDocument(documentProjection); } catch (error) { setState((s) => ({ ...s, error: error.message })); } }}>Print</button><button type="button" disabled={exportBusy} onClick={download}>{exportBusy ? "Preparing…" : "Download PDF"}</button></> : null}</div>
        {documentProjection ? <CustomerDocumentRenderer projection={documentProjection} /> : <p className="repair-empty">The shop has not issued a document yet.</p>}
      </section>
    {selected && documentProjection?.type === "estimate" ? <section className={`repair-response${!confirmation && !canRespond ? " is-summary" : ""}`} aria-label="Estimate response">
      {confirmation ? <form onSubmit={confirm}><h2>{confirmation.response === "accepted" ? "Approve estimate" : confirmation.response === "declined" ? "Decline estimate" : "Request changes"}</h2><p>{documentProjection.number} · {documentProjection.revision} · {documentProjection.currency} {documentProjection.total}</p><label>Your name<input required autoComplete="name" value={name} maxLength={160} onChange={(e) => { setName(e.target.value); responseKey.current = ""; }} disabled={submitting} /></label><label>Note<textarea value={note} maxLength={2000} rows={2} onChange={(e) => { setNote(e.target.value); responseKey.current = ""; }} disabled={submitting} /></label><div className="repair-response-actions"><button type="button" disabled={submitting} onClick={() => setConfirmation(null)}>Back</button><button className="primary" disabled={submitting || !state.fresh}>{submitting ? "Saving…" : "Confirm response"}</button></div></form> : <><p role="status">{canRespond ? "Awaiting your approval" : selected.response?.status === "accepted" ? "Estimate approved" : selected.response?.status && selected.response.status !== "pending" ? selected.response.status.replaceAll("_", " ") : selected.approvalRequired === false ? "No approval required" : "Approval unavailable"}</p>{canRespond ? <div className="repair-response-actions">{[["changes_requested", "Request changes"], ["declined", "Decline"], ["accepted", "Approve estimate"]].map(([response, label]) => <button key={response} type="button" className={response === "accepted" ? "primary" : ""} onClick={() => { setConfirmation({ response, revisionId: selected.revisionId }); responseKey.current = ""; }}>{label}</button>)}</div> : null}</>}
    </section> : null}
    </div> : null}
    <RepairDiscussion grant={grant} visible={screen === "chat"} />

  </main>;
}
