import { useEffect, useState, useRef } from 'react';
import { api } from '../../lib/api.js';
import { Button } from '../../components/ui/Button.jsx';
import { UploadDialog } from '../../components/ui/UploadDialog.jsx';

const types=['application/pdf','image/png','image/jpeg','image/webp'];
function dataUrl(file) {return new Promise((resolve,reject)=>{const reader=new FileReader();reader.onload=()=>resolve(reader.result);reader.onerror=()=>reject(new Error('Could not read this file. Select it again.'));reader.readAsDataURL(file);});}

export function PurchaseOrderBills({order,autoOpen=false,onOpened,onUploaded}) {
  const [open,setOpen]=useState(false),[file,setFile]=useState(null),[reference,setReference]=useState(''),[error,setError]=useState(''),[busy,setBusy]=useState(false),[message,setMessage]=useState('');
  const attempt=useRef(null);
  useEffect(()=>{if(autoOpen){setOpen(true);onOpened?.();}},[autoOpen,onOpened]);
  const endpoint=`/api/office/inventory/purchasing/${order.id}/bills`;
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
      setMessage(result.document?.invoiceRunId?'Bill attached. View it in Deliveries & invoices.':result.replayed?'This bill is already attached to this purchase order.':'Bill uploaded.');
      onUploaded?.();
      setOpen(false);setFile(null);setReference('');attempt.current=null;
    }catch(e){setError(e.message);if([400,403,404,413,422].includes(e.status))attempt.current=null;}
    finally{setBusy(false);}
  }
  return <>
    {order.status==='received'?<Button onClick={()=>{setOpen(true);setError('');setMessage('');}}>Upload bill</Button>:null}
    {message?<p role="status">{message}</p>:null}
    <UploadDialog isOpen={open} onOpenChange={value=>{if(!busy)setOpen(value);}} title="Upload bill" closeLabel="Close bill upload" closeDisabled={busy} isDismissable={!busy} description={`${order.number} · ${order.supplier_name}`} error={error}>
      <form className="purchase-bill-upload" onSubmit={upload}>
        <p>Upload the supplier bill to read its invoice details beside this PO.</p>
        <label>Bill file<input type="file" accept=".pdf,.jpg,.jpeg,.png,.webp" disabled={busy||!!attempt.current} onChange={event=>choose(event.target.files?.[0])}/></label>
        <small>PDF, JPG, PNG or WebP, up to 10 MB. You can upload additional bills later.</small>
        {file?<p>{file.name}</p>:null}
        <label>Invoice reference (optional)<input maxLength={240} value={reference} disabled={busy||!!attempt.current} onChange={event=>setReference(event.target.value)}/></label>
        <footer><Button type="button" disabled={busy} onClick={()=>setOpen(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={busy||!file}>{busy?'Uploading…':attempt.current?'Retry upload':'Upload bill'}</Button></footer>
      </form>
    </UploadDialog>
  </>;
}
