import { useEffect, useId, useRef, useState } from "react";
import { Dropdown } from "../../components/forms/Dropdown.jsx";
import { Button } from "../../components/ui/Button.jsx";
import { StoragePositionPicker } from "../inventory/StoragePositionPicker.jsx";
import { initialReceiptLines, initialReceiptLinesFromFacts, normalizeReceiptLineTarget, receiptLineLimit, receiptLinesReady, receiveAllReceiptLines, updateReceiptLine } from "./receipt-lines-model.js";
import "./receipt-lines.css";

const emptyPositions = [];

export function ReceiptLinesEditor({ runId = "", runVersion = 0, receiptEpisode = 0, draft, suggestion, facts = null, initialLines = null, mode = "receipt", compactDirectArrival = false, sourceLabel = "Invoice", positions = emptyPositions, positionLoading = false, positionError = "", targetLocked = false, fixedTargetPositionId = "", fixedTargetLabel = "", disabled = false, onChange }) {
  const prefix = useId();
  const receiptRunKeyRef = useRef("");
  const hasEnteredReceiptRef = useRef(false);
  const directArrival = mode === "direct-arrival";
  const initial = () => facts ? initialReceiptLinesFromFacts(facts, initialLines) : initialReceiptLines(draft, suggestion);
  const enforceTarget = (line) => targetLocked ? { ...line, targetPositionId: line.outcome === "held" ? "" : fixedTargetPositionId } : line;
  const [lines, setLines] = useState(() => initial().map(enforceTarget));
  const [expandedLineIndex, setExpandedLineIndex] = useState(null);
  const [exceptionModes, setExceptionModes] = useState({});
  useEffect(() => {
    const receiptRunKey = `${runId}:${runVersion}:${receiptEpisode}`;
    if (receiptRunKeyRef.current !== receiptRunKey) {
      receiptRunKeyRef.current = receiptRunKey;
      hasEnteredReceiptRef.current = false;
      setLines(initial().map(enforceTarget));
      setExpandedLineIndex(null);
      setExceptionModes({});
      return;
    }
    if (!hasEnteredReceiptRef.current) setLines(initial().map(enforceTarget));
  }, [runId, runVersion, receiptEpisode, draft, suggestion, facts, targetLocked, fixedTargetPositionId]);
  useEffect(() => {
    setLines((current) => {
      const next = current.map((line) => enforceTarget(normalizeReceiptLineTarget(line, positions)));
      return next.some((line, index) => line !== current[index]) ? next : current;
    });
  }, [positions, targetLocked, fixedTargetPositionId]);
  useEffect(() => onChange?.(lines, receiptLinesReady(lines)), [lines]);
  function update(index, field, value) {
    hasEnteredReceiptRef.current = true;
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? enforceTarget(updateReceiptLine(line, field, value, positions)) : line));
  }
  function receiveAll() {
    hasEnteredReceiptRef.current = true;
    setLines((current) => receiveAllReceiptLines(current));
    setExceptionModes({});
  }
  function openException(index) {
    setExpandedLineIndex(index);
    setExceptionModes((current) => ({ ...current, [index]: true }));
  }
  function clearException(index) {
    hasEnteredReceiptRef.current = true;
    setLines((current) => current.map((line, lineIndex) => lineIndex === index ? {
      ...line,
      heldQuantity: "",
      rejectedQuantity: "",
      notReceivedQuantity: "",
      outcome: "available",
      notes: "",
      holdLocation: "",
      targetPositionId: "",
    } : line));
    setExceptionModes((current) => ({ ...current, [index]: false }));
  }
  function updateDirectDisposition(index, value) {
    hasEnteredReceiptRef.current = true;
    setLines((current) => current.map((line, lineIndex) => {
      if (lineIndex !== index) return line;
      const quantity = String(Number(line.acceptedQuantity || 0) + Number(line.heldQuantity || 0) || "");
      return value === "held"
        ? { ...line, acceptedQuantity: "", heldQuantity: quantity, rejectedQuantity: "", notReceivedQuantity: "", outcome: "held", targetPositionId: "" }
        : { ...line, acceptedQuantity: quantity, heldQuantity: "", rejectedQuantity: "", notReceivedQuantity: "", outcome: "available", holdLocation: "", notes: "", ...(targetLocked ? { targetPositionId: fixedTargetPositionId } : {}) };
    }));
  }
  return <section className={`receipt-lines-editor${compactDirectArrival && directArrival ? " is-compact-direct-arrival" : ""}`} aria-label={compactDirectArrival && directArrival ? "Quantity and condition" : undefined} aria-labelledby={compactDirectArrival && directArrival ? undefined : `${prefix}-title`}>
    {compactDirectArrival && directArrival ? null : <div className="receipt-lines-heading"><div><h4 id={`${prefix}-title`}>{directArrival ? "Arrival details" : "Received now"}</h4><p>{directArrival ? "Record what physically arrived and where available goods were put away." : "Enter only what physically arrived. Leave a line at zero when it has not arrived."}</p></div>{!directArrival ? <Button type="button" onClick={receiveAll} disabled={disabled || !lines.length}>Receive all</Button> : null}</div>}
    {lines.some((line) => line.inventoryDisposition !== "financial_offset" && !line.trackingMode) ? <p className="receipt-tracking-alert" role="alert">Tracking information is still loading. You cannot post this receipt yet.</p> : null}
    {lines.map((line, index) => {
      if (line.inventoryDisposition === "financial_offset") return <div key={line.invoiceLineIndex} className="receipt-line-card receipt-line-financial">
        <div className="receipt-line-heading"><strong>{line.partNumber}</strong>{line.description ? <span>{line.description}</span> : null}</div>
        <div className="receipt-line-summary-facts"><span>{sourceLabel} {line.invoiceQuantity} {line.uomCode}</span><strong>Financial offset · no stock</strong></div>
        <p>This charge or credit offsets invoice line {Number(line.offsetLineIndex) + 1}. It stays on the invoice and is excluded from inventory.</p>
      </div>;
      const received = Number(line.acceptedQuantity || 0) + Number(line.heldQuantity || 0) + Number(line.rejectedQuantity || 0) + Number(line.notReceivedQuantity || 0);
      const limit = receiptLineLimit(line);
      const lineDirectArrival = directArrival || line.receiptMode === "direct-arrival";
      const held = Number(line.heldQuantity || 0) > 0;
      const populatedException = held || Number(line.rejectedQuantity || 0) > 0 || Number(line.notReceivedQuantity || 0) > 0 || line.outcome !== "available" || Boolean(line.notes || line.holdLocation);
      const exceptionOpen = Boolean(exceptionModes[index]) || populatedException;
      const compactArrival = compactDirectArrival && lineDirectArrival;
      const expanded = compactArrival || expandedLineIndex === index;
      const panelId = `${prefix}-line-${line.invoiceLineIndex}-panel`;
      const status = populatedException ? "Exception entered" : Number(line.acceptedQuantity || 0) > 0 ? `${line.acceptedQuantity} ready` : "Not entered";
      return <fieldset key={line.invoiceLineIndex} className={`receipt-line-card${expanded ? " is-expanded" : ""}${compactArrival ? " is-compact-direct-arrival" : ""}`}>
        <legend>{compactArrival ? "Quantity and condition" : `Line ${index + 1}`}</legend>
        {compactArrival ? null : <div className="receipt-line-summary"><div className="receipt-line-heading"><strong>{line.partNumber}</strong>{line.description ? <span>{line.description}</span> : null}</div><div className="receipt-line-summary-facts">{lineDirectArrival ? <span>{line.uomCode}</span> : <><span>{sourceLabel} {line.invoiceQuantity} {line.uomCode}</span><span>Limit {limit} {line.uomCode}</span></>}<strong>{status}</strong></div><Button type="button" aria-controls={panelId} aria-expanded={expanded} onClick={() => setExpandedLineIndex(expanded ? null : index)} disabled={disabled}>{expanded ? "Done" : "Edit line"}</Button></div>}
        {expanded ? <div id={panelId} className="receipt-line-details">
          {lineDirectArrival ? <><div className="receipt-line-fields"><label><span>Received condition</span><Dropdown aria-label={`Received condition for line ${index + 1}`} value={line.outcome === "held" ? "held" : "available"} onChange={(event) => updateDirectDisposition(index, event.target.value)} disabled={disabled}><option value="available">Available for use</option><option value="held">Held for inspection</option></Dropdown></label><label><span>Received quantity</span><input aria-label={`Received quantity for line ${index + 1}`} type="number" min="0" step="any" inputMode="decimal" value={line.outcome === "held" ? line.heldQuantity : line.acceptedQuantity} onChange={(event) => update(index, line.outcome === "held" ? "heldQuantity" : "acceptedQuantity", event.target.value)} disabled={disabled} /></label></div></> : <div className="receipt-line-fields"><label><span>Available now</span><input aria-label={`Available now for line ${index + 1}`} type="number" min="0" max={line.outcome === "over" ? undefined : limit} step="any" inputMode="decimal" value={line.acceptedQuantity} onChange={(event) => update(index, "acceptedQuantity", event.target.value)} disabled={disabled} /></label></div>}
          {Number(line.acceptedQuantity || 0) > 0 ? <div className="receipt-line-put-away">{targetLocked ? compactArrival ? null : <div className="add-inventory-fixed-destination"><span>Stock location</span><strong>{fixedTargetLabel}</strong></div> : <StoragePositionPicker positions={positions} value={line.targetPositionId || ""} onChange={(value) => update(index, "targetPositionId", value)} disabled={disabled || positionLoading} />}{positionLoading ? <p role="status">Loading storage destinations…</p> : null}{positionError ? <p role="alert">{positionError}</p> : null}</div> : null}
          {line.trackingMode === "serialized" ? <label className="receipt-serials"><span>Serialized identities</span><textarea aria-label={`Serialized identities for line ${index + 1}`} rows={3} value={line.serialNumbers} onChange={(event) => update(index, "serialNumbers", event.target.value)} disabled={disabled} /><small>Enter one identity for each available or held unit.</small></label> : null}
          {lineDirectArrival && line.outcome === "held" ? <div className="receipt-line-exception"><label><span>Physical hold location *</span><input aria-label={`Hold location for line ${index + 1}`} required maxLength={240} value={line.holdLocation} onChange={(event) => update(index, "holdLocation", event.target.value)} disabled={disabled} /></label><label><span>Findings *</span><textarea aria-label={`Findings for line ${index + 1}`} required maxLength={500} rows={2} value={line.notes} onChange={(event) => update(index, "notes", event.target.value)} disabled={disabled} /></label></div> : null}
          {!lineDirectArrival && (!exceptionOpen ? <Button type="button" className="receipt-exception-trigger" onClick={() => openException(index)} disabled={disabled}>Report an exception</Button> : <>
            <div className="receipt-line-fields receipt-exception-fields">
              <label><span>Held now</span><input aria-label={`Held now for line ${index + 1}`} type="number" min="0" max={line.outcome === "over" ? undefined : limit} step="any" inputMode="decimal" value={line.heldQuantity} onChange={(event) => update(index, "heldQuantity", event.target.value)} disabled={disabled} /></label>
              <label><span>Rejected now</span><input aria-label={`Rejected now for line ${index + 1}`} type="number" min="0" max={line.outcome === "over" ? undefined : limit} step="any" inputMode="decimal" value={line.rejectedQuantity} onChange={(event) => update(index, "rejectedQuantity", event.target.value)} disabled={disabled} /></label>
              <label><span>Not delivered</span><input aria-label={`Not delivered for line ${index + 1}`} type="number" min="0" max={limit} step="any" inputMode="decimal" value={line.notReceivedQuantity} onChange={(event) => update(index, "notReceivedQuantity", event.target.value)} disabled={disabled} /></label>
              <label><span>Exception</span><Dropdown aria-label={`Exception for line ${index + 1}`} value={line.outcome} onChange={(event) => update(index, "outcome", event.target.value)} disabled={disabled}><option value="available">None</option><option value="damaged">Damaged</option><option value="wrong">Wrong item</option><option value="short">Short delivery</option><option value="over">Over delivery</option></Dropdown></label>
            </div>
            <div className="receipt-line-exception"><label><span>Hold location{held ? " *" : ""}</span><input aria-label={`Hold location for line ${index + 1}`} required={held} maxLength={240} value={line.holdLocation} onChange={(event) => update(index, "holdLocation", event.target.value)} disabled={disabled} /></label><label><span>Findings{held ? " *" : ""}</span><textarea aria-label={`Findings for line ${index + 1}`} required={held} maxLength={500} rows={2} value={line.notes} onChange={(event) => update(index, "notes", event.target.value)} disabled={disabled} /></label></div>
            <Button type="button" className="receipt-clear-exception" onClick={() => clearException(index)} disabled={disabled}>Clear exception</Button>
          </>)}
          {received > limit && line.outcome !== "over" ? <p role="alert">Choose Over delivery or correct the quantities.</p> : null}
          {line.trackingMode === "serialized" && String(line.serialNumbers || "").split(/\r?\n/).filter((value) => value.trim()).length !== Number(line.acceptedQuantity || 0) + Number(line.heldQuantity || 0) ? <p role="alert">Enter one unique identity for each available or held serialized unit.</p> : null}
        </div> : null}
      </fieldset>;
    })}
  </section>;
}
