import { pathToFileURL } from "node:url";
import { getPool, closePool } from "../../src/server/db/pool.js";

const COMPANY_ID = "00000000-0000-0000-0000-000000000001";
const DEFAULT_LOCATION_NAME = "Chino Yard";
const LEGACY_COORDINATE = /^A(\d+)-B(\d+)-S(\d+)$/;

function assertLocalDatabase(env = process.env) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const url = new URL(env.DATABASE_URL.replace("postgresql+asyncpg:", "postgresql:"));
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname) || env.NODE_ENV === "production") {
    throw new Error("Position hierarchy repair only runs against the local development database.");
  }
}

export function canonicalChinoCoordinate(raw) {
  const match = String(raw || "").match(LEGACY_COORDINATE);
  if (!match) return null;
  const [, aisleNo, binNo, shelfNo] = match;
  const aisleCode = `A${aisleNo}`;
  const shelfCode = `${aisleCode}-S${shelfNo}`;
  return {
    aisleCode,
    shelfCode,
    binCode: `${shelfCode}-B${binNo}`,
    shelfName: `Shelf ${shelfNo}`,
    binName: `Bin ${binNo}`,
  };
}

async function scalar(client, sql, values) {
  return Number((await client.query(sql, values)).rows[0]?.value || 0);
}

export async function repairChinoPositionHierarchy({ locationName = DEFAULT_LOCATION_NAME } = {}) {
  assertLocalDatabase();
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`inventory-position-hierarchy:${COMPANY_ID}:${locationName}`]);
    const location = (await client.query(
      "select id from locations where company_id=$1 and active=true and lower(name)=lower($2) limit 1",
      [COMPANY_ID, locationName],
    )).rows[0];
    if (!location) throw new Error(`Inventory location '${locationName}' is missing.`);
    const actor = (await client.query(
      `select profile.id from user_profiles profile
       join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$1
       where profile.active=true and profile.deleted_at is null and membership.active=true and membership.role in ('admin','office')
       order by case membership.role when 'admin' then 0 else 1 end,profile.created_at limit 1`,
      [COMPANY_ID],
    )).rows[0];
    if (!actor) throw new Error("An active administrator or office user is required.");

    const legacyLeaves = (await client.query(
      `select id,parent_id,code from inventory_positions
       where company_id=$1 and location_id=$2 and code ~ '^A[0-9]+-B[0-9]+-S[0-9]+$'
       order by code for update`,
      [COMPANY_ID, location.id],
    )).rows;
    const before = {
      leaves: legacyLeaves.length,
      balanceRows: await scalar(client, "select count(*) value from inventory_position_balances where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
      balanceQuantity: await scalar(client, "select coalesce(sum(quantity),0) value from inventory_position_balances where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
      serializedUnits: await scalar(client, "select count(*) value from inventory_serialized_units where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
    };

    const legacyParentIds = new Set();
    let repaired = 0;
    for (const leaf of legacyLeaves) {
      const coordinate = canonicalChinoCoordinate(leaf.code);
      const aisle = (await client.query(
        "select id from inventory_positions where company_id=$1 and location_id=$2 and lower(code)=lower($3) limit 1",
        [COMPANY_ID, location.id, coordinate.aisleCode],
      )).rows[0];
      if (!aisle) throw new Error(`Aisle ${coordinate.aisleCode} is missing for ${leaf.code}.`);
      const shelf = (await client.query(
        `insert into inventory_positions(company_id,location_id,parent_id,code,name,kind,usage,can_store,is_pickable,created_by)
         values($1,$2,$3,$4,$5,'shelf',null,false,false,$6)
         on conflict(company_id,location_id,(lower(code))) do update set
           parent_id=excluded.parent_id,name=excluded.name,kind='shelf',usage=null,can_store=false,is_pickable=false,is_active=true,updated_at=now()
         returning id`,
        [COMPANY_ID, location.id, aisle.id, coordinate.shelfCode, coordinate.shelfName, actor.id],
      )).rows[0];
      const conflict = (await client.query(
        "select id from inventory_positions where company_id=$1 and location_id=$2 and lower(code)=lower($3) and id<>$4 limit 1",
        [COMPANY_ID, location.id, coordinate.binCode, leaf.id],
      )).rows[0];
      if (conflict) throw new Error(`Canonical bin ${coordinate.binCode} already exists with another identity.`);
      await client.query(
        `update inventory_positions set parent_id=$3,code=$4,name=$5,kind='bin',usage='storage',can_store=true,is_pickable=true,is_active=true,version=version+1,updated_at=now()
         where company_id=$1 and id=$2`,
        [COMPANY_ID, leaf.id, shelf.id, coordinate.binCode, coordinate.binName],
      );
      if (leaf.parent_id) legacyParentIds.add(leaf.parent_id);
      repaired += 1;
    }

    let removedLegacyGroups = 0;
    for (const parentId of legacyParentIds) {
      const result = await client.query(
        `delete from inventory_positions position where position.company_id=$1 and position.location_id=$2 and position.id=$3
         and position.code ~ '^A[0-9]+-B[0-9]+$'
         and not exists(select 1 from inventory_positions child where child.company_id=position.company_id and child.parent_id=position.id)
         and not exists(select 1 from inventory_position_balances balance where balance.company_id=position.company_id and balance.position_id=position.id)
         and not exists(select 1 from inventory_serialized_units unit where unit.company_id=position.company_id and unit.current_position_id=position.id)
         and not exists(select 1 from inventory_position_count_sessions session where session.company_id=position.company_id and session.position_id=position.id)
         and not exists(select 1 from inventory_position_admin_commands command where command.company_id=position.company_id and command.position_id=position.id)`,
        [COMPANY_ID, location.id, parentId],
      );
      removedLegacyGroups += result.rowCount;
    }

    const after = {
      balanceRows: await scalar(client, "select count(*) value from inventory_position_balances where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
      balanceQuantity: await scalar(client, "select coalesce(sum(quantity),0) value from inventory_position_balances where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
      serializedUnits: await scalar(client, "select count(*) value from inventory_serialized_units where company_id=$1 and location_id=$2", [COMPANY_ID, location.id]),
      remainingLegacyLeaves: await scalar(client, "select count(*) value from inventory_positions where company_id=$1 and location_id=$2 and code ~ '^A[0-9]+-B[0-9]+-S[0-9]+$'", [COMPANY_ID, location.id]),
    };
    if (after.balanceRows !== before.balanceRows || after.balanceQuantity !== before.balanceQuantity || after.serializedUnits !== before.serializedUnits || after.remainingLegacyLeaves !== 0) {
      throw new Error(`Hierarchy repair did not reconcile: ${JSON.stringify({ before, after })}`);
    }
    await client.query("commit");
    return { locationId: location.id, repaired, removedLegacyGroups, before, after };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

const isDirect = process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href;
if (isDirect) {
  repairChinoPositionHierarchy()
    .then((result) => console.log(JSON.stringify(result, null, 2)))
    .finally(() => closePool());
}
