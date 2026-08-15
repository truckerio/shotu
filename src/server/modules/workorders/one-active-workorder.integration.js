import assert from "node:assert/strict";
import test from "node:test";
import { closePool, getPool } from "../../db/pool.js";

async function createAssetFixture(client) {
  const location = (await client.query(
    "select id, company_id from locations order by created_at, id limit 1",
  )).rows[0];
  assert.ok(location, "integration database needs one location");
  const asset = (await client.query(
    `insert into assets (company_id, provider, name, unit_no)
     values ($1, 'manual', 'One active workorder test asset', 'ONE-ACTIVE-TEST')
     returning id`,
    [location.company_id],
  )).rows[0];
  return { assetId: asset.id, companyId: location.company_id, locationId: location.id };
}

async function insertWorkorder(client, fixture, serial, status) {
  await client.query(
    `insert into operational_workorders (
       company_id, serial, asset_id, location_id, concern, status
     ) values ($1, $2, $3, $4, 'One active workorder integration check', $5)`,
    [fixture.companyId, serial, fixture.assetId, fixture.locationId, status],
  );
}

test("database permits asset history but rejects a second active workorder", async () => {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const fixture = await createAssetFixture(client);
    await insertWorkorder(client, fixture, "ONE-ACTIVE-OPEN", "open");
    await insertWorkorder(client, fixture, "ONE-ACTIVE-CLOSED", "closed");

    await assert.rejects(
      insertWorkorder(client, fixture, "ONE-ACTIVE-DUPLICATE", "accepted"),
      (error) => error?.code === "23505"
        && error?.constraint === "operational_workorders_one_active_per_asset_uidx",
    );
  } finally {
    await client.query("rollback").catch(() => {});
    client.release();
    await closePool();
  }
});
