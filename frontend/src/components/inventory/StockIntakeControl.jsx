import { useEffect, useId, useRef, useState } from "react";
import { Dialog, Modal, ModalOverlay } from "react-aria-components";
import { api } from "../../lib/api.js";
import { Button } from "../ui/Button.jsx";
import { Checkbox } from "../ui/Checkbox.jsx";
import { clearStockIntakeRequestKey, stockIntakeQuantity, stockIntakeRequestKey } from "./stock-intake-model.js";
import "./stock-intake.css";

// One aggregate receiving control for Inventory, Create and saved Workorders.
// Receiving is explicit and never reserves/installs the received stock.
export function StockIntakeControl({ catalogPartId, locationId, initialData, onReceived }) {
  const [data, setData] = useState(initialData || null);
  const [open, setOpen] = useState(false);
  const [quantity, setQuantity] = useState("1");
  const [confirmed, setConfirmed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [message, setMessage] = useState("");
  const busyRef = useRef(false);
  const titleId = useId();
  const endpoint = catalogPartId && locationId
    ? `/api/office/inventory/parts/${encodeURIComponent(catalogPartId)}/locations/${encodeURIComponent(locationId)}` : "";

  useEffect(() => {
    setData(initialData || null);
  }, [endpoint, initialData]);

  useEffect(() => {
    if (!endpoint) return undefined;
    let active = true;
    api(`${endpoint}/units`).then((result) => { if (active) setData(result); })
      .catch(() => { if (active) setData(null); });
    return () => { active = false; };
  }, [endpoint, open]);

  function close() { if (!busyRef.current) setOpen(false); }
  const amount = stockIntakeQuantity(quantity, data?.part);
  async function receive() {
    if (busyRef.current || completed || !amount.valid || !confirmed || !data?.canReceiveStock) return;
    const payload = { quantity: amount.quantity, uomCode: amount.uomCode, trackingMode: data.part.trackingMode,
      confirmation: "physically_present_at_location" };
    const identity = `${endpoint}:${JSON.stringify(payload)}`;
    busyRef.current = true;
    setBusy(true); setMessage("");
    try {
      const result = await api(`${endpoint}/stock-intake`, { method: "POST", body: JSON.stringify({
        ...payload, idempotencyKey: stockIntakeRequestKey(identity),
      }) });
      clearStockIntakeRequestKey(identity);
      setCompleted(true);
      setMessage(`Added ${amount.quantity} ${amount.uomCode} to ${data.location.locationName}.`);
      try { await onReceived?.(result); }
      catch { setMessage("Stock was added. Refresh to see the updated balance."); }
    } catch (error) { setMessage(error.message || "Stock could not be added. Try again."); }
    finally { busyRef.current = false; setBusy(false); }
  }

  if (!data?.canReceiveStock && !open) return null;
  return <>
    <Button type="button" onClick={() => { setQuantity("1"); setConfirmed(false); setCompleted(false); setMessage(""); setOpen(true); }}>Add stock</Button>
    {open ? <ModalOverlay className="stock-intake-overlay" isOpen isDismissable={!busy} onOpenChange={(next) => { if (!next) close(); }}>
      <Modal className="stock-intake-modal"><Dialog className="stock-intake-dialog" aria-labelledby={titleId} onKeyDown={(event) => {
        if (event.key === "Escape") { event.preventDefault(); event.stopPropagation(); close(); }
      }}>
        <header><div><h2 id={titleId}>Add stock · {data?.part.partNumber}</h2><p>{data?.location.locationName}</p></div></header>
        <div className="stock-intake-fields" onKeyDown={(event) => {
          if (event.key === "Enter" && event.target.tagName === "INPUT" && event.target.type === "number") { event.preventDefault(); event.stopPropagation(); receive(); }
        }}>
          <p>{data?.part.trackingMode === "quantity" ? "Quantity tracked — enter the number received." : "Measured or bulk — enter the amount received."}</p>
          <label>Quantity ({amount.uomCode})<input autoFocus type="number" min={amount.step} step={amount.step} max={amount.max} value={quantity} onChange={(event) => setQuantity(event.target.value)} disabled={busy || completed} /></label>
          <label className="stock-intake-confirm"><Checkbox checked={confirmed} onChange={(event) => setConfirmed(event.target.checked)} disabled={busy || completed} /><span>I confirm this stock is physically present at {data?.location.locationName}.</span></label>
          {!data?.canReceiveStock ? <p role="alert">Stock cannot be added here. Refresh and check the part’s tracking settings.</p> : null}
          {message ? <p role={completed ? "status" : "alert"}>{message}</p> : null}
          <footer><Button type="button" onClick={close} disabled={busy}>{completed ? "Done" : "Cancel"}</Button>{!completed ? <Button type="button" variant="primary" onClick={receive} disabled={busy || !confirmed || !amount.valid || !data?.canReceiveStock}>{busy ? "Adding stock…" : "Add stock"}</Button> : null}</footer>
        </div>
      </Dialog></Modal>
    </ModalOverlay> : null}
  </>;
}
