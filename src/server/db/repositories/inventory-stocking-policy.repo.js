import { getPool } from "../pool.js";

function publicRule(row) {
  return {
    locationId: row.location_id,
    locationName: row.location_name,
    minimumAvailable: Number(row.minimum_available),
    targetQuantity: row.target_quantity === null ? null : Number(row.target_quantity),
    alertEnabled: row.alert_enabled,
    version: Number(row.version),
    available: Number(row.available || 0),
    lowStock: row.alert_id !== null,
    alertId: row.alert_id || null,
  };
}

export async function saveInventoryStockingPolicy({ companyIds, locationIds, isAdmin, catalogPartId, locationId, actorId, expectedVersion, minimumAvailable, targetQuantity, alertEnabled }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const scope = await client.query(
      `select part.company_id from parts_catalog part join locations location on location.company_id=part.company_id and location.id=$2
       where part.id=$1 and part.company_id=any($3::uuid[]) and ($5::boolean or location.id=any($4::uuid[])) for share`,
      [catalogPartId, locationId, companyIds, locationIds, isAdmin],
    );
    if (!scope.rows[0]) { await client.query("rollback"); return { kind: "not_found" }; }
    const companyId = scope.rows[0].company_id;
    const current = await client.query(
      `select version from inventory_stocking_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 for update`,
      [companyId, locationId, catalogPartId],
    );
    if (current.rows[0] && expectedVersion !== null && Number(current.rows[0].version) !== Number(expectedVersion)) { await client.query("rollback"); return { kind: "stale" }; }
    if (!current.rows[0] && expectedVersion !== null) { await client.query("rollback"); return { kind: "stale" }; }
    await client.query(
      `insert into inventory_stocking_policies(company_id,location_id,catalog_part_id,minimum_available,target_quantity,alert_enabled,created_by,updated_by)
       values($1,$2,$3,$4,$5,$6,$7,$7)
       on conflict(company_id,location_id,catalog_part_id) do update set minimum_available=excluded.minimum_available,target_quantity=excluded.target_quantity,alert_enabled=excluded.alert_enabled,updated_by=excluded.updated_by,version=inventory_stocking_policies.version+1,updated_at=now()`,
      [companyId, locationId, catalogPartId, minimumAvailable, targetQuantity, alertEnabled, actorId],
    );
    const balance = await client.query(
      `select * from inventory_items where company_id=$1 and location_id=$2 and catalog_part_id=$3 and source_provider='local' for update`,
      [companyId, locationId, catalogPartId],
    );
    const available = balance.rows[0]
      ? Math.max(Number(balance.rows[0].quantity_on_hand) - Number(balance.rows[0].quantity_reserved), 0)
      : 0;
    if (!alertEnabled || available > minimumAvailable) await client.query("update inventory_replenishment_alerts set current_available=$4,resolved_at=now(),updated_at=now() where company_id=$1 and location_id=$2 and catalog_part_id=$3 and resolved_at is null", [companyId, locationId, catalogPartId, available]);
    else await client.query(`insert into inventory_replenishment_alerts(company_id,location_id,catalog_part_id,policy_version,minimum_snapshot,target_snapshot,opening_available,current_available) select company_id,location_id,catalog_part_id,version,minimum_available,target_quantity,$4,$4 from inventory_stocking_policies where company_id=$1 and location_id=$2 and catalog_part_id=$3 on conflict(company_id,location_id,catalog_part_id) where resolved_at is null do update set current_available=excluded.current_available,updated_at=now()`, [companyId, locationId, catalogPartId, available]);
    await client.query("commit");
    return { kind: "saved" };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { client.release(); }
}
