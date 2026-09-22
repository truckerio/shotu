import { useEffect, useMemo, useState } from 'react';
import { RefreshCw01 } from '@untitledui/icons';
import { api } from '../../lib/api.js';
import { Button } from '../../components/ui/Button.jsx';
import { IconButton } from '../../components/ui/IconButton.jsx';
import { Checkbox } from '../../components/ui/Checkbox.jsx';
import { Dropdown } from '../../components/forms/Dropdown.jsx';
import { OperationalDataCell, OperationalDataRow, OperationalDataTable } from '../../components/ui/OperationalDataTable.jsx';
import { SecondaryDetailPanel, SecondaryDetailSection } from '../../components/ui/SecondaryDetailPanel.jsx';
import { demandPurchaseLine } from './purchasing-demand-model.js';
import './inventory-tables.css';
import './inventory-workflows.css';

const columns=[
  {id:'select',label:'Select'},
  {id:'part',label:'Part',isRowHeader:true},
  {id:'buy',label:'Buy'},
  {id:'source',label:'Source'},
  {id:'available',label:'Available'},
  {id:'incoming',label:'Incoming'},
  {id:'needed',label:'Needed for'},
  {id:'action',label:'Action'},
];
const quantity=value=>Number(value||0).toLocaleString(undefined,{maximumFractionDigits:3});
const sourceLabel=value=>({workorder:'Workorder',minimum_stock:'Minimum stock',both:'Both',legacy:'Legacy request',mixed:'Mixed'}[value]||value);

export function InventoryNeedsOrdering({locations,onCreateOrder,onInvoice}) {
  const [locationId,setLocationId]=useState(()=>{const requested=new URLSearchParams(window.location.search).get('locationId');return locations.some(item=>item.id===requested)?requested:locations[0]?.id||'';});
  const [data,setData]=useState(null),[error,setError]=useState(''),[refresh,setRefresh]=useState(0),[selectedIds,setSelectedIds]=useState(new Set()),[detail,setDetail]=useState(null);
  useEffect(()=>{if(!locationId&&locations.length)setLocationId(locations[0].id);},[locations,locationId]);
  useEffect(()=>{setData(null);setSelectedIds(new Set());setDetail(null);},[locationId]);
  useEffect(()=>{
    if(!locationId)return;
    let active=true;
    api(`/api/office/inventory/purchasing?${new URLSearchParams({locationId,page:'1',view:'purchases',status:'all',supplierId:'',query:''})}`)
      .then(result=>{if(active){setData(result);setError('');}})
      .catch(failure=>{if(active)setError(failure.message);});
    return()=>{active=false;};
  },[locationId,refresh]);
  const selected=useMemo(()=>data?.demand.filter(row=>selectedIds.has(row.catalog_part_id))||[],[data,selectedIds]);
  function create(rows){onCreateOrder(rows.map(demandPurchaseLine),locationId);}
  function toggle(id){setSelectedIds(current=>{const next=new Set(current);if(next.has(id))next.delete(id);else next.add(id);return next;});}
  return <section className="inventory-workflows inventory-needs-ordering">
    <div className="inventory-workflow-toolbar">
      <label>Location<Dropdown value={locationId} onChange={event=>setLocationId(event.target.value)}>{locations.map(location=><option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
      <IconButton icon={RefreshCw01} label="Refresh ordering needs" onClick={()=>setRefresh(value=>value+1)}/>
      <Button variant="primary" disabled={!selected.length} onClick={()=>create(selected)}>Create order</Button>
      <Button disabled={!locationId} onClick={()=>onInvoice?.(locationId)}>Add supplier invoice</Button>
    </div>
    {error?<p role="alert" className="ops-error">{error}</p>:null}
    {!data?<p role="status">Loading ordering needs…</p>:!data.demand.length?<p>No parts need ordering at this location.</p>:<OperationalDataTable ariaLabel="Needs ordering" columns={columns} className="inventory-data-table inventory-needs-ordering-table">
      {data.demand.map(row=><OperationalDataRow id={row.catalog_part_id} key={`${row.catalog_part_id}:${row.uom_code}`}>
        <OperationalDataCell label="Select"><Checkbox aria-label={`Select ${row.part_number}`} checked={selectedIds.has(row.catalog_part_id)} onChange={()=>toggle(row.catalog_part_id)}/></OperationalDataCell>
        <OperationalDataCell label="Part"><button type="button" className="purchase-order-link" onClick={()=>setDetail(row)}><strong>{row.part_number}</strong></button><small>{row.description} · {row.uom_code}</small></OperationalDataCell>
        <OperationalDataCell label="Buy"><strong>{quantity(row.buy_quantity)} {row.uom_code}</strong></OperationalDataCell>
        <OperationalDataCell label="Source">{sourceLabel(row.source)}</OperationalDataCell>
        <OperationalDataCell label="Available">{quantity(row.available_quantity)}</OperationalDataCell>
        <OperationalDataCell label="Incoming">{quantity(row.incoming_quantity)}</OperationalDataCell>
        <OperationalDataCell label="Needed for">{row.workorders?.length?row.workorders.map(item=>item.workorderNumber).join(', '):row.legacy_requests?.length?'Legacy approved request':'Stock policy'}</OperationalDataCell>
        <OperationalDataCell label="Action"><Button onClick={()=>create([row])}>Create order</Button></OperationalDataCell>
      </OperationalDataRow>)}
    </OperationalDataTable>}
    <SecondaryDetailPanel open={!!detail} onOpenChange={open=>{if(!open)setDetail(null);}} title={detail?.part_number||'Ordering need'} eyebrow="Needs ordering">
      {detail?<>
        <SecondaryDetailSection title="Source breakdown">
          {detail.workorders?.length?<ul>{detail.workorders.map(request=><li key={request.requestId}><strong>{request.workorderNumber}</strong> · {quantity(request.requestedQuantity)} {request.uomCode}</li>)}</ul>:<p>No Workorder demand.</p>}
          {detail.legacy_requests?.length?<><p>Approved legacy requests retained for audit:</p><ul>{detail.legacy_requests.map(request=><li key={request.requestId}>{request.description} · {quantity(request.requestedQuantity)} {request.uomCode}</li>)}</ul></>:null}
        </SecondaryDetailSection>
        <SecondaryDetailSection title="Calculation"><dl className="inventory-detail-list">
          <div><dt>Workorder demand</dt><dd>{quantity(detail.workorder_quantity)}</dd></div>
          <div><dt>Legacy approved demand</dt><dd>{quantity(detail.legacy_quantity)}</dd></div>
          <div><dt>Available stock</dt><dd>{quantity(detail.available_quantity)}</dd></div>
          <div><dt>Reserved stock</dt><dd>{quantity(detail.reserved_quantity)}</dd></div>
          <div><dt>Incoming purchase orders</dt><dd>{quantity(detail.incoming_quantity)}</dd></div>
          <div><dt>Minimum quantity</dt><dd>{detail.minimum_available===null?'Not set':quantity(detail.minimum_available)}</dd></div>
          <div><dt>Target quantity</dt><dd>{detail.target_quantity===null?'Not set':quantity(detail.target_quantity)}</dd></div>
          <div><dt>Buy</dt><dd><strong>{quantity(detail.buy_quantity)} {detail.uom_code}</strong></dd></div>
        </dl></SecondaryDetailSection>
        <div className="inventory-request-actions"><Button variant="primary" onClick={()=>create([detail])}>Create order</Button></div>
      </>:null}
    </SecondaryDetailPanel>
  </section>;
}
