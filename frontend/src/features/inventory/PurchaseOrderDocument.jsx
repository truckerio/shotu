import { useState } from "react";
import { Button } from "../../components/ui/Button.jsx";
import { PurchaseOrderLineEditor } from "./PurchaseOrderLineEditor.jsx";
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from "../../components/ui/OperationalDataTable.jsx";
import "./purchase-order-document.css";

const quantity = (value) => Number(value || 0).toLocaleString(undefined, { maximumFractionDigits: 3 });
const money = (value) => value === null || value === undefined || value === "" || !Number.isFinite(Number(value))
  ? "Price unknown"
  : Number(value).toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 4 });
const date = (value) => {
  if (!value) return "Not set";
  const parsed = new Date(value.length === 10 ? `${value}T12:00:00` : value);
  return Number.isNaN(parsed.getTime()) ? "Not set" : parsed.toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
};

const lineColumns = [{ id: "part", label: "Part", isRowHeader: true }, { id: "quantity", label: "Qty" }, { id: "price", label: "Unit price" }, { id: "amount", label: "Amount" }];

export function PurchaseOrderDocument({ order, shopName, statusLabel, onSaveLines, busy = false, pending = false }) {
  const [editing, setEditing] = useState(false);
  const unpriced = order.lines.some((line) => line.unit_price === null || line.unit_price === undefined || line.unit_price === "");
  return <article className="purchase-order-document" aria-label={`Purchase order ${order.number}`}>
    <header className="purchase-order-document-header">
      <div><p className="purchase-order-document-kicker">Purchase order</p><h3>{order.number}</h3></div>
      <div className="purchase-order-document-controls"><span className={`purchase-status is-${order.status}`}>{statusLabel}</span>{onSaveLines && ["draft","awaiting_approval","ordered"].includes(order.status) ? <Button type="button" disabled={busy || pending || !order.can_edit_lines} title={order.line_edit_reason || "Edit parts, quantities and unit prices"} onClick={() => setEditing(true)}>Edit parts</Button> : null}</div>
    </header>
    <dl className="purchase-order-document-facts">
      <div><dt>Supplier</dt><dd>{order.supplier_name || "Supplier not set"}</dd></div>
      <div><dt>Deliver to</dt><dd>{shopName || "Shop not set"}</dd></div>
      <div><dt>Order date</dt><dd>{date(order.created_at)}</dd></div>
      <div><dt>Expected delivery</dt><dd>{date(order.expected_delivery_date)}</dd></div>
    </dl>
    <OperationalDataTable className="purchase-order-document-lines" ariaLabel="Purchase order line items" columns={lineColumns}>
      {order.lines.map((line) => {
        const remaining = Number(line.quantity) - Number(line.received_quantity || 0) - Number(line.cancelled_quantity || 0);
        const hasPrice = line.unit_price !== null && line.unit_price !== undefined && line.unit_price !== "";
        return <OperationalDataRow id={line.id} key={line.id}>
          <OperationalDataCell label="Part"><strong>{line.part_number}</strong>{line.description && line.description.trim().toLowerCase() !== line.part_number?.trim().toLowerCase() ? <span>{line.description}</span> : null}<small>Received {quantity(line.received_quantity)} {line.uom_code} · Open {quantity(remaining)} {line.uom_code}{Number(line.cancelled_quantity) > 0 ? ` · Cancelled ${quantity(line.cancelled_quantity)} ${line.uom_code}` : ""}</small></OperationalDataCell>
          <OperationalDataCell label="Qty">{quantity(line.quantity)}<small>{line.uom_code}</small></OperationalDataCell>
          <OperationalDataCell label="Unit price">{money(line.unit_price)}</OperationalDataCell>
          <OperationalDataCell label="Amount">{money(hasPrice ? Number(line.quantity) * Number(line.unit_price) : null)}</OperationalDataCell>
        </OperationalDataRow>;
      })}
    </OperationalDataTable>
    <footer className="purchase-order-document-total">
      <span>Merchandise total<small>{order.currency}</small></span><strong>{money(order.total)}</strong>
    </footer>
    {unpriced ? <p className="purchase-order-document-note">Total is pending until all unit prices are entered.</p> : null}
    {order.notes ? <section className="purchase-order-document-notes"><h4>Notes</h4><p>{order.notes}</p></section> : null}
    {editing ? <PurchaseOrderLineEditor order={order} disabled={busy} pending={pending} onSave={onSaveLines} onCancel={() => setEditing(false)}/> : null}
  </article>;
}
