import { CurrencySelector } from "../../components/forms/CurrencySelector.jsx";
import { DatePicker } from "../../components/forms/DatePicker.jsx";
import './inventory-tables.css';
import { Heading } from 'react-aria-components';
import { validatePurchaseOrder } from './purchase-order-validation.js';
import { PurchaseOrderFeedbackDialog } from './PurchaseOrderFeedbackDialog.jsx';
import { RefreshCw01, FilterLines, XClose } from '@untitledui/icons';
import { InventoryNeedsOrdering } from './InventoryNeedsOrdering.jsx';
import { sendInventoryCommand,inventoryCommandCanBeEdited } from './inventory-command.js';
import { PurchaseOrderBills } from './PurchaseOrderBills.jsx';
import { useEffect,useState,useRef,useMemo } from 'react';
import { api } from '../../lib/api.js';
import { Button } from '../../components/ui/Button.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { ModalFrame } from '../../components/ui/ModalFrame.jsx';
import { OperationalDataCell,OperationalDataRow,OperationalDataTable } from '../../components/ui/OperationalDataTable.jsx';
import { Dropdown } from '../../components/forms/Dropdown.jsx';
import { PartCatalogCombobox } from '../../components/workorders/part-requests/PartCatalogCombobox.jsx';
import { UnitOfMeasurePicker } from '../../components/forms/UnitOfMeasurePicker.jsx';
import { SecondaryDetailPanel,SecondaryDetailSection } from '../../components/ui/SecondaryDetailPanel.jsx';
import { ReceiptLinesEditor } from '../office/ReceiptLinesEditor.jsx';
import { receiptLinePayload } from '../office/receipt-lines-model.js';
import { OperationalCollectionTabs } from '../../components/operations/OperationalCollectionPage.jsx';
import './inventory-workflows.css';
import '../office/physical-receipt-confirmation.css';

const quantityLabel=value=>Number(value).toLocaleString(undefined,{maximumFractionDigits:3});
const priceLabel=(value,currency)=>value===null?'Not specified':`${Number(value).toLocaleString(undefined,{minimumFractionDigits:2,maximumFractionDigits:4})} ${currency}`;
const orderStatusLabel=status=>({ordered:'Ordered',partially_received:'Partially received',awaiting_approval:'Awaiting Approval',draft:'Draft',received:'Received',closed_with_discrepancy:'Closed with discrepancy',cancelled:'Cancelled'}[status]||status);
const purchaseOrderColumns=[
 {id:'po',label:'PO',isRowHeader:true},
 {id:'supplier',label:'Supplier'},
 {id:'total',label:'Total'},
 {id:'expected',label:'Expected'},
 {id:'status',label:'Status'},
 {id:'inventory',label:'Inventory'},
 {id:'bill',label:'Bill'},
];

export function InventoryPurchases(props) {
 const demandHandoffKey=`inventory-purchase-demand-handoff:${props.actorId}`;
 const [demandDraft,setDemandDraft]=useState(null);
 const [section,setSection]=useState(props.initialReceiptOrderId || props.initialPurchaseOrderId ? "purchase_orders" : "needs_ordering");
 useEffect(()=>{if(demandDraft||!props.locations.length)return;try{const saved=JSON.parse(localStorage.getItem(demandHandoffKey));if(saved&&props.locations.some(location=>location.id===saved.locationId)&&Array.isArray(saved.lines)&&saved.lines.length){setDemandDraft(saved);setSection('purchase_orders');}else if(saved)localStorage.removeItem(demandHandoffKey);}catch{localStorage.removeItem(demandHandoffKey);}},[demandDraft,demandHandoffKey,props.locations]);
 function startDemandOrder(lines,locationId){const handoff={lines,locationId,key:crypto.randomUUID()};localStorage.setItem(demandHandoffKey,JSON.stringify(handoff));setDemandDraft(handoff);setSection('purchase_orders');}
 function finishDemandOrder(){localStorage.removeItem(demandHandoffKey);setDemandDraft(null);}
 return <section className="inventory-workflows inventory-purchases-shell">
   <OperationalCollectionTabs ariaLabel="Purchases views" activeId={section} onChange={setSection} items={[
     {id:'needs_ordering',label:'Needs ordering'},
     {id:'purchase_orders',label:'Purchase orders'},
   ]}/>
   {section==='needs_ordering'?<InventoryNeedsOrdering {...props} onCreateOrder={startDemandOrder}/>:null}
   {section==='purchase_orders'?<PurchaseOrders {...props} key={demandDraft?.key||'purchase-orders'} initialDraftLines={demandDraft?.lines||[]} initialLocationId={demandDraft?.locationId||''} demandDraftId={demandDraft?.key||''} onDemandOrderFinished={finishDemandOrder}/>:null}
 </section>;
}

function PurchaseOrders({locations,actorId,view='purchases',onInvoice,onStock,initialReceiptOrderId='',initialPurchaseOrderId='',initialPurchaseOrderNumber='',initialDraftLines=[],initialLocationId='',demandDraftId='',onDemandOrderFinished}) {
 const [receiptOrder,setReceiptOrder]=useState(null),[receiptLines,setReceiptLines]=useState([]),[receiptReady,setReceiptReady]=useState(false),[receiptReference,setReceiptReference]=useState('');
 const [receiptPositions,setReceiptPositions]=useState([]),[receiptPositionsLoading,setReceiptPositionsLoading]=useState(false),[receiptPositionsError,setReceiptPositionsError]=useState(''),[receiptPositionsReload,setReceiptPositionsReload]=useState(0);
 const receiptKeyRef=useRef('');
 const [billUploadRequested,setBillUploadRequested]=useState(false);
 const [filtersOpen,setFiltersOpen]=useState(false);
 const [orderStatus,setOrderStatus]=useState('all'),[supplierFilter,setSupplierFilter]=useState(''),[searchFilter,setSearchFilter]=useState(initialPurchaseOrderNumber);
 const showOrders=true;
 const [locationId,setLocationId]=useState(()=>locations.some(location=>location.id===initialLocationId)?initialLocationId:locations[0]?.id||'');
 const [data,setData]=useState(null),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[page,setPage]=useState(1);
 const [selected,setSelected]=useState(null),[creating,setCreating]=useState(initialDraftLines.length>0);
 const [supplierOpen,setSupplierOpen]=useState(false),[supplierName,setSupplierName]=useState(''),[contact,setContact]=useState('');
 const [draft,setDraft]=useState({supplierId:'',currency:'USD',lines:initialDraftLines,notes:'',expectedDeliveryDate:''}),[query,setQuery]=useState(''),[part,setPart]=useState(null),[amount,setAmount]=useState('1'),[price,setPrice]=useState(''),[reason,setReason]=useState('');
 const demandBacked=initialDraftLines.length>0&&!draft.orderId;
 const [newUnit,setNewUnit]=useState('ea'),[newTracking,setNewTracking]=useState('quantity');
 const formRef=useRef(null);
 const purchaseCurrencyAppliedRef=useRef(false);
 const [feedback,setFeedback]=useState(null),[invalidFields,setInvalidFields]=useState([]);
 function clearField(field){setInvalidFields(fields=>fields.filter(item=>item!==field));}
 function showValidation(issues){setInvalidFields(issues.map(issue=>issue.field));if(issues.some(issue=>issue.field==='lines')){const more=formRef.current?.querySelector('.purchase-more-details');if(more)more.open=true;}setFeedback({title:'Complete the required details',issues,validation:true});}
 function closeFeedback(){const field=feedback?.validation?feedback.issues[0]?.field:null;setFeedback(null);if(field)window.setTimeout(()=>formRef.current?.querySelector(`[data-po-field="${field}"] input:not([type=hidden]), [data-po-field="${field}"] button`)?.focus(),50);}
 const priceError=price.trim()&&!/^\d{1,10}(\.\d{1,4})?$/.test(price.trim())?'Enter a valid price, such as 12.50, or leave it blank.':'';
 const storageKey=`inventory-purchase-command:${actorId}:${locationId}`;
 const draftStorageKey=demandBacked?`${storageKey}:demand:${demandDraftId}`:`${storageKey}:draft`;
 const [pending,setPending]=useState(null),[draftReady,setDraftReady]=useState('');
 useEffect(()=>{try{const saved=JSON.parse(localStorage.getItem(draftStorageKey));setDraft(saved||{supplierId:'',currency:'USD',lines:initialDraftLines,notes:'',expectedDeliveryDate:''});}catch{setDraft({supplierId:'',currency:'USD',lines:initialDraftLines,notes:'',expectedDeliveryDate:''});}if(initialDraftLines.length)setCreating(true);setDraftReady(draftStorageKey);},[draftStorageKey]);
 useEffect(()=>{if(draftReady===draftStorageKey)try{localStorage.setItem(draftStorageKey,JSON.stringify(draft));}catch{setError('Draft storage is unavailable.');}},[draft,draftReady,draftStorageKey]);
 useEffect(()=>{if(!locationId&&locations.length)setLocationId(locations.some(location=>location.id===initialLocationId)?initialLocationId:locations[0].id);},[locations,locationId,initialLocationId]);
 useEffect(()=>{setPage(1);setSelected(null);try{setPending(JSON.parse(localStorage.getItem(storageKey)));}catch{setPending(null);}},[storageKey]);
 useEffect(()=>{setData(null);},[locationId,page,view,orderStatus,supplierFilter,searchFilter]);
 const receiptPositionIdentity=receiptOrder&&locationId?`${receiptOrder.id}:${receiptOrder.version}:${locationId}`:'';
 useEffect(()=>{setReceiptLines([]);setReceiptReady(false);setReceiptPositions([]);setReceiptPositionsError('');},[receiptPositionIdentity]);
 useEffect(()=>{
   if(!receiptPositionIdentity){setReceiptPositionsLoading(false);return undefined;}
   let active=true;setReceiptPositionsLoading(true);setReceiptPositionsError('');
   api(`/api/office/inventory/locations/${encodeURIComponent(locationId)}/positions`).then(result=>{if(active)setReceiptPositions(result.positions||result.items||[]);}).catch(next=>{if(active)setReceiptPositionsError(next.message||'Storage destinations could not be loaded.');}).finally(()=>{if(active)setReceiptPositionsLoading(false);});
   return()=>{active=false;};
 },[receiptPositionIdentity,receiptPositionsReload]);
 useEffect(()=>{
   if(!locationId)return;
   let active=true;setError('');
   api(`/api/office/inventory/purchasing?${new URLSearchParams({locationId,page:String(page),view,status:view==='receiving'?'all':orderStatus,supplierId:supplierFilter,query:searchFilter})}`).then(value=>{if(active){setData(value);setSelected(current=>current?value.items.find(order=>order.id===current.id)||null:null);}}).catch(e=>{if(active)setError(e.message);});
   return()=>{active=false;};
 },[locationId,page,view,orderStatus,supplierFilter,searchFilter,refresh]);
 useEffect(()=>{if(demandBacked&&!purchaseCurrencyAppliedRef.current&&data?.purchaseDefaults?.currency){purchaseCurrencyAppliedRef.current=true;setDraft(current=>({...current,currency:data.purchaseDefaults.currency}));}},[data?.purchaseDefaults?.currency,demandBacked]);
 useEffect(()=>{
   const refreshPurchases=()=>{if(document.visibilityState==='visible')setRefresh(x=>x+1);};
   window.addEventListener('focus',refreshPurchases);
   const timer=window.setInterval(refreshPurchases,3000);
   return()=>{window.removeEventListener('focus',refreshPurchases);window.clearInterval(timer);};
 },[]);
 async function command(body){
   if(busy)return;setBusy(true);setError('');
   const request=pending||{...body,locationId,idempotencyKey:crypto.randomUUID()};
   try{
     localStorage.setItem(storageKey,JSON.stringify(request));setPending(request);
     const result=await sendInventoryCommand({request,recover:!!pending,url:'/api/office/inventory/purchasing'});
     localStorage.removeItem(storageKey);setPending(null);setRefresh(x=>x+1);
     if(result.supplier){setDraft(d=>({...d,supplierId:result.supplier.id}));setSupplierOpen(false);setSupplierName('');setContact('');}
     if(result.order){setOrderStatus('all');setSupplierFilter('');setSearchFilter('');setPage(1);setSelected(request.action==='receive'?null:result.order);setCreating(false);if(['create','revise'].includes(request.action)){localStorage.removeItem(draftStorageKey);setDraft({supplierId:'',currency:'USD',lines:[],notes:'',expectedDeliveryDate:''});if(demandBacked)onDemandOrderFinished?.();}}
   }catch(e){setFeedback({title:'Could not save purchase order',issues:[{field:'',message:e.message}]});if(inventoryCommandCanBeEdited(e)){localStorage.removeItem(storageKey);setPending(null);}}finally{setBusy(false);}
 }
 async function postPurchaseReceipt(){
   if(!receiptOrder||busy||!receiptReady)return;
   setBusy(true);setError('');
   try{
     if(!receiptKeyRef.current)receiptKeyRef.current=crypto.randomUUID();
     const lines=receiptLinePayload(receiptLines).map(({invoiceLineIndex:_invoiceLineIndex,...line})=>line);
     await api(`/api/office/inventory/purchasing/${encodeURIComponent(receiptOrder.id)}/receipts`,{method:'POST',body:JSON.stringify({locationId,expectedVersion:receiptOrder.version,idempotencyKey:receiptKeyRef.current,reference:receiptReference.trim(),lines})});
     receiptKeyRef.current='';setReceiptOrder(null);setReceiptLines([]);setReceiptReady(false);setReceiptReference('');setRefresh(x=>x+1);
   }catch(e){if(e?.code==='INVENTORY_RECEIPT_POSITION_INVALID')setReceiptPositionsReload(value=>value+1);setError(e.message||'The receipt could not be posted.');}finally{setBusy(false);}
 }
 function openReceipt(order){receiptKeyRef.current=crypto.randomUUID();setError('');setReceiptOrder(order);setReceiptLines([]);setReceiptReady(false);setReceiptReference('');}
 useEffect(()=>{
   if(!initialReceiptOrderId||!data?.items?.length)return;
   const order=data.items.find((entry)=>entry.id===initialReceiptOrderId);
   if(order)openReceipt(order);
 },[data,initialReceiptOrderId]);
 useEffect(()=>{
   if(!initialPurchaseOrderId||!data?.items?.length)return;
   const order=data.items.find((entry)=>entry.id===initialPurchaseOrderId);
   if(order){setSelected(order);setReason('');}
 },[data,initialPurchaseOrderId]);
 function receiptFacts(order){return order.lines.map((line,index)=>({invoiceLineIndex:index,purchaseLineId:line.id,partNumber:line.part_number,description:line.description||'',uomCode:line.uom_code,invoiceQuantity:Number(line.quantity)-Number(line.received_quantity)-Number(line.cancelled_quantity),remainingQuantity:Number(line.quantity)-Number(line.received_quantity)-Number(line.cancelled_quantity),trackingMode:line.tracking_mode}));}
 const activeReceiptFacts=useMemo(()=>receiptOrder?receiptFacts(receiptOrder):[],[receiptOrder]);
 function enteredLine(){
   if(!query.trim()||!Number.isFinite(Number(amount))||Number(amount)<=0)throw new Error('Enter a part and a positive quantity.');
   if(priceError)throw new Error(priceError);
   if(draft.lines.some(line=>part?line.catalogPartId===part.id:line.partNumber.toUpperCase()===query.trim().toUpperCase()))throw new Error('This part is already in the order.');
   const line=part?{catalogPartId:part.id,partNumber:part.partNumber,uomCode:part.uomCode}:{partNumber:query.trim(),description:query.trim(),uomCode:newUnit,trackingMode:newTracking};
   return {...line,quantity:Number(amount),unitPrice:price.trim()||null};
 }
 function clearLine(){setQuery('');setPart(null);setAmount('1');setPrice('');clearField('part');}
 function updateDemandPrice(index,value){setDraft(current=>({...current,lines:current.lines.map((line,lineIndex)=>lineIndex===index?{...line,unitPrice:value.trim()||null}:line)}));}
 function addLine(){
   const issues=validatePurchaseOrder({draft,query,part,amount,price,lineOnly:true});if(issues.length){showValidation(issues);return;}
   try{const line=enteredLine();setDraft(d=>({...d,lines:[...d.lines,line]}));clearLine();}catch(e){setFeedback({title:'Check the order details',issues:[{field:'part',message:e.message}],validation:true});}
 }
 function saveDraft(event){
   const placeOrder=event.nativeEvent.submitter?.value==='place';
   event.preventDefault();
   if(busy||pending)return;
   const issues=validatePurchaseOrder({draft,query,part,amount,price,placeOrder});
   if(issues.length){showValidation(issues);return;}
   setInvalidFields([]);
   try{
     if(!draft.supplierId)throw new Error('Choose a supplier before saving.');
     const lines=query.trim()||part?[...draft.lines,enteredLine()]:draft.lines;
     if(!lines.length)throw new Error('Enter at least one part before saving.');
     setDraft(d=>({...d,lines}));clearLine();
     command({action:draft.orderId?'revise':'create',...draft,expectedDeliveryDate:draft.expectedDeliveryDate||null,placeOrder,lines:lines.map(({catalogPartId,partNumber,description,uomCode,trackingMode,quantity,unitPrice,demandSources=[]})=>catalogPartId?{catalogPartId,quantity,unitPrice,demandSources}:{partNumber,description,uomCode,trackingMode,quantity,unitPrice,demandSources})});
   }catch(e){setFeedback({title:'Check the order details',issues:[{field:'part',message:e.message}],validation:true});}
 }
 const title=view==='receiving'?'Expected deliveries':'All Purchase Orders';
 return <section className="inventory-workflows purchase-orders-page">
   <div className="inventory-workflow-toolbar purchase-orders-toolbar"><label>Location<Dropdown value={locationId} onChange={e=>setLocationId(e.target.value)} disabled={busy||!!pending}>{locations.map(l=><option key={l.id} value={l.id}>{l.name}</option>)}</Dropdown></label><IconButton className="purchase-refresh" icon={RefreshCw01} label="Refresh purchases" onClick={()=>setRefresh(x=>x+1)}/>{view==='purchases'?<><Button variant="primary" onClick={()=>{setCreating(true);setSelected(null);}}>New purchase order</Button><Button disabled={!locationId} onClick={()=>onInvoice?.(locationId)}>Add supplier invoice</Button></>:<Button onClick={onStock}>Receive without a purchase order</Button>}</div>
   {error?<p role="alert" className="ops-error">{error}</p>:null}
   {pending?<div role="status"><p>A saved purchase command is awaiting confirmation.</p><Button disabled={busy} onClick={()=>command(pending)}>Recover saved command</Button></div>:null}
   <ModalFrame overlayClassName="purchase-editor-overlay" modalClassName="purchase-editor-modal" dialogClassName="purchase-editor-dialog" ariaLabel={draft.orderId?'Edit purchase order':'New purchase order'} isOpen={creating} isDismissable={!busy&&!pending} onOpenChange={open=>{if(!open&&!busy&&!pending)setCreating(false);}}>
     <header className="purchase-editor-header"><Heading slot="title">{draft.orderId?'Edit purchase order':'New purchase order'}</Heading><IconButton icon={XClose} label="Close purchase order" disabled={busy||!!pending} onClick={()=>setCreating(false)} /></header>
     <form ref={formRef} noValidate onSubmit={saveDraft} className="inventory-workflow-form purchase-order-form">
     <small className="purchase-required-hint">Supplier is required. Unknown prices are sent for approval.</small>{demandBacked?<section className="purchase-demand-summary" aria-label="Order lines"><h3>Order lines</h3><ul>{draft.lines.map(line=><li key={line.catalogPartId||line.partNumber}><strong>{line.partNumber}</strong><span>{line.quantity} {line.uomCode} · {line.unitPrice===null?'Price unknown':`${line.unitPrice} ${draft.currency}`}</span></li>)}</ul></section>:null}<div className={`purchase-form-meta${demandBacked?' is-compact':''}`}><div className="purchase-form-supplier"><label data-po-field="supplier"><span>Supplier <span className="purchase-required" aria-hidden="true">*</span></span><Dropdown aria-label="Supplier" aria-invalid={invalidFields.includes('supplier')} required value={draft.supplierId} disabled={busy||!!pending} onChange={e=>{setDraft(d=>({...d,supplierId:e.target.value}));clearField('supplier');}}><option value="">Choose supplier</option>{data?.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Dropdown></label>{!demandBacked?<Button type="button" onClick={()=>setSupplierOpen(!supplierOpen)}>New supplier</Button>:null}</div>
     {!demandBacked?<><label data-po-field="currency"><span>Currency <span className="purchase-required" aria-hidden="true">*</span></span><CurrencySelector aria-invalid={invalidFields.includes('currency')} required value={draft.currency} onChange={e=>{setDraft(d=>({...d,currency:e.target.value.toUpperCase()}));clearField('currency');}} /></label>
     <label><span>Expected delivery date (optional)</span><DatePicker aria-label="Expected Delivery Date" value={draft.expectedDeliveryDate||''} onChange={e=>setDraft(d=>({...d,expectedDeliveryDate:e.target.value}))} /></label></>:null}
     </div>
     {supplierOpen&&!demandBacked?<div className="purchase-form-new-supplier"><label>Supplier name<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} /></label><label>Contact (optional)<input value={contact} onChange={e=>setContact(e.target.value)} /></label><Button type="button" disabled={busy||!supplierName.trim()} onClick={()=>command({action:'supplier',name:supplierName,contact})}>Save supplier</Button></div>:null}
     {demandBacked?<details className="purchase-more-details" data-po-field="lines"><summary>More details</summary><div>{draft.lines.map((line,index)=><label key={line.catalogPartId||line.partNumber}>Unit price for {line.partNumber}<input aria-label={`Unit price for ${line.partNumber}`} aria-invalid={invalidFields.includes('lines')} inputMode="decimal" value={line.unitPrice??''} onChange={event=>{updateDemandPrice(index,event.target.value);clearField('lines');}} placeholder="Unknown" /></label>)}<label>Currency<CurrencySelector aria-invalid={invalidFields.includes('currency')} value={draft.currency} onChange={e=>{setDraft(d=>({...d,currency:e.target.value.toUpperCase()}));clearField('currency');}} /></label><label>Expected delivery date (optional)<DatePicker aria-label="Expected Delivery Date" value={draft.expectedDeliveryDate||''} onChange={e=>setDraft(d=>({...d,expectedDeliveryDate:e.target.value}))} /></label><label>Notes (optional)<textarea rows={1} value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} /></label><Button type="button" onClick={()=>setSupplierOpen(!supplierOpen)}>New supplier</Button>{supplierOpen?<div className="purchase-form-new-supplier"><label>Supplier name<input value={supplierName} onChange={e=>setSupplierName(e.target.value)} /></label><label>Contact (optional)<input value={contact} onChange={e=>setContact(e.target.value)} /></label><Button type="button" disabled={busy||!supplierName.trim()} onClick={()=>command({action:'supplier',name:supplierName,contact})}>Save supplier</Button></div>:null}</div></details>:null}
     {!demandBacked?<><div className="purchase-form-line"><div className="purchase-form-part" data-po-field="part" data-invalid={invalidFields.includes('part')}><PartCatalogCombobox label={<>Part number or description <span className="purchase-required" aria-hidden="true">*</span></>} inputAriaLabel="Part number or description" locationId={locationId} purpose="master_match" catalogEndpoint="/api/office/inventory/catalog" value={query} onChange={value=>{setQuery(value);setPart(null);clearField('part');}} onSelect={value=>{setPart(value);setQuery(value.partNumber);clearField('part');}} /></div>
     <label data-po-field="quantity"><span>Quantity ({part?.uomCode||newUnit}) <span className="purchase-required" aria-hidden="true">*</span></span><input aria-label="Quantity" aria-invalid={invalidFields.includes('quantity')} type="number" step="any" min="0" value={amount} onChange={e=>{setAmount(e.target.value);clearField('quantity');}} /></label><label data-po-field="price"><span>Unit price (optional)</span><input aria-label="Unit price" aria-invalid={invalidFields.includes('price')} inputMode="decimal" value={price} onChange={e=>{setPrice(e.target.value);clearField('price');}} /></label><Button type="button" disabled={busy||!!pending} onClick={addLine}>Add line</Button></div>
     {!part&&query.trim()?<div className="purchase-form-tracking"><label>Unit<UnitOfMeasurePicker uomCode={newUnit} onChange={setNewUnit}/></label><label>Tracking<Dropdown aria-label="Tracking" value={newTracking} onChange={e=>setNewTracking(e.target.value)}><option value="quantity">Quantity</option><option value="serialized">Serialized</option><option value="measured_bulk">Measured / bulk</option></Dropdown></label><small>Stock is added only when you choose Add to inventory after receiving.</small></div>:null}

     {draft.lines.length?<ul className="purchase-form-items" data-po-field="lines">{draft.lines.map((line,index)=><li key={line.catalogPartId||line.partNumber}>{line.partNumber} · {line.quantity} {line.uomCode} · {line.unitPrice===null?'Price unknown':`${line.unitPrice} ${draft.currency}`} <Button type="button" onClick={()=>setDraft(d=>({...d,lines:d.lines.filter((_,i)=>i!==index)}))}>Remove</Button></li>)}</ul>:null}
     <label>Notes (optional)<textarea rows={1} value={draft.notes} onChange={e=>setDraft(d=>({...d,notes:e.target.value}))} /></label></>:null}<div className="purchase-draft-actions"><Button type="button" onClick={()=>setCreating(false)}>Close draft</Button>{!demandBacked?<Button type="submit" disabled={busy||!!pending}>Save draft</Button>:null}<Button type="submit" name="action" value="place" variant="primary" disabled={busy||!!pending}>{demandBacked?'Place order':'Save / Place Order'}</Button></div>
   </form></ModalFrame>
   {showOrders?<><div className="purchase-table-heading"><h3>{title}</h3><Button icon={FilterLines} aria-expanded={filtersOpen} aria-controls="purchase-order-filters" onClick={()=>setFiltersOpen(open=>!open)}>Filters{orderStatus!=='all'||supplierFilter||searchFilter?' (active)':''}</Button></div>
   {filtersOpen?<div id="purchase-order-filters" className="purchase-filter-bar">
     <label>Search<input type="search" placeholder="PO or supplier" value={searchFilter} onChange={e=>{setSearchFilter(e.target.value);setPage(1);}}/></label>
     <label>Status<Dropdown value={orderStatus} onChange={e=>{setOrderStatus(e.target.value);setPage(1);}}><option value="all">All statuses</option>{['draft','awaiting_approval','ordered','partially_received','received','closed_with_discrepancy','cancelled'].map(status=><option key={status} value={status}>{orderStatusLabel(status)}</option>)}</Dropdown></label>
     <label>Supplier<Dropdown value={supplierFilter} onChange={e=>{setSupplierFilter(e.target.value);setPage(1);}}><option value="">All suppliers</option>{data?.suppliers.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</Dropdown></label>
     <Button onClick={()=>{setOrderStatus('all');setSupplierFilter('');setSearchFilter('');setPage(1);}}>Clear</Button>
   </div>:null}{!data?<p role="status">Loading purchases…</p>:data.items.length===0?<p>No {view==='receiving'?'expected deliveries':'purchase orders'} at this location.</p>:<OperationalDataTable ariaLabel={view==='receiving'?'Expected deliveries':'Purchase orders'} columns={purchaseOrderColumns} className="purchase-orders-table inventory-data-table">{data.items.map(order=><OperationalDataRow id={order.id} key={order.id}><OperationalDataCell label="PO"><button type="button" className="purchase-order-link" onClick={()=>{setSelected(order);setReason('');}}>{order.number}</button></OperationalDataCell><OperationalDataCell label="Supplier">{order.supplier_name}</OperationalDataCell><OperationalDataCell label="Total">{priceLabel(order.total,order.currency)}</OperationalDataCell><OperationalDataCell label="Expected">{order.expected_delivery_date||'Not set'}</OperationalDataCell><OperationalDataCell label="Status"><span className={`purchase-status is-${order.status}`}>{orderStatusLabel(order.status)}</span></OperationalDataCell><OperationalDataCell label="Inventory">{order.lines.some(line=>Number(line.quantity)>Number(line.received_quantity)+Number(line.cancelled_quantity))?<button type="button" className="purchase-order-link" onClick={()=>openReceipt(order)}>Receive items</button>:<span className="purchase-inventory-added">All quantities received</span>}</OperationalDataCell><OperationalDataCell label="Bill">{order.status==='received'?<button type="button" className="purchase-order-link" onClick={()=>{setBillUploadRequested(true);setSelected(order);setReason('');}}>Upload bill</button>:'-'}</OperationalDataCell></OperationalDataRow>)}</OperationalDataTable>}

   {page>1||data?.hasMore?<div className="inventory-request-actions"><Button disabled={page===1} onClick={()=>setPage(p=>p-1)}>Previous</Button> Page {page} <Button disabled={!data?.hasMore} onClick={()=>setPage(p=>p+1)}>Next</Button></div>:null}
   </>:null}
   {view==='receiving'?<><h3>Recent receipts</h3>{data?.receipts.length?<ul>{data.receipts.map((r,index)=><li key={`${r.id}:${index}`}>{r.part_number} · {r.quantity} {r.uom_code} · {new Date(r.posted_at).toLocaleString()} · {r.source_reference||r.source_type}</li>)}</ul>:<p>No receipts recorded.</p>}</>:null}

   <SecondaryDetailPanel open={!!selected} onOpenChange={open=>{if(!open)setSelected(null);}} eyebrow="Purchase order" title={selected?.number||'Purchase'} description={selected?.supplier_name||''}>
    {selected?<div className="inventory-workflows purchase-order-detail"><span className={`purchase-status is-${selected.status}`}>{orderStatusLabel(selected.status)}</span><SecondaryDetailSection title="Order items">
      {selected.lines.some(line=>Number(line.quantity)>Number(line.received_quantity)+Number(line.cancelled_quantity))?<p>Receive only the quantities that physically arrived. Remaining quantities stay open on this purchase order.</p>:<p>All ordered quantities are received or cancelled.</p>}
      <div className="purchase-order-meta"><span>Total <strong>{priceLabel(selected.total,selected.currency)}</strong></span><span>Expected Delivery Date <strong>{selected.expected_delivery_date||'Not set'}</strong></span>{selected.notes?<span>Notes <strong>{selected.notes}</strong></span>:null}</div>
      {selected.lines.map(line=>{const remaining=Number(line.quantity)-Number(line.received_quantity)-Number(line.cancelled_quantity);return <div key={line.id} className="inventory-workflow-suggestion"><div><strong>{line.part_number}</strong><dl className="purchase-line-quantities"><div><dt>Ordered</dt><dd>{quantityLabel(line.quantity)} {line.uom_code}</dd></div><div><dt>Received</dt><dd>{quantityLabel(line.received_quantity)} {line.uom_code}</dd></div>{Number(line.cancelled_quantity)>0?<div><dt>Cancelled</dt><dd>{quantityLabel(line.cancelled_quantity)} {line.uom_code}</dd></div>:null}<div><dt>Remaining</dt><dd>{quantityLabel(remaining)} {line.uom_code}</dd></div><div><dt>Unit price</dt><dd>{priceLabel(line.unit_price,selected.currency)}</dd></div></dl></div></div>;})}
    </SecondaryDetailSection>
    {selected.delivery_condition?<SecondaryDetailSection title="Delivery condition"><p>{selected.delivery_condition==='damaged'?'Damaged items reported':'Received undamaged'}</p>{selected.delivery_damage_details?<p className="purchase-delivery-notes">{selected.delivery_damage_details}</p>:null}{selected.delivery_condition==='damaged'?<p>When adding damaged quantities to inventory, choose ?Damaged / held for inspection?. Add undamaged quantities separately.</p>:null}</SecondaryDetailSection>:null}
    <PurchaseOrderBills key={selected.id} order={selected} autoOpen={billUploadRequested} onOpened={()=>setBillUploadRequested(false)}/>
    <SecondaryDetailSection title="Actions"><div className="purchase-order-actions"><label>Reason / supplier communication reference<textarea placeholder="Reference or reason for the action" rows={2} value={reason} onChange={e=>setReason(e.target.value)} /></label><div className="inventory-workflow-toolbar">
      {selected.lines.some(line=>Number(line.quantity)>Number(line.received_quantity)+Number(line.cancelled_quantity))?<Button variant="primary" disabled={busy||!!pending} onClick={()=>openReceipt(selected)}>Receive items</Button>:null}
      {selected.status==='draft'?<Button disabled={busy||!!pending} onClick={()=>{setDraft({orderId:selected.id,expectedVersion:selected.version,supplierId:selected.supplier_id,currency:selected.currency,notes:selected.notes,expectedDeliveryDate:selected.expected_delivery_date||'',lines:selected.lines.map(l=>({catalogPartId:l.catalog_part_id,partNumber:l.part_number,uomCode:l.uom_code,description:l.description,trackingMode:l.tracking_mode,quantity:Number(l.quantity),unitPrice:l.unit_price}))});setCreating(true);setSelected(null);}}>Edit draft</Button>:null}
      {selected.status==='draft'?<Button disabled={busy||!!pending} onClick={()=>command({action:'place',orderId:selected.id,expectedVersion:selected.version})} variant="primary">Place Order</Button>:null}
      {selected.status==='awaiting_approval'&&data?.canApprove?<Button disabled={busy||!!pending} onClick={()=>command({action:'approve',orderId:selected.id,expectedVersion:selected.version})} variant="primary">Approve</Button>:null}
      {!['received','closed_with_discrepancy','cancelled'].includes(selected.status)?<Button disabled={busy||!!pending||!reason.trim()} onClick={()=>command({action:'cancel',orderId:selected.id,expectedVersion:selected.version,reason})}>Cancel outstanding quantities</Button>:null}
      {(selected.status==='ordered')?<Button disabled={busy||!!pending||!reason.trim()} onClick={()=>command({action:'record_sent',orderId:selected.id,expectedVersion:selected.version,reason})}>Record supplier communication</Button>:null}
    </div>{selected.communication_reference?<p className="purchase-communication">Supplier reference: {selected.communication_reference}</p>:null}{error?<p role="alert">{error}</p>:null}{pending?<Button disabled={busy} onClick={()=>command(pending)}>Check saved action</Button>:null}</div></SecondaryDetailSection></div>:null}
   </SecondaryDetailPanel>

   <ModalFrame overlayClassName="purchase-feedback-overlay" modalClassName="purchase-feedback-modal" dialogClassName="purchase-feedback-dialog" ariaLabel="Receive purchase order" isOpen={Boolean(receiptOrder)} isDismissable={!busy} onOpenChange={open=>{if(!open&&!busy)setReceiptOrder(null);}}><Heading slot="title">Receive {receiptOrder?.number}</Heading>{receiptOrder?<><div className="physical-receipt-destination-status">{receiptPositionsLoading?<p role="status">Loading eligible storage destinations…</p>:null}{receiptPositionsError?<p role="alert"><span>{receiptPositionsError}</span><Button type="button" onClick={()=>setReceiptPositionsReload(value=>value+1)} disabled={busy||receiptPositionsLoading}>Try again</Button></p>:null}</div>{error?<p role="alert" className="ops-error">{error}</p>:null}<ReceiptLinesEditor facts={activeReceiptFacts} runId={receiptOrder.id} runVersion={receiptOrder.version} positions={receiptPositions} positionLoading={receiptPositionsLoading} positionError={receiptPositionsError} sourceLabel="PO remaining" disabled={busy} onChange={(lines,ready)=>{setReceiptLines(lines);setReceiptReady(ready);}}/><label>Delivery reference (optional)<input maxLength={240} value={receiptReference} onChange={e=>setReceiptReference(e.target.value)} disabled={busy}/></label><footer><Button onClick={()=>setReceiptOrder(null)} disabled={busy}>Cancel</Button><Button variant="primary" disabled={busy||!receiptReady} onClick={postPurchaseReceipt}>{busy?'Posting received items…':'Post received items'}</Button></footer></>:null}</ModalFrame>
   <PurchaseOrderFeedbackDialog feedback={feedback} onClose={closeFeedback}/>
 </section>;
}
