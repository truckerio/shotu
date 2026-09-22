import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Button } from '../../components/ui/Button.jsx';
import { UploadDialog } from '../../components/ui/UploadDialog.jsx';
import { SecondaryDetailSection } from '../../components/ui/SecondaryDetailPanel.jsx';

const types=['application/pdf','image/png','image/jpeg','image/webp'];
function dataUrl(file) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this file. Select it again.'));reader.readAsDataURL(file);});}

export function PurchaseOrderBills({order,autoOpen=false,onOpened}) {
  const [items,setItems]=useState([]),[loading,setLoading]=useState(true),[listError,setListError]=useState('');
  const [open,setOpen]=useState(false),[file,setFile]=useState(null),[reference,setReference]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[refresh,setRefresh]=useState(0),[message,setMessage]=useState('');
  const attempt=useRef(null);
  useEffect(()=>{if(autoOpen){setOpen(true);onOpened?.();}},[autoOpen,onOpened]);
  const endpoint=`/api/office/inventory/purchasing/${order.id}/bills`;
  useEffect(()=>{let active=true;setLoading(true);setListError('');api(endpoint).then(result=>{if(active)setItems(result.items);}).catch(e=>{if(active)setListError(e.message);}).finally(()=>{if(active)setLoading(false);});return()=>{active=false;};},[endpoint,refresh]);
  function choose(next) {
    setError('');setFile(null);attempt.current=null;
    if(!next)return;
    if(!types.includes(next.type)){setError('Choose a PDF, JPG, PNG or WebP file.');return;}
    if(!next.size||next.size>10*1024*1024){setError('Choose a nonempty file up to 10 MB.');return;}
    setFile(next);
  }
  async function upload(event) {
    event.preventDefault();if(busy||!file)return;setBusy(true);setError('');
    try {
      if(!attempt.current)attempt.current={idempotencyKey:crypto.randomUUID(),fileName:file.name,mimeType:file.type,dataUrl:await dataUrl(file),reference};
      const result=await api(endpoint,{method:'POST',body:JSON.stringify(attempt.current)});
      setMessage(result.replayed?'This bill is already attached to this purchase order.':'Bill uploaded.');
      setItems(current=>current.some(item=>item.id===result.document.id)?current:[...current,result.document]);
      setOpen(false);setFile(null);setReference('');attempt.current=null;setRefresh(value=>value+1);
    }catch(e){setError(e.message);if([400,403,404,413,422].includes(e.status))attempt.current=null;}
    finally{setBusy(false);}
  }
  return <>
    <SecondaryDetailSection title="Bills" description="Supplier invoices attached to this purchase order." action={order.status==='received'?<Button onClick={()=>{setOpen(true);setError('');setMessage('');}}>Upload bill</Button>:null}>
      {loading?<p role="status">Loading bills…</p>:null}
      {listError?<p role="alert">{listError} <Button onClick={()=>setRefresh(value=>value+1)}>Retry</Button></p>:null}
      {!loading&&!listError&&!items.length?<p>No bills uploaded.</p>:null}
      <ul className="purchase-bill-files">{items.map(item=><li key={item.id}><a href={`${endpoint}/${item.id}`} download>{item.file_name}</a><span>{item.reference||'Supplier bill'} · {new Date(item.created_at).toLocaleDateString()}</span></li>)}</ul>
      {message?<p role="status">{message}</p>:null}
    </SecondaryDetailSection>
    <UploadDialog isOpen={open} onOpenChange={value=>{if(!busy)setOpen(value);}} title="Upload bill" closeLabel="Close bill upload" closeDisabled={busy} isDismissable={!busy} description={`${order.number} · ${order.supplier_name}`} error={error}>
      <form className="purchase-bill-upload" onSubmit={upload}>
        <p>Attach the supplier invoice to this PO. This does not add inventory or record a payment.</p>
        <label>Bill file<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy||!!attempt.current} onChange={event=>choose(event.target.files?.[0])}/></label>
        <small>PDF, JPG, PNG or WebP, up to 10 MB. You can upload additional bills later.</small>
        {file?<p>{file.name}</p>:null}
        <label>Invoice reference (optional)<input maxLength={240} value={reference} disabled={busy||!!attempt.current} onChange={event=>setReference(event.target.value)}/></label>
        <footer><Button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy||!file}>{busy?'Uploading…':attempt.current?'Retry upload':'Upload bill'}</Button></footer>
      </form>
    </UploadDialog>
  </>;
}
