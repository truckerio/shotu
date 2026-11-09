import { useEffect, useRef, useState } from 'react';
import { Dropdown } from '../../../components/forms/Dropdown.jsx';
import { Button } from '../../../components/ui/Button.jsx';
import { Checkbox } from '../../../components/ui/Checkbox.jsx';
import { api } from '../../../lib/api.js';
import { eligibleTaxProfiles, taxCreationErrors, taxRequestKey } from './tax-setup-model.js';

const blankTax = () => ({ name: '', jurisdiction: '', reason: '', components: [{ name: '', rate: '', compound: false }] });
const key = () => globalThis.crypto?.randomUUID?.() || `tax-${Date.now()}-${Math.random()}`;

export function TaxProfileSetup({ companyId, currency, selectedId, onSelect, onAvailabilityChange, onBusyChange }) {
  const [load, setLoad] = useState({ scope: '', status: 'loading', profiles: [] });
  const [creating, setCreating] = useState(false);
  const [reload, setReload] = useState(0);
  const [saving, setSaving] = useState(false);
  const [draft, setDraft] = useState(blankTax);
  const [attempted, setAttempted] = useState(false);
  const [error, setError] = useState('');
  const scope = `${companyId}:${currency}`;
  const mounted = useRef(true);
  const pendingRequest = useRef(null);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  useEffect(() => {
    let active = true;
    setLoad({ scope, status: 'loading', profiles: [] });
    setCreating(false); setSaving(false); setDraft(blankTax()); setError(''); setAttempted(false);
    if (!companyId) return () => { active = false; };
    api(`/api/office/inventory/tax-profiles?${new URLSearchParams({ companyId })}`)
      .then(({ profiles }) => { if (active) setLoad({ scope, status: 'ready', profiles: Array.isArray(profiles) ? profiles : [] }); })
      .catch((reason) => { if (active) setLoad({ scope, status: 'error', profiles: [], error: reason.message || 'Tax profiles could not be loaded.' }); });
    return () => { active = false; };
  }, [companyId, currency, reload]);
  const ready = load.scope === scope && load.status === 'ready';
  const profiles = ready ? eligibleTaxProfiles(load.profiles, companyId, currency) : [];
  const selected = profiles.some((profile) => profile.current.id === selectedId);
  useEffect(() => { onAvailabilityChange(ready && selected && !creating && !saving, selectedId); }, [ready, selected, selectedId, creating, saving, onAvailabilityChange]);
  const errors = taxCreationErrors(draft);
  const update = (field, value) => { pendingRequest.current = null; setDraft((current) => ({ ...current, [field]: value })); };
  const updateComponent = (index, field, value) => { pendingRequest.current = null; setDraft((current) => ({ ...current, components: current.components.map((component, i) => i === index ? { ...component, [field]: value } : component) })); };
  async function save() {
    setAttempted(true);
    if (errors.length || saving || !ready || !/^[A-Z]{3}$/.test(currency)) return;
    onBusyChange(true); setSaving(true); setError('');
    const requestScope = scope;
    try {
      const payload = { companyId, currency, name: draft.name.trim(), jurisdiction: draft.jurisdiction.trim(), reason: draft.reason.trim(), components: draft.components.map(({ name, rate, compound }) => ({ name: name.trim(), rate: rate.trim(), compound })) };
      pendingRequest.current = taxRequestKey(pendingRequest.current, payload, key);
      const result = await api('/api/office/inventory/tax-profiles', { method: 'POST', body: JSON.stringify({ ...payload, idempotencyKey: pendingRequest.current.key }) });
      // The keyed component is unmounted on a scope change, preventing stale responses from affecting the new scope.
      if (!mounted.current) return;
      const profile = result.profile;
      if (!eligibleTaxProfiles([profile], companyId, currency).length) throw new Error('The created tax profile is unavailable for this company and currency.');
      setLoad((current) => current.scope === requestScope ? { ...current, profiles: [...current.profiles, profile] } : current);
      pendingRequest.current = null; onSelect(profile.current.id); setCreating(false); setDraft(blankTax()); setAttempted(false);
    } catch (reason) { if (mounted.current) setError(reason.message || 'Tax profile could not be created.'); }
    finally { if (mounted.current) { setSaving(false); onBusyChange(false); } }
  }
  return <>
    <label>Tax profile<Dropdown aria-label="Tax profile" value={selected ? selectedId : ''} disabled={!ready || saving} onChange={(event) => onSelect(event.target.value)}><option value="">Select an active {currency} tax profile</option>{profiles.map((profile) => <option key={profile.current.id} value={profile.current.id}>{profile.current.name} · {profile.current.jurisdiction}</option>)}</Dropdown></label>
    {!ready ? <p role={load.status === 'error' && load.scope === scope ? 'alert' : 'status'}>{load.scope === scope && load.status === 'error' ? load.error : 'Loading tax profiles…'}</p> : !profiles.length ? <p>No active tax profiles are available for {currency}. Create one to continue.</p> : selectedId && !selected ? <p role="status">The saved tax profile is unavailable for this company and currency. Select a current active profile.</p> : null}
    {load.scope === scope && load.status === 'error' ? <Button type="button" onClick={() => setReload((value) => value + 1)}>Retry loading tax profiles</Button> : null}
    {!/^[A-Z]{3}$/.test(currency) ? <p role="alert">Enter a three-letter currency in advanced pricing settings.</p> : null}
    {ready && !creating ? <Button type="button" onClick={() => { onAvailabilityChange(false, selectedId); setCreating(true); }}>Create tax profile</Button> : null}
    {creating ? <section aria-label="New tax profile" className="commercial-tax-creation">
      <h3>New tax profile</h3><p>Currency: {currency}</p>
      <fieldset disabled={saving} className="commercial-tax-fields"><legend>Tax profile details</legend>
      <label>Tax profile name<input value={draft.name} maxLength={120} onChange={(event) => update('name', event.target.value)} /></label>
      <label>Jurisdiction<input value={draft.jurisdiction} maxLength={160} onChange={(event) => update('jurisdiction', event.target.value)} /></label>
      {draft.components.map((component, index) => <fieldset key={index}><legend>Tax component {index + 1}</legend>
        <label>Tax name {index + 1}<input value={component.name} maxLength={80} onChange={(event) => updateComponent(index, 'name', event.target.value)} /></label>
        <label>Tax rate % {index + 1}<input inputMode="decimal" value={component.rate} onChange={(event) => updateComponent(index, 'rate', event.target.value)} /></label>
        <label className="commercial-tax-compound"><Checkbox checked={component.compound} disabled={saving} onChange={(event) => updateComponent(index, 'compound', event.target.checked)} /> <span>Compound on previous components</span></label>
        {draft.components.length > 1 ? <Button type="button" onClick={() => update('components', draft.components.filter((_, i) => i !== index))}>Remove component {index + 1}</Button> : null}
      </fieldset>)}
      {draft.components.length < 5 ? <Button type="button" onClick={() => update('components', [...draft.components, { name: '', rate: '', compound: false }])}>Add tax component</Button> : null}
      <label>Tax change reason<textarea value={draft.reason} maxLength={500} onChange={(event) => update('reason', event.target.value)} /></label>
      </fieldset>
      {attempted && errors.length ? <ul role="alert">{errors.map((item) => <li key={item}>{item}</li>)}</ul> : null}
      {error ? <p role="alert">{error}</p> : null}
      <div className="commercial-tax-actions"><Button type="button" disabled={saving} onClick={save}>{saving ? 'Saving…' : 'Save tax profile'}</Button><Button type="button" disabled={saving} onClick={() => { pendingRequest.current = null; setCreating(false); setError(''); setAttempted(false); }}>Cancel tax profile</Button></div>
    </section> : null}
  </>;
}
