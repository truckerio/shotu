import { useEffect, useRef, useState } from 'react';
import { Heading } from 'react-aria-components';
import { XClose } from '@untitledui/icons';
import { Button } from '../../components/ui/Button.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { ModalFrame } from '../../components/ui/ModalFrame.jsx';
import { Dropdown } from '../../components/forms/Dropdown.jsx';
import { UnitOfMeasurePicker } from '../../components/forms/UnitOfMeasurePicker.jsx';
import { WorkorderPartsColumnHead, WorkorderPartsRow, WorkorderPartsTable } from '../../components/workorders/WorkorderPartsTable.jsx';
import { PartCatalogCombobox } from '../../components/workorders/part-requests/PartCatalogCombobox.jsx';
import { newPurchaseLine, purchaseLineEditDraft, purchaseLineEditIssues, purchaseLineEditPayload, purchaseLineEditTotal, selectPurchaseLinePart } from './purchase-order-line-edit-model.js';
import './purchase-order-edit-dialog.css';

const columns = ['product','quantity-uom','price','amount'];
const labels = { product:'Part', 'quantity-uom':'Quantity', price:'Unit cost', amount:'Amount' };
const money = value => value === null ? 'Price unknown' : Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4});

export function PurchaseOrderLineEditor({ order, disabled, pending = false, onSave, onCancel }) {
  const [draft,setDraft] = useState(() => purchaseLineEditDraft(order));
  const [issues,setIssues] = useState([]), [saving,setSaving] = useState(false);
  const formRef = useRef(null), focusNewRef = useRef(null);
  useEffect(() => {
    if (!focusNewRef.current) return;
    const row = [...(formRef.current?.querySelectorAll('[data-purchase-line-key]') || [])].find(node=>node.dataset.purchaseLineKey===focusNewRef.current);
    if (row) { row.querySelector('input[role="combobox"]')?.focus();focusNewRef.current=null; }
  }, [draft.lines]);
  const stale = Number(order.version) !== Number(draft.version);
  const locked = disabled || saving, fieldsLocked = locked || pending;
  function update(id, change) { setIssues([]);setDraft(current=>({...current,lines:current.lines.map(line=>line.id===id?{...line,...change}:line)})); }
  async function save(event) {
    event.preventDefault();
    if (locked || (stale && !pending)) return;
    if (!pending) {
      const errors = purchaseLineEditIssues(draft);
      if (errors.length) { setIssues(errors);return; }
    }
    setSaving(true);
    try { if (await onSave(purchaseLineEditPayload(draft),draft.version)) onCancel(); }
    catch (error) { setIssues([error.message || 'The changes could not be saved.']); }
    finally { setSaving(false); }
  }
  return <ModalFrame ariaLabel={`Edit purchase order ${order.number}`} overlayClassName="purchase-line-edit-overlay" modalClassName="purchase-line-edit-modal" dialogClassName="purchase-line-edit-dialog" isDismissable={!locked} onOpenChange={open=>{if(!open&&!locked)onCancel();}}>
    <header className="purchase-line-edit-header"><div><Heading slot="title">Edit purchase order</Heading><p>{order.number} · {order.supplier_name}</p></div><IconButton icon={XClose} label="Close purchase order editor" disabled={locked} onClick={onCancel}/></header>
    <form ref={formRef} className="purchase-order-line-editor" aria-label="Edit purchase order parts" onSubmit={save}>
      <div className="purchase-line-edit-body">
        {stale && !pending ? <p role="alert">This PO changed while you were editing. Cancel to load its current values before editing again.</p> : null}
        {issues.length ? <div role="alert">{issues.map(issue=><p key={issue}>{issue}</p>)}</div> : null}
        {pending ? <p role="status">These changes are awaiting confirmation. Retry saved changes to check their result.</p> : null}
        <WorkorderPartsTable className="purchase-line-parts-grid" columns={columns} gridTemplate="24px minmax(0,2fr) minmax(100px,.65fr) minmax(120px,.8fr) minmax(90px,.6fr) 36px" aria-label="Purchase order parts">
          <WorkorderPartsColumnHead columns={columns} labels={labels}/>
          {draft.lines.map((line,index) => <WorkorderPartsRow key={line.id} data-purchase-line-key={line.id} aria-label={`Purchase line ${index+1}`}>
            <strong className="purchase-line-ordinal">{index+1}</strong>
            <div className="purchase-line-product">
              {line.demandLinked ? <><strong>{line.partNumber}</strong><span>{line.description}</span><small>Linked demand · part and quantity fixed</small></> : <>
                <PartCatalogCombobox locationId={order.location_id} purpose="master_match" catalogEndpoint="/api/office/inventory/catalog" label="Part" inputAriaLabel={`Part for line ${index+1}`} value={line.query} disabled={fieldsLocked} onChange={query=>update(line.id,line.originalCatalogPartId||line.catalogPartId?{query}:{query,partNumber:query})} onSelect={part=>update(line.id,selectPurchaseLinePart(line,part))}/>
                <input aria-label={`Description for line ${index+1}`} placeholder="Description" maxLength={1000} value={line.description} disabled={fieldsLocked} onChange={event=>update(line.id,{description:event.target.value})}/>
                {line.isNew && !line.catalogPartId && line.partNumber.trim() ? <details className="purchase-line-setup"><summary>Part setup · {line.uomCode}</summary><div><UnitOfMeasurePicker uomCode={line.uomCode} onChange={value=>update(line.id,{uomCode:value})} disabled={fieldsLocked}/><Dropdown aria-label={`Tracking for line ${index+1}`} value={line.trackingMode} disabled={fieldsLocked} onChange={event=>update(line.id,{trackingMode:event.target.value})}><option value="quantity">Quantity</option><option value="serialized">Serialized</option><option value="measured_bulk">Measured / bulk</option></Dropdown></div></details> : null}
              </>}
            </div>
            <label className="purchase-line-quantity"><span>Quantity</span><input aria-label={`Quantity for line ${index+1}`} type="number" step="any" min="0.001" max="999999.999" value={line.quantity} disabled={fieldsLocked||line.demandLinked} onChange={event=>update(line.id,{quantity:event.target.value})}/><small>{line.uomCode}</small></label>
            <label className="purchase-line-cost"><span>Unit cost</span><input aria-label={`Unit price for line ${index+1}`} inputMode="decimal" placeholder="Unknown" value={line.unitPrice} disabled={fieldsLocked} onChange={event=>update(line.id,{unitPrice:event.target.value})}/></label>
            <div className="purchase-line-amount"><span>Amount</span><strong>{money(purchaseLineEditTotal([line]))}</strong></div>
            {line.isNew ? <IconButton icon={XClose} label={`Remove new line ${index+1}`} disabled={fieldsLocked} onClick={()=>{setIssues([]);setDraft(current=>({...current,lines:current.lines.filter(row=>row.id!==line.id)}));}}/> : <span aria-hidden="true"/>}
          </WorkorderPartsRow>)}
        </WorkorderPartsTable>
        <Button type="button" disabled={fieldsLocked||draft.lines.length>=100} onClick={()=>{const id=`new-${crypto.randomUUID()}`;focusNewRef.current=id;setIssues([]);setDraft(current=>({...current,lines:[...current.lines,newPurchaseLine(id)]}));}}>Add line</Button>
        <p className="purchase-order-document-note">Leave unit cost blank if unknown. Ordered PO changes follow the existing approval rules.</p>
      </div>
      <footer className="purchase-line-edit-footer"><div><span>Merchandise total · {order.currency}</span><strong>{money(purchaseLineEditTotal(draft.lines))}</strong></div><div><Button type="button" disabled={locked} onClick={onCancel}>Cancel</Button><Button type="submit" variant="primary" disabled={locked||(stale&&!pending)}>{saving?'Saving…':pending?'Retry saved changes':'Save changes'}</Button></div></footer>
    </form>
  </ModalFrame>;
}
