import { customerDocumentMoney, customerDocumentProjection } from "./customer-document-model.js";
import "./customer-document.css";

export function CustomerDocumentRenderer({ projection: source, compact = false }) {
  const projection = customerDocumentProjection(source);
  const label = projection.type === "invoice" ? "Invoice" : "Estimate";
  return <article className={`customer-document${compact ? " is-compact" : ""}`} aria-label={`${label} ${projection.number}`}>
    <header className="customer-document-header">
      <div><p className="customer-document-kicker">{label}</p><h1>{projection.number}{projection.revision ? ` · ${projection.revision}` : ""}</h1><p>{projection.status.replaceAll("_", " ")}</p></div>
      <address><strong>{projection.shop.name || "Shop"}</strong>{projection.shop.address ? <span>{projection.shop.address}</span> : null}{projection.shop.phone ? <span>{projection.shop.phone}</span> : null}</address>
    </header>
    <section className="customer-document-identities" aria-label="Repair details"><div><h2>Prepared for</h2><p>{projection.customer.name || "—"}</p></div><div><h2>Unit</h2><p>{projection.unit.name || "—"}</p>{projection.unit.detail ? <small>{projection.unit.detail}</small> : null}</div></section>
    {projection.concern ? <section className="customer-document-concern"><h2>Repair request</h2><p>{projection.concern}</p></section> : null}
    <section className="customer-document-lines"><h2>Proposed work</h2><div role="table" aria-label={`${label} line items`}><div className="customer-document-line customer-document-line-head" role="row"><span role="columnheader">Description</span><span role="columnheader">Qty</span><span role="columnheader">Unit price</span><span role="columnheader">Amount</span></div>{projection.lines.map((line) => <div className="customer-document-line" role="row" key={line.id}><span role="cell">{line.description}</span><span role="cell">{line.quantity} {line.unit}</span><span role="cell">{customerDocumentMoney(line.unitPrice, projection.currency)}</span><strong role="cell">{customerDocumentMoney(line.amount, projection.currency)}</strong></div>)}</div></section>
    <section className="customer-document-total" aria-label="Document total"><dl><div><dt>Subtotal</dt><dd>{customerDocumentMoney(projection.subtotal, projection.currency)}</dd></div>{Number(projection.discount) ? <div><dt>Discount</dt><dd>−{customerDocumentMoney(projection.discount, projection.currency)}</dd></div> : null}<div><dt>{projection.type === "estimate" ? "Estimated tax" : "Tax"}</dt><dd>{customerDocumentMoney(projection.tax, projection.currency)}</dd></div><div className="customer-document-grand-total"><dt>{projection.type === "estimate" ? "Estimated total" : "Amount due"}</dt><dd>{customerDocumentMoney(projection.total, projection.currency)}</dd></div></dl></section>
    {projection.terms ? <section className="customer-document-terms"><h2>Terms</h2><p>{projection.terms}</p></section> : null}
    {projection.authorizationText ? <section className="customer-document-terms"><h2>Authorization</h2><p>{projection.authorizationText}</p></section> : null}
  </article>;
}
