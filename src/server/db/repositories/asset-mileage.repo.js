import { createHash } from "node:crypto";
import { getPool, query } from "../pool.js";
import { mileageState, normalizeMileage, validateManualMileage, validateMileageReason } from "../../../../shared/asset-mileage.js";

function requestHash(value) {
  return createHash("sha256").update(JSON.stringify(value)).digest("hex");
}

function publicMileage(row, now = new Date()) {
  const miles = row?.canonical_miles == null ? null : Number(row.canonical_miles);
  const providerMiles = row?.provider_miles == null ? null : Number(row.provider_miles);
  const observedAt = row?.canonical_observed_at ? new Date(row.canonical_observed_at).toISOString() : null;
  return {
    miles,
    observedAt,
    source: row?.canonical_source || null,
    version: Number(row?.version || 0),
    state: mileageState({ miles, observedAt, conflict: Boolean(row?.conflict), now }),
    providerMiles,
    providerObservedAt: row?.provider_observed_at ? new Date(row.provider_observed_at).toISOString() : null,
    providerSource: row?.provider_source || null,
  };
}

const READ_SQL = `select state.version,state.conflict,
  canonical.miles canonical_miles,canonical.observed_at canonical_observed_at,canonical.source canonical_source,
  provider.miles provider_miles,provider.observed_at provider_observed_at,provider.source provider_source
from assets asset
left join asset_mileage_state state on state.company_id=asset.company_id and state.asset_id=asset.id
left join asset_mileage_observations canonical on canonical.id=state.canonical_observation_id
left join asset_mileage_observations provider on provider.id=state.provider_observation_id
where asset.id=$1 and asset.company_id=$2`;

export async function readAssetMileage({ assetId, companyId }, dependencies = {}) {
  const runQuery = dependencies.client?.query?.bind(dependencies.client) || dependencies.query || query;
  const result = await runQuery(READ_SQL, [assetId, companyId]);
  return publicMileage(result.rows[0], dependencies.now?.() || new Date());
}

async function transaction(dependencies, callback) {
  const owned = !dependencies.client;
  const client = dependencies.client || await (dependencies.pool || getPool()).connect();
  try {
    await client.query("begin");
    const value = await callback(client);
    await client.query("commit");
    return value;
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    if (owned) client.release();
  }
}

async function readWithClient(client, assetId, companyId, now) {
  const result = await client.query(READ_SQL, [assetId, companyId]);
  return publicMileage(result.rows[0], now);
}

export async function recordManualAssetMileage(input, dependencies = {}) {
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw Object.assign(new Error("A valid mileage version is required."), { code: "ASSET_MILEAGE_VERSION_INVALID" });
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw Object.assign(new Error("A valid idempotency key is required."), { code: "ASSET_MILEAGE_IDEMPOTENCY_INVALID" });
  const now = dependencies.now?.() || new Date();
  const hashInput = { assetId: input.assetId, companyId: input.companyId, expectedVersion, miles: input.miles, observedAt: input.observedAt, reason: String(input.reason || "").trim(), inspectionId: input.inspectionId || null, workorderId: input.workorderId || null };
  const hash = requestHash(hashInput);

  return transaction(dependencies, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`asset-mileage:${input.companyId}:${input.actorId}:${idempotencyKey}`]);
    const replay = await client.query(`select command.request_sha256,observation.id observation_id,observation.provider_payload
      from asset_mileage_commands command join asset_mileage_observations observation on observation.id=command.observation_id
      where command.company_id=$1 and command.actor_id=$2 and command.idempotency_key=$3`, [input.companyId, input.actorId, idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== hash) throw Object.assign(new Error("That idempotency key was already used for different mileage."), { code: "ASSET_MILEAGE_IDEMPOTENCY_CONFLICT" });
      return { ...(await readWithClient(client, input.assetId, input.companyId, now)), observationId: replay.rows[0].observation_id, replayed: true, historical: replay.rows[0].provider_payload?.historical === true };
    }
    const asset = await client.query("select id from assets where id=$1 and company_id=$2 for update", [input.assetId, input.companyId]);
    if (!asset.rows[0]) throw Object.assign(new Error("Asset was not found."), { code: "ASSET_MILEAGE_ASSET_NOT_FOUND" });
    await client.query(`insert into asset_mileage_state(company_id,asset_id) values($1,$2) on conflict(company_id,asset_id) do nothing`, [input.companyId, input.assetId]);
    const currentResult = await client.query(`select state.version,state.provider_observation_id,canonical.miles canonical_miles,canonical.observed_at canonical_observed_at,
      provider.miles provider_miles,provider.observed_at provider_observed_at
      from asset_mileage_state state
      left join asset_mileage_observations canonical on canonical.id=state.canonical_observation_id
      left join asset_mileage_observations provider on provider.id=state.provider_observation_id
      where state.company_id=$1 and state.asset_id=$2 for update of state`, [input.companyId, input.assetId]);
    const current = currentResult.rows[0];
    if (Number(current.version) !== expectedVersion) throw Object.assign(new Error("Mileage changed since it was loaded."), { code: "ASSET_MILEAGE_STALE", currentVersion: Number(current.version) });
    const valid = validateManualMileage({ ...input, currentMiles: current.canonical_miles, now });
    const historical = Boolean(current.canonical_observed_at && new Date(valid.observedAt) < new Date(current.canonical_observed_at));
    const inserted = await client.query(`insert into asset_mileage_observations
      (company_id,asset_id,source,miles,observed_at,prior_miles,actor_id,reason,inspection_id,workorder_id,provider_payload)
      values($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id`,
      [input.companyId, input.assetId, valid.miles, valid.observedAt, current.canonical_miles, input.actorId, valid.reason, input.inspectionId || null, input.workorderId || null, JSON.stringify({ historical })]);
    const observationId = inserted.rows[0].id;
    const conflict = current.provider_miles != null && new Date(current.provider_observed_at) > new Date(valid.observedAt) && Number(current.provider_miles) !== valid.miles;
    if (historical) {
      await client.query(`update asset_mileage_state set version=version+1,updated_at=now() where company_id=$1 and asset_id=$2`, [input.companyId, input.assetId]);
    } else {
    await client.query(`update asset_mileage_state set canonical_observation_id=$3,version=version+1,conflict=$4,updated_at=now() where company_id=$1 and asset_id=$2`, [input.companyId, input.assetId, observationId, conflict]);
    await client.query(`update assets set last_odometer_miles=$3,last_odometer_meters=$3*1609.344,updated_at=now() where id=$1 and company_id=$2`, [input.assetId, input.companyId, valid.miles]);
    }
    await client.query(`insert into asset_mileage_commands(company_id,asset_id,actor_id,idempotency_key,request_sha256,observation_id) values($1,$2,$3,$4,$5,$6)`, [input.companyId, input.assetId, input.actorId, idempotencyKey, hash, observationId]);
    return { ...(await readWithClient(client, input.assetId, input.companyId, now)), observationId, replayed: false, historical };
  });
}

export async function recordProviderAssetMileage(input, dependencies = {}) {
  const miles = normalizeMileage(input.miles);
  if (input.observedAt === null || input.observedAt === undefined || typeof input.observedAt === "boolean" || (typeof input.observedAt === "string" && input.observedAt.trim() === "")) return null;
  const observed = new Date(input.observedAt);
  const now = dependencies.now?.() || new Date();
  if (!['samsara_obd','samsara_gps'].includes(input.source) || miles == null || !Number.isFinite(observed.getTime()) || observed.getTime() > now.getTime() + 5 * 60 * 1000) return null;
  return transaction(dependencies, async (client) => {
    // Keep the same asset-then-state lock order as manual corrections.
    await client.query("select id from assets where id=$1 and company_id=$2 for update", [input.assetId, input.companyId]);
    await client.query(`insert into asset_mileage_state(company_id,asset_id) values($1,$2) on conflict(company_id,asset_id) do nothing`, [input.companyId, input.assetId]);
    const stateResult = await client.query(`select state.version,state.provider_observation_id,canonical.source canonical_source,canonical.miles canonical_miles,canonical.observed_at canonical_observed_at,
      provider.observed_at provider_observed_at
      from asset_mileage_state state left join asset_mileage_observations canonical on canonical.id=state.canonical_observation_id
      left join asset_mileage_observations provider on provider.id=state.provider_observation_id
      where state.company_id=$1 and state.asset_id=$2 for update of state`, [input.companyId, input.assetId]);
    const state = stateResult.rows[0];
    if (state.provider_observed_at && observed <= new Date(state.provider_observed_at)) return readWithClient(client, input.assetId, input.companyId, now);
    const inserted = await client.query(`insert into asset_mileage_observations(company_id,asset_id,source,miles,observed_at,provider_payload)
      values($1,$2,$3,$4,$5,$6::jsonb) on conflict do nothing returning id`, [input.companyId, input.assetId, input.source, miles, observed.toISOString(), JSON.stringify(input.providerPayload || {})]);
    const observation = inserted.rows[0] || (await client.query(`select id from asset_mileage_observations where company_id=$1 and asset_id=$2 and source=$3 and observed_at=$4 and miles=$5`, [input.companyId, input.assetId, input.source, observed.toISOString(), miles])).rows[0];
    const manual = state.canonical_source === 'manual';
    const newerThanCanonical = !state.canonical_observed_at || observed > new Date(state.canonical_observed_at);
    const providerRegression = !manual && newerThanCanonical && state.canonical_miles != null && miles + 100 < Number(state.canonical_miles);
    const preserveCanonical = manual || providerRegression;
    const conflict = (manual && newerThanCanonical && miles !== Number(state.canonical_miles)) || providerRegression;
    await client.query(`update asset_mileage_state set provider_observation_id=$3,canonical_observation_id=case when $4 then canonical_observation_id else $3 end,
      conflict=$5,version=version+1,updated_at=now() where company_id=$1 and asset_id=$2`, [input.companyId, input.assetId, observation.id, preserveCanonical, conflict]);
    if (!preserveCanonical) await client.query(`update assets set last_odometer_miles=$3,last_odometer_meters=$3*1609.344,updated_at=now() where id=$1 and company_id=$2`, [input.assetId, input.companyId, miles]);
    return readWithClient(client, input.assetId, input.companyId, now);
  });
}

export async function acceptProviderAssetMileage(input, dependencies = {}) {
  const expectedVersion = Number(input.expectedVersion);
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) throw Object.assign(new Error("A valid mileage version is required."), { code: "ASSET_MILEAGE_VERSION_INVALID" });
  const idempotencyKey = String(input.idempotencyKey || "").trim();
  if (idempotencyKey.length < 8 || idempotencyKey.length > 120) throw Object.assign(new Error("A valid idempotency key is required."), { code: "ASSET_MILEAGE_IDEMPOTENCY_INVALID" });
  const reason = validateMileageReason(input.reason);
  const now = dependencies.now?.() || new Date();
  const hash = requestHash({ action: "accept_provider", assetId: input.assetId, companyId: input.companyId, expectedVersion, reason, inspectionId: input.inspectionId || null, workorderId: input.workorderId || null });
  return transaction(dependencies, async (client) => {
    await client.query("select pg_advisory_xact_lock(hashtextextended($1,0))", [`asset-mileage:${input.companyId}:${input.actorId}:${idempotencyKey}`]);
    const replay = await client.query(`select command.request_sha256,command.observation_id
      from asset_mileage_commands command where command.company_id=$1 and command.actor_id=$2 and command.idempotency_key=$3`, [input.companyId, input.actorId, idempotencyKey]);
    if (replay.rows[0]) {
      if (replay.rows[0].request_sha256 !== hash) throw Object.assign(new Error("That idempotency key was already used for different mileage."), { code: "ASSET_MILEAGE_IDEMPOTENCY_CONFLICT" });
      return { ...(await readWithClient(client, input.assetId, input.companyId, now)), observationId: replay.rows[0].observation_id, replayed: true };
    }
    const asset = await client.query("select id from assets where id=$1 and company_id=$2 for update", [input.assetId, input.companyId]);
    if (!asset.rows[0]) throw Object.assign(new Error("Asset was not found."), { code: "ASSET_MILEAGE_ASSET_NOT_FOUND" });
    const currentResult = await client.query(`select state.version,state.provider_observation_id,canonical.miles canonical_miles,
      provider.miles provider_miles,provider.observed_at provider_observed_at,provider.source provider_source
      from asset_mileage_state state
      left join asset_mileage_observations canonical on canonical.id=state.canonical_observation_id
      left join asset_mileage_observations provider on provider.id=state.provider_observation_id
      where state.company_id=$1 and state.asset_id=$2 for update of state`, [input.companyId, input.assetId]);
    const current = currentResult.rows[0];
    if (!current) throw Object.assign(new Error("Mileage has not been recorded for this asset."), { code: "ASSET_MILEAGE_UNKNOWN" });
    if (Number(current.version) !== expectedVersion) throw Object.assign(new Error("Mileage changed since it was loaded."), { code: "ASSET_MILEAGE_STALE", currentVersion: Number(current.version) });
    if (!current.provider_observation_id || current.provider_miles == null || !current.provider_observed_at) throw Object.assign(new Error("No provider mileage is available to accept."), { code: "ASSET_MILEAGE_PROVIDER_UNKNOWN" });
    const evidence = await client.query(`insert into asset_mileage_observations
      (company_id,asset_id,source,miles,observed_at,prior_miles,actor_id,reason,inspection_id,workorder_id,provider_payload)
      values($1,$2,'manual',$3,$4,$5,$6,$7,$8,$9,$10::jsonb) returning id`, [input.companyId, input.assetId, current.provider_miles,
      current.provider_observed_at, current.canonical_miles, input.actorId, reason, input.inspectionId || null, input.workorderId || null,
      JSON.stringify({ action: "accept_provider", acceptedObservationId: current.provider_observation_id, providerSource: current.provider_source })]);
    const observationId = evidence.rows[0].id;
    await client.query(`update asset_mileage_state set canonical_observation_id=$3,conflict=false,version=version+1,updated_at=now() where company_id=$1 and asset_id=$2`, [input.companyId, input.assetId, current.provider_observation_id]);
    await client.query(`update assets set last_odometer_miles=$3,last_odometer_meters=$3*1609.344,updated_at=now() where id=$1 and company_id=$2`, [input.assetId, input.companyId, Number(current.provider_miles)]);
    await client.query(`insert into asset_mileage_commands(company_id,asset_id,actor_id,idempotency_key,request_sha256,observation_id) values($1,$2,$3,$4,$5,$6)`, [input.companyId, input.assetId, input.actorId, idempotencyKey, hash, observationId]);
    return { ...(await readWithClient(client, input.assetId, input.companyId, now)), observationId, replayed: false };
  });
}
