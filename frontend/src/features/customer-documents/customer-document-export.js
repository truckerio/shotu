import { customerDocumentHtml, customerDocumentFileName } from '../../../../shared/customer-document-template.js';
import { apiErrorDetails } from '../../lib/api.js';
export function printCustomerDocument(projection,{openWindow=()=>window.open('','_blank')}={}) {
 const popup=openWindow();
 if(!popup)throw new Error('Allow pop-ups to print this document.');
 popup.opener=null;
 popup.document.open();popup.document.write(customerDocumentHtml(projection));popup.document.close();
 popup.focus();popup.print();
 return popup;
}
export async function downloadCustomerDocument(input,{projection={},endpoint='/api/customer-documents/export',headers={},method='POST',fetchImpl=fetch,documentRef=document,urlApi=URL}={}) {
 const response=await fetchImpl(endpoint,{method,credentials:'same-origin',headers:{accept:'application/pdf',...(method==='POST'?{'content-type':'application/json'}:{}),...headers},...(method==='POST'?{body:JSON.stringify(input)}:{})});
 if(!response.ok){const body=await response.json().catch(()=>({}));throw new Error(apiErrorDetails(body).message);}
 if(!response.headers.get('content-type')?.includes('application/pdf'))throw new Error('The document download did not return a PDF.');
 const blob=await response.blob();
 const href=urlApi.createObjectURL(blob),link=documentRef.createElement('a');
 const match=/filename="([a-zA-Z0-9_.-]+)"/.exec(response.headers.get('content-disposition')||'');
 try {link.href=href;link.download=match?.[1]||customerDocumentFileName(projection);documentRef.body.appendChild(link);link.click();}
 finally{link.remove();setTimeout(()=>urlApi.revokeObjectURL(href),1000);}
}
