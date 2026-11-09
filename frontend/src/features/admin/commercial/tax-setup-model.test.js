import test from 'node:test';
import assert from 'node:assert/strict';
import { eligibleTaxProfiles, taxCreationErrors, profileForScope } from './tax-setup-model.js';

test('offers only current active versions for the selected company and currency', () => {
  const profiles = [{ companyId: 'a', current: { id: 'v1', state: 'active', currency: 'USD' } }, { companyId: 'b', current: { id: 'v2', state: 'active', currency: 'USD' } }, { companyId: 'a', archived: true, current: { id: 'v3', state: 'active', currency: 'USD' } }, { companyId: 'a', current: { id: 'v4', state: 'archived', currency: 'USD' } }, { companyId: 'a', current: { id: 'v5', state: 'active', currency: 'CAD' } }];
  assert.deepEqual(eligibleTaxProfiles(profiles, 'a', 'USD').map(p => p.current.id), ['v1']);
});
test('requires explicit valid rates and complete components', () => {
  const draft = { name: 'Sales tax', jurisdiction: 'CA', reason: 'Initial setup', components: [{ name: 'State', rate: '', compound: false }] };
  assert.ok(taxCreationErrors(draft).length);
  assert.ok(taxCreationErrors({ ...draft, components: [{ name: 'State', rate: '100.01' }] }).length);
  assert.deepEqual(taxCreationErrors({ ...draft, components: [{ name: 'State', rate: '0', compound: false }, { name: 'Local', rate: '2.125', compound: true }] }), []);
});
test('fallback profile starts a new scope without losing its fields', () => {
  const profile = { profileId: 'company-profile', locationId: null, version: 4, shopIdentity: { legalName: 'Shop' } };
  assert.deepEqual(profileForScope(profile, 'location'), { ...profile, profileId: null, profile_id: null, version: 0 });
  assert.equal(profileForScope(profile, '').profileId, 'company-profile');
});

test('reuses a creation key only for an unchanged request', async () => {
  const { taxRequestKey } = await import('./tax-setup-model.js');
  let count = 0;
  const next = () => `key-${++count}`;
  const first = taxRequestKey(null, { companyId: 'a', name: 'Tax' }, next);
  assert.equal(taxRequestKey(first, { companyId: 'a', name: 'Tax' }, next).key, first.key);
  assert.notEqual(taxRequestKey(first, { companyId: 'a', name: 'New tax' }, next).key, first.key);
  assert.notEqual(taxRequestKey(first, { companyId: 'b', name: 'Tax' }, next).key, first.key);
});
