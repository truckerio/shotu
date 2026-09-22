import { getPool, query } from "../pool.js";

function publicVersion(row) {
  if (!row?.version_id) return null;
  return {
    id: row.version_id,
    profileId: row.profile_id,
    version: Number(row.version),
    name: row.name,
    currency: row.currency,
    jurisdiction: row.jurisdiction,
    components: Array.isArray(row.components) ? row.components : [],
    state: row.state,
    reason: row.reason,
    effectiveAt: row.effective_at,
    createdAt: row.version_created_at,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name || "" } : null,
  };
}

function groupProfiles(rows) {
  const profiles = new Map();
  for (const row of rows) {
    let profile = profiles.get(row.profile_id);
    if (!profile) {
      profile = { id: row.profile_id, companyId: row.company_id, archived: row.current_state === "archived", currentVersion: Number(row.current_version), current: null, versions: [] };
      profiles.set(row.profile_id, profile);
    }
    const version = publicVersion(row);
    profile.versions.push(version);
    if (row.version_id === row.current_version_id) profile.current = version;
  }
  return [...profiles.values()];
}

const PROFILE_SELECT = `select profile.id as profile_id, profile.company_id, profile.current_version_id,
  current.version as current_version, current.state as current_state,
  version.id as version_id, version.version, version.name, version.currency, version.jurisdiction,
  version.components, version.state, version.reason, version.effective_at,
  version.created_at as version_created_at, version.created_by, actor.display_name as created_by_name
 from inventory_tax_profiles profile
 join inventory_tax_profile_versions current
   on current.company_id=profile.company_id and current.id=profile.current_version_id
 join inventory_tax_profile_versions version
   on version.company_id=profile.company_id and version.profile_id=profile.id
 left join user_profiles actor on actor.id=version.created_by`;

export async function listInventoryTaxProfilesRepo({ companyId, includeArchived = false }) {
  const result = await query(`${PROFILE_SELECT}
    where profile.company_id=$1 and ($2::boolean or current.state='active')
    order by current.name, profile.id, version.version desc`, [companyId, includeArchived]);
  return groupProfiles(result.rows);
}

export async function findInventoryTaxProfileCompany(profileId, companyIds) {
  const result = await query("select company_id from inventory_tax_profiles where id=$1 and company_id=any($2::uuid[]) limit 1", [profileId, companyIds]);
  return result.rows[0]?.company_id || null;
}

async function loadProfile(db, companyId, profileId) {
  const result = await db.query(`${PROFILE_SELECT}
    where profile.company_id=$1 and profile.id=$2
    order by version.version desc`, [companyId, profileId]);
  return groupProfiles(result.rows)[0] || null;
}

export async function readInventoryTaxProfileVersion({ companyIds, taxProfileVersionId, requireCurrentActive = false }) {
  const result = await query(`select version.id as version_id, version.profile_id, version.version, version.name,
      version.currency, version.jurisdiction, version.components, version.state, version.reason,
      version.effective_at, version.created_at as version_created_at, version.created_by,
      actor.display_name as created_by_name
    from inventory_tax_profile_versions version
    join inventory_tax_profiles profile
      on profile.company_id=version.company_id and profile.id=version.profile_id
    left join user_profiles actor on actor.id=version.created_by
    where version.company_id=any($1::uuid[]) and version.id=$2
      and (not $3::boolean or (profile.current_version_id=version.id and version.state='active'))
    limit 1`, [companyIds, taxProfileVersionId, requireCurrentActive]);
  return publicVersion(result.rows[0]);
}

async function replayForKey(db, companyId, actorId, idempotencyKey, requestHash) {
  const replay = await db.query(`select profile_id, request_hash from inventory_tax_profile_versions
    where company_id=$1 and created_by=$2 and idempotency_key=$3 limit 1`, [companyId, actorId, idempotencyKey]);
  if (!replay.rows[0]) return null;
  if (replay.rows[0].request_hash !== requestHash) return { kind: "idempotency_conflict" };
  return { kind: "saved", profile: await loadProfile(db, companyId, replay.rows[0].profile_id), replayed: true };
}

async function transactMutation(input, mutate) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-tax-profile-command:${input.companyId}:${input.actorId}:${input.idempotencyKey}`]);
    const replay = await replayForKey(client, input.companyId, input.actorId, input.idempotencyKey, input.requestHash);
    if (replay) { await client.query("commit"); return replay; }
    const result = await mutate(client);
    await client.query("commit");
    return result;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") return { kind: "idempotency_conflict" };
    throw error;
  } finally { client.release(); }
}

export async function createInventoryTaxProfileRepo(input) {
  return transactMutation(input, async (client) => {
    const company = await client.query("select id from companies where id=$1 limit 1", [input.companyId]);
    if (!company.rows[0]) return { kind: "not_found" };
    const profile = await client.query("insert into inventory_tax_profiles(company_id) values($1) returning id", [input.companyId]);
    const profileId = profile.rows[0].id;
    const version = await client.query(`insert into inventory_tax_profile_versions
      (company_id,profile_id,version,name,currency,jurisdiction,components,state,reason,created_by,idempotency_key,request_hash)
      values($1,$2,1,$3,$4,$5,$6::jsonb,'active',$7,$8,$9,$10) returning id`,
    [input.companyId, profileId, input.name, input.currency, input.jurisdiction, JSON.stringify(input.components), input.reason, input.actorId, input.idempotencyKey, input.requestHash]);
    await client.query("update inventory_tax_profiles set current_version_id=$3 where company_id=$1 and id=$2", [input.companyId, profileId, version.rows[0].id]);
    return { kind: "saved", profile: await loadProfile(client, input.companyId, profileId), replayed: false };
  });
}

async function appendProfileVersion(input, values) {
  return transactMutation(input, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-tax-profile:${input.companyId}:${input.profileId}`]);
    const current = await client.query(`select profile.current_version_id, version.*
      from inventory_tax_profiles profile
      join inventory_tax_profile_versions version
        on version.company_id=profile.company_id and version.id=profile.current_version_id
      where profile.company_id=$1 and profile.id=$2 for update of profile`, [input.companyId, input.profileId]);
    const row = current.rows[0];
    if (!row) return { kind: "not_found" };
    if (Number(row.version) !== input.expectedVersion) return { kind: "stale" };
    const next = { name: row.name, currency: row.currency, jurisdiction: row.jurisdiction, components: row.components, state: row.state, ...values(row) };
    const inserted = await client.query(`insert into inventory_tax_profile_versions
      (company_id,profile_id,version,name,currency,jurisdiction,components,state,previous_version_id,reason,created_by,idempotency_key,request_hash)
      values($1,$2,$3,$4,$5,$6,$7::jsonb,$8,$9,$10,$11,$12,$13) returning id`,
    [input.companyId, input.profileId, Number(row.version) + 1, next.name, next.currency, next.jurisdiction, JSON.stringify(next.components), next.state, row.id, input.reason, input.actorId, input.idempotencyKey, input.requestHash]);
    await client.query("update inventory_tax_profiles set current_version_id=$3 where company_id=$1 and id=$2", [input.companyId, input.profileId, inserted.rows[0].id]);
    return { kind: "saved", profile: await loadProfile(client, input.companyId, input.profileId), replayed: false };
  });
}

export function reviseInventoryTaxProfileRepo(input) {
  return appendProfileVersion(input, () => ({ name: input.name, currency: input.currency, jurisdiction: input.jurisdiction, components: input.components }));
}

export function setInventoryTaxProfileArchivedRepo(input) {
  return appendProfileVersion(input, () => ({ state: input.archived ? "archived" : "active" }));
}
