import assert from "node:assert/strict";
import test from "node:test";
import { acceptProviderAssetMileage, readAssetMileage, recordManualAssetMileage, recordProviderAssetMileage } from "./asset-mileage.repo.js";

test("readAssetMileage exposes canonical and provider readings with conflict state", async () => {
  const result = await readAssetMileage({ assetId: "asset", companyId: "company" }, {
    now: () => new Date("2026-10-14T12:00:00.000Z"),
    query: async (_sql, values) => {
      assert.deepEqual(values, ["asset", "company"]);
      return { rows: [{ version: "3", conflict: true, canonical_miles: "249800.0", canonical_observed_at: "2026-10-14T10:00:00.000Z", canonical_source: "manual", provider_miles: "249900.0", provider_observed_at: "2026-10-14T11:00:00.000Z", provider_source: "samsara_obd" }] };
    },
  });
  assert.deepEqual(result, { miles: 249800, observedAt: "2026-10-14T10:00:00.000Z", source: "manual", version: 3, state: "conflict", providerMiles: 249900, providerObservedAt: "2026-10-14T11:00:00.000Z", providerSource: "samsara_obd" });
});

test("recordManualAssetMileage locks, appends evidence, updates compatibility fields, and commits", async () => {
  const statements = [];
  const client = { query: async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes("from asset_mileage_commands")) return { rows: [] };
    if (sql.startsWith("select id from assets")) return { rows: [{ id: "asset" }] };
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 2, canonical_miles: "249700.0", provider_miles: "249700.0", provider_observed_at: "2026-10-14T09:00:00.000Z" }] };
    if (sql.includes("insert into asset_mileage_observations")) return { rows: [{ id: "observation" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 3, conflict: false, canonical_miles: "249800.0", canonical_observed_at: "2026-10-14T10:00:00.000Z", canonical_source: "manual", provider_miles: "249700.0", provider_observed_at: "2026-10-14T09:00:00.000Z", provider_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await recordManualAssetMileage({ assetId: "asset", companyId: "company", actorId: "actor", expectedVersion: 2, idempotencyKey: "mileage-123", miles: 249800, observedAt: "2026-10-14T10:00:00.000Z", reason: "Dashboard verified", inspectionId: "inspection" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") });
  assert.equal(result.version, 3);
  assert.equal(result.replayed, false);
  assert.equal(statements[0].sql, "begin");
  assert.equal(statements.at(-1).sql, "commit");
  assert.ok(statements.some(({ sql }) => sql.includes("update assets set last_odometer_miles")));
  assert.ok(statements.some(({ sql }) => sql.includes("insert into asset_mileage_commands")));
});

test("recordManualAssetMileage rejects a stale version before writing an observation", async () => {
  const statements = [];
  const client = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("from asset_mileage_commands")) return { rows: [] };
    if (sql.startsWith("select id from assets")) return { rows: [{ id: "asset" }] };
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 4, canonical_miles: "100" }] };
    return { rows: [] };
  }};
  await assert.rejects(recordManualAssetMileage({ assetId: "asset", companyId: "company", actorId: "actor", expectedVersion: 3, idempotencyKey: "mileage-456", miles: 101, observedAt: "2026-10-14T10:00:00.000Z", reason: "Dashboard verified" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") }), { code: "ASSET_MILEAGE_STALE" });
  assert.equal(statements.at(-1), "rollback");
  assert.equal(statements.some((sql) => sql.includes("insert into asset_mileage_observations")), false);
});

test("recordProviderAssetMileage ignores an older provider reading without appending or regressing state", async () => {
  const statements = [];
  const client = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 2, provider_observation_id: "newer", canonical_source: "samsara_obd", canonical_miles: "200", canonical_observed_at: "2026-10-14T11:00:00.000Z", provider_observed_at: "2026-10-14T11:00:00.000Z" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 2, conflict: false, canonical_miles: "200", canonical_observed_at: "2026-10-14T11:00:00.000Z", canonical_source: "samsara_obd", provider_miles: "200", provider_observed_at: "2026-10-14T11:00:00.000Z", provider_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: 190, observedAt: "2026-10-14T10:00:00.000Z", source: "samsara_gps" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") });
  assert.equal(result.miles, 200);
  assert.equal(statements.some((sql) => sql.includes("insert into asset_mileage_observations")), false);
  assert.equal(statements.at(-1), "commit");
});

test("newer provider telemetry marks a manual reading conflicted without overwriting compatibility mileage", async () => {
  const statements = [];
  const client = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 3, provider_observation_id: "old", canonical_source: "manual", canonical_miles: "249800", canonical_observed_at: "2026-10-14T10:00:00.000Z", provider_observed_at: "2026-10-14T09:00:00.000Z" }] };
    if (sql.includes("insert into asset_mileage_observations")) return { rows: [{ id: "provider-new" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 4, conflict: true, canonical_miles: "249800", canonical_observed_at: "2026-10-14T10:00:00.000Z", canonical_source: "manual", provider_miles: "249900", provider_observed_at: "2026-10-14T11:00:00.000Z", provider_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: 249900, observedAt: "2026-10-14T11:00:00.000Z", source: "samsara_obd" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") });
  assert.equal(result.miles, 249800);
  assert.equal(result.providerMiles, 249900);
  assert.equal(result.version, 4);
  assert.equal(result.state, "conflict");
  assert.equal(statements.some((sql) => sql.includes("update assets set last_odometer_miles")), false);
});

test("provider readings reject missing values and times without opening a transaction", async () => {
  let queried = false;
  const client = { query: async () => { queried = true; return { rows: [] }; } };
  assert.equal(await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: null, observedAt: null, source: "samsara_obd" }, { client }), null);
  assert.equal(await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: "", observedAt: "", source: "samsara_gps" }, { client }), null);
  assert.equal(await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: 10, observedAt: false, source: "samsara_gps" }, { client }), null);
  assert.equal(queried, false);
});

test("a large backwards provider jump is exposed as conflict instead of replacing canonical mileage", async () => {
  const statements = [];
  const client = { query: async (sql) => {
    statements.push(sql);
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 2, provider_observation_id: "old", canonical_source: "samsara_obd", canonical_miles: "250000", canonical_observed_at: "2026-10-14T09:00:00.000Z", provider_observed_at: "2026-10-14T09:00:00.000Z" }] };
    if (sql.includes("insert into asset_mileage_observations")) return { rows: [{ id: "regression" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 3, conflict: true, canonical_miles: "250000", canonical_observed_at: "2026-10-14T09:00:00.000Z", canonical_source: "samsara_obd", provider_miles: "1200", provider_observed_at: "2026-10-14T10:00:00.000Z", provider_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await recordProviderAssetMileage({ assetId: "asset", companyId: "company", miles: 1200, observedAt: "2026-10-14T10:00:00.000Z", source: "samsara_obd" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") });
  assert.equal(result.miles, 250000);
  assert.equal(result.providerMiles, 1200);
  assert.equal(result.state, "conflict");
  assert.equal(statements.some((sql) => sql.includes("update assets set last_odometer_miles")), false);
});

test("acceptProviderAssetMileage audits the decision and resumes provider authority", async () => {
  const statements = [];
  const client = { query: async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes("from asset_mileage_commands")) return { rows: [] };
    if (sql.startsWith("select id from assets")) return { rows: [{ id: "asset" }] };
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 4, provider_observation_id: "provider-new", canonical_miles: "249800", provider_miles: "249900", provider_observed_at: "2026-10-14T11:00:00.000Z", provider_source: "samsara_obd" }] };
    if (sql.includes("insert into asset_mileage_observations")) return { rows: [{ id: "accept-evidence" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 5, conflict: false, canonical_miles: "249900", canonical_observed_at: "2026-10-14T11:00:00.000Z", canonical_source: "samsara_obd", provider_miles: "249900", provider_observed_at: "2026-10-14T11:00:00.000Z", provider_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await acceptProviderAssetMileage({ assetId: "asset", companyId: "company", actorId: "actor", expectedVersion: 4, idempotencyKey: "accept-provider-1", reason: "Dashboard confirms Samsara" }, { client, now: () => new Date("2026-10-14T12:00:00.000Z") });
  assert.equal(result.source, "samsara_obd");
  assert.equal(result.miles, 249900);
  assert.equal(result.version, 5);
  assert.equal(result.state, "fresh");
  assert.ok(statements.some(({ values }) => values.some((value) => typeof value === "string" && value.includes("acceptedObservationId"))));
  assert.ok(statements.some(({ sql }) => sql.includes("insert into asset_mileage_commands")));
  assert.equal(statements.at(-1).sql, "commit");
});

test("backdated manual evidence is audited without replacing current canonical mileage", async () => {
  const statements = [];
  const client = { query: async (sql, values = []) => {
    statements.push({ sql, values });
    if (sql.includes("from asset_mileage_commands")) return { rows: [] };
    if (sql.startsWith("select id from assets")) return { rows: [{ id: "asset" }] };
    if (sql.includes("select state.version,state.provider_observation_id")) return { rows: [{ version: 2, canonical_miles: "250000", canonical_observed_at: "2026-10-14T10:00:00Z", provider_miles: "250000", provider_observed_at: "2026-10-14T10:00:00Z" }] };
    if (sql.includes("insert into asset_mileage_observations")) return { rows: [{ id: "historical-observation" }] };
    if (sql.includes("select state.version,state.conflict")) return { rows: [{ version: 3, canonical_miles: "250000", canonical_observed_at: "2026-10-14T10:00:00Z", canonical_source: "samsara_obd" }] };
    return { rows: [] };
  }};
  const result = await recordManualAssetMileage({ assetId: "asset", companyId: "company", actorId: "actor", expectedVersion: 2, idempotencyKey: "historical-001", miles: 240000, observedAt: "2026-09-01T10:00:00Z", reason: "Correct historical dashboard entry" }, { client, now: () => new Date("2026-10-14T12:00:00Z") });
  assert.equal(result.historical, true);
  assert.equal(result.miles, 250000);
  assert.equal(result.source, "samsara_obd");
  assert.ok(statements.some(({ sql, values }) => sql.includes("insert into asset_mileage_observations") && JSON.parse(values[9]).historical));
  assert.ok(statements.some(({ sql }) => sql.includes("insert into asset_mileage_commands")));
  assert.ok(!statements.some(({ sql }) => sql.includes("set canonical_observation_id") || sql.startsWith("update assets")));
});
