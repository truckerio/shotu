import { CurrencySelector } from "../../../components/forms/CurrencySelector.jsx";
import { FileCheck02 } from '@untitledui/icons';
import { IntegrationSummaryCard } from '../integrations/IntegrationSummaryCard.jsx';
import '../integrations/integrations.css';
import { useEffect, useState } from 'react';
import { api } from '../../../lib/api.js';
import { Button } from '../../../components/ui/Button.jsx';
import { Checkbox } from '../../../components/ui/Checkbox.jsx';
import { Dropdown } from '../../../components/forms/Dropdown.jsx';

export function PurchaseOrderApprovalSettings({ locations, embedded = false }) {
  const [locationId, setLocationId] = useState(locations[0]?.id || '');
  const [data, setData] = useState(null);
  const [draft, setDraft] = useState(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [reload, setReload] = useState(0);
  const [editing, setEditing] = useState(false);
  useEffect(() => { if (!locationId && locations.length) setLocationId(locations[0].id); }, [locationId, locations]);
  function loaded(value) {
    setData(value);
    setDraft({ approvalLimit: value.policy?.approval_limit || '', currency: value.policy?.currency || 'USD',
      approverUserIds: value.policy?.approver_user_ids || [], approverRoles: value.policy?.approver_roles || [],
      expectedVersion: value.policy?.version || 0 });
  }
  useEffect(() => {
    let active = true;
    setData(null); setDraft(null); setError(''); setMessage('');
    if (locationId) api(`/api/office/inventory/purchasing/approval-settings?${new URLSearchParams({ locationId })}`)
      .then(value => { if (active) loaded(value); }).catch(e => { if (active) setError(e.message); });
    return () => { active = false; };
  }, [locationId, reload]);
  function toggle(key, id) {
    setDraft(value => ({ ...value, [key]: value[key].includes(id) ? value[key].filter(item => item !== id) : [...value[key], id] }));
  }
  async function save(event) {
    event.preventDefault();
    if (busy) return;
    setBusy(true); setError(''); setMessage('');
    try {
      loaded(await api('/api/office/inventory/purchasing/approval-settings', { method: 'PUT', body: JSON.stringify({ ...draft, locationId }) }));
      setMessage('Purchase order approval settings saved.');setEditing(false);
    } catch (e) { setError(e.message); }
    finally { setBusy(false); }
  }
  return <section className={`${embedded ? "" : "admin-content "}admin-po-approval`}>
    {!editing ? <IntegrationSummaryCard icon={FileCheck02} title="Purchase Order Approval" category="Purchasing" description="Orders at or below the limit go directly to Ordered. Higher totals require approval on the same PO." statusLabel={data?.policy ? 'Configured' : 'Not configured'} statusTone={data?.policy ? 'connected' : 'disconnected'} facts={[
      {label:'Approval limit',value:data?.policy ? `${data.policy.currency} ${data.policy.approval_limit}` : 'Not set'},
      {label:'Authorized approvers',value:data?.policy ? `${data.policy.approver_roles.length} roles / ${data.policy.approver_user_ids.length} users` : 'Not set'},
      {label:'Company at location',value:locations.find(location=>location.id===locationId)?.name || 'Choose location'},
    ]} onManage={()=>setEditing(true)}/> : <article className="integration-card">
      <header className="integration-card-header"><span className="integration-provider-icon"><FileCheck02/></span><div><h2>Purchase Order Approval</h2><p>Purchasing</p></div></header>
    <label className="po-approval-location">Company at location<Dropdown aria-label="Company at location" value={locationId} disabled={busy} onChange={e => setLocationId(e.target.value)}>{locations.map(location => <option key={location.id} value={location.id}>{location.name}</option>)}</Dropdown></label>
    <p className="integration-description">Applies to all locations in this company. Approvers retain their existing location and module access.</p>
    {draft ? <form onSubmit={save} className="odoo-configuration po-approval-configuration">
      <fieldset className="po-approval-fields" disabled={busy}>
        <label>Approval limit ({draft.currency === 'USD' ? '$' : draft.currency})<input required inputMode="decimal" pattern="[0-9]{1,12}(\.[0-9]{1,2})?" placeholder="5000.00" value={draft.approvalLimit} onChange={e => setDraft(value => ({ ...value, approvalLimit: e.target.value }))} /></label>
        <label>Currency<CurrencySelector required value={draft.currency} onChange={e => setDraft(value => ({ ...value, currency: e.target.value.toUpperCase() }))} /></label>
        <p>The PO and approval limit must use the same currency.</p>
        <fieldset className="po-approval-approvers"><legend>Who can approve</legend>
          {data.roles.map(role => <label className="po-approval-approver" key={role.id}><Checkbox checked={draft.approverRoles.includes(role.id)} onChange={() => toggle('approverRoles', role.id)} />{role.name} role</label>)}
          {data.users.map(user => <label className="po-approval-approver" key={user.id}><Checkbox checked={draft.approverUserIds.includes(user.id)} onChange={() => toggle('approverUserIds', user.id)} />{user.name} ({user.role})</label>)}
        </fieldset>
        <div className="integration-card-actions"><Button type="button" disabled={busy} onClick={()=>{if(data)loaded(data);setEditing(false);}}>Cancel</Button><Button type="submit" variant="primary">{busy ? 'Saving…' : 'Save approval settings'}</Button></div>
      </fieldset>
    </form> : !error ? <p role="status">Loading approval settings…</p> : null}
    </article>}
    {error ? <p className="integration-card-error" role="alert">{error} <Button disabled={busy} onClick={() => setReload(value => value + 1)}>Reload settings</Button></p> : null}
    {message ? <p className="integration-notice success" role="status">{message}</p> : null}
  </section>;
}
