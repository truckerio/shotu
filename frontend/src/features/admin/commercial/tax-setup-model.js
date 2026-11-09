export function eligibleTaxProfiles(profiles, companyId, currency) {
  return profiles.filter((profile) => profile.companyId === companyId && !profile.archived && profile.current?.state === 'active' && profile.current.currency === currency && profile.current.id);
}

export function taxCreationErrors(draft) {
  const errors = [];
  const validText = (value, min, max) => typeof value === 'string' && value.trim().length >= min && value.trim().length <= max;
  if (!validText(draft.name, 2, 120)) errors.push('Enter a tax profile name (2–120 characters).');
  if (!validText(draft.jurisdiction, 2, 160)) errors.push('Enter a jurisdiction (2–160 characters).');
  if (!validText(draft.reason, 2, 500)) errors.push('Enter a change reason (2–500 characters).');
  if (!Array.isArray(draft.components) || draft.components.length < 1 || draft.components.length > 5) errors.push('Add one to five tax components.');
  else draft.components.forEach((component, index) => {
    if (!validText(component.name, 2, 80)) errors.push(`Enter tax name ${index + 1} (2–80 characters).`);
    const rate = component.rate?.trim() || '';
    if (!/^(?:0|[1-9]\d?|100)(?:\.\d{1,4})?$/.test(rate) || (rate.startsWith('100.') && !/^100\.0{1,4}$/.test(rate))) errors.push(`Enter tax rate ${index + 1} from 0 to 100 with up to four decimal places.`);
  });
  return errors;
}

export function profileForScope(profile, locationId) {
  if (!profile || (profile.locationId || null) === (locationId || null)) return profile;
  return { ...profile, profileId: null, profile_id: null, version: 0 };
}

export function taxRequestKey(previous, payload, makeKey) {
  const signature = JSON.stringify(payload);
  return previous?.signature === signature ? previous : { signature, key: makeKey() };
}
