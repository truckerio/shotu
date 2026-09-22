import { createHash, randomUUID } from "node:crypto";
import { DEFAULT_COMPANY_ID } from "../company.js";
import { closePool, getPool } from "../pool.js";
import { assertLocalDemoSeed } from "./demo-seed-policy.js";
import { DEMO_PARTS, DEMO_SHOPS, DEMO_STOCK, DEMO_WORKORDERS, PREVIOUS_FIXTURE_KEY, REALISTIC_INVENTORY_DEMO_KEY, validateRealisticInventoryDemo } from "./realistic-inventory-demo.data.js";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const MARKER_PREFIX = `SHOP-TEST-${REALISTIC_INVENTORY_DEMO_KEY}`;
const hash = (value) => createHash("sha256").update(typeof value === "string" ? value : JSON.stringify(value)).digest("hex");

function assertLocalDatabase() {
  assertLocalDemoSeed(process.env, "Realistic inventory test seed");
  const url = new URL(process.env.DATABASE_URL);
  if (!["localhost", "127.0.0.1", "::1"].includes(url.hostname)) throw new Error("Realistic inventory test seed only runs against a localhost database.");
}

async function resolveContext(client) {
  const locationRows = await client.query(`select id,name from locations where company_id=$1 and active=true and name=any($2::text[])`, [COMPANY_ID, DEMO_SHOPS.map((shop) => shop.name)]);
  const locations = new Map(locationRows.rows.map((row) => [row.name, row.id]));
  if (locations.size !== DEMO_SHOPS.length) throw new Error("Run npm run db:seed-demo-users first; all four test yards are required.");
  const actor = await client.query(`select profile.id from user_profiles profile join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$1 and membership.active=true and membership.role in ('admin','office') where profile.active=true and profile.deleted_at is null order by case membership.role when 'admin' then 0 else 1 end,profile.created_at limit 1`, [COMPANY_ID]);
  if (!actor.rows[0]) throw new Error("An active local administrator is required.");
  const mechanics = await client.query(`select distinct on(location_membership.location_id) location_membership.location_id,profile.id from user_profiles profile join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$1 and membership.active=true and membership.role='mechanic' join user_location_memberships location_membership on location_membership.user_id=profile.id and location_membership.active=true where profile.active=true and profile.deleted_at is null order by location_membership.location_id,profile.display_name`, [COMPANY_ID]);
  if (!mechanics.rows[0]) throw new Error("At least one active local mechanic is required.");
  return { actorId: actor.rows[0].id, locations, mechanicByLocation: new Map(mechanics.rows.map((row) => [row.location_id, row.id])), fallbackMechanic: mechanics.rows[0].id };
}

async function prepareDemoCatalogPolicies(client) {
  for (const definition of DEMO_PARTS.filter((part) => part.uomCode)) {
    const result = await client.query(`update parts_catalog part
      set uom_code=$4,version=version+1,updated_at=now()
      where part.company_id=$1 and part.part_number=$2 and part.uom_code=$3
        and not exists(select 1 from inventory_items item where item.company_id=part.company_id and item.catalog_part_id=part.id)
        and not exists(select 1 from inventory_receipt_lines line where line.company_id=part.company_id and line.catalog_part_id=part.id)
        and not exists(select 1 from inventory_stock_movements movement where movement.company_id=part.company_id and movement.catalog_part_id=part.id)
        and not exists(select 1 from workorder_aggregate_part_usages usage where usage.company_id=part.company_id and usage.catalog_part_id=part.id)
        and not exists(select 1 from workorder_part_requests request join operational_workorders workorder on workorder.id=request.workorder_id where workorder.company_id=part.company_id and request.catalog_part_id=part.id)
      returning id`, [COMPANY_ID, definition.partNumber, "ea", definition.uomCode]);
    const current = await client.query(`select uom_code from parts_catalog where company_id=$1 and part_number=$2`, [COMPANY_ID, definition.partNumber]);
    if (!current.rows[0]) throw new Error(`Existing catalog part is missing: ${definition.partNumber}`);
    if (current.rows[0].uom_code !== definition.uomCode) throw new Error(`Catalog unit mismatch for ${definition.partNumber}: expected ${definition.uomCode}, found ${current.rows[0].uom_code}.`);
    if (result.rowCount) console.log(`Updated local demo catalog unit for ${definition.partNumber} to ${definition.uomCode}.`);
  }
}

async function resolveExistingParts(client) {
  const result = await client.query(`select id,part_number,normalized_part_number,description,manufacturer,category,uom_code,tracking_mode,version from parts_catalog where company_id=$1 and part_number=any($2::text[])`, [COMPANY_ID, DEMO_PARTS.map((part) => part.partNumber)]);
  const byNumber = new Map(result.rows.map((row) => [row.part_number, row]));
  const missing = DEMO_PARTS.filter((part) => !byNumber.has(part.partNumber)).map((part) => part.partNumber);
  if (missing.length) throw new Error(`Existing catalog parts are missing: ${missing.join(", ")}`);
  return new Map(DEMO_PARTS.map((definition) => {
    const row = byNumber.get(definition.partNumber);
    const tracking = row.tracking_mode || "quantity";
    if (tracking !== definition.tracking) throw new Error(`Catalog tracking mismatch for ${definition.partNumber}: expected ${definition.tracking}, found ${tracking}.`);
    if (definition.uomCode && row.uom_code !== definition.uomCode) throw new Error(`Catalog unit mismatch for ${definition.partNumber}: expected ${definition.uomCode}, found ${row.uom_code}.`);
    return [definition.key, { ...row, key: definition.key, cost: definition.cost, tracking }];
  }));
}

async function reconcileDemoLocationLabels(client, context) {
  for (const shop of DEMO_SHOPS) {
    const locationId = context.locations.get(shop.name);
    const positionIds = new Map();
    for (const position of shop.positions) {
      const knownCodes = [...new Set([position.code, position.legacyCode, ...(position.legacyCodes || [])].filter(Boolean))];
      const existing = await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and code=any($3::text[]) order by case when code=$4 then 0 else 1 end limit 1`, [COMPANY_ID, locationId, knownCodes, position.code]);
      const parentId = position.parent ? positionIds.get(position.parent) : null;
      let positionId = existing.rows[0]?.id;
      if (positionId) {
        await client.query(`update inventory_positions set parent_id=$3,code=$4,name=$5,kind=$6,usage=$7,can_store=$8,is_pickable=$8,updated_at=now() where company_id=$1 and id=$2`, [COMPANY_ID, positionId, parentId, position.code, position.name, position.kind, position.stores ? "storage" : null, Boolean(position.stores)]);
      } else {
        const inserted = await client.query(`insert into inventory_positions(company_id,location_id,parent_id,code,name,kind,usage,can_store,is_pickable,created_by) values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9) returning id`, [COMPANY_ID, locationId, parentId, position.code, position.name, position.kind, position.stores ? "storage" : null, Boolean(position.stores), context.actorId]);
        positionId = inserted.rows[0].id;
      }
      positionIds.set(position.key, positionId);
      await client.query(`update inventory_items set bin_location=$3,updated_at=now()
        where company_id=$1 and location_id=$2 and bin_location=any($4::text[]) and external_id like $5`, [COMPANY_ID, locationId, position.code, knownCodes, `${REALISTIC_INVENTORY_DEMO_KEY}:%`]);
    }
    if (shop.key === "chino") {
      await client.query(`update inventory_positions set name='Receiving area',updated_at=now() where company_id=$1 and location_id=$2 and system_key='receiving'`, [COMPANY_ID, locationId]);
      await client.query(`delete from inventory_positions position where position.company_id=$1 and position.location_id=$2 and position.code='FAST' and position.name='Fast-moving parts'
        and not exists(select 1 from inventory_positions child where child.parent_id=position.id)
        and not exists(select 1 from inventory_position_balances balance where balance.position_id=position.id)
        and not exists(select 1 from inventory_serialized_units unit where unit.current_position_id=position.id)`, [COMPANY_ID, locationId]);
    }
  }
}

async function removePreviousSyntheticFixture(client) {
  const workorders = await client.query(`select id from operational_workorders where company_id=$1 and form_data->'demoFixture'->>'key'=$2`, [COMPANY_ID, PREVIOUS_FIXTURE_KEY]);
  const workorderIds = workorders.rows.map((row) => row.id);
  const usages = workorderIds.length ? await client.query(`select id from workorder_aggregate_part_usages where company_id=$1 and workorder_id=any($2::uuid[])`, [COMPANY_ID, workorderIds]) : { rows: [] };
  const usageIds = usages.rows.map((row) => row.id);
  const receipts = await client.query(`select id from inventory_receipts where company_id=$1 and provider_marker like $2`, [COMPANY_ID, `DEMO-LIVE-${PREVIOUS_FIXTURE_KEY}-%`]);
  const receiptIds = receipts.rows.map((row) => row.id);
  const items = await client.query(`select id from inventory_items where company_id=$1 and external_id like $2`, [COMPANY_ID, `${PREVIOUS_FIXTURE_KEY}:%`]);
  const itemIds = items.rows.map((row) => row.id);
  if (usageIds.length) {
    await client.query(`delete from inventory_aggregate_usage_position_allocations where company_id=$1 and usage_id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
    await client.query(`delete from workorder_aggregate_part_usage_events where company_id=$1 and usage_id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
  }
  if (workorderIds.length || receiptIds.length || usageIds.length) await client.query(`delete from inventory_stock_movements where company_id=$1 and (workorder_id=any($2::uuid[]) or receipt_id=any($3::uuid[]) or aggregate_usage_id=any($4::uuid[]))`, [COMPANY_ID, workorderIds, receiptIds, usageIds]);
  if (usageIds.length) await client.query(`delete from workorder_aggregate_part_usages where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
  if (workorderIds.length) await client.query(`delete from operational_workorders where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, workorderIds]);
  if (receiptIds.length) {
    const units = await client.query(`select id from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    if (units.rows.length) await client.query(`delete from inventory_unit_events where company_id=$1 and unit_id=any($2::uuid[])`, [COMPANY_ID, units.rows.map((row) => row.id)]);
    await client.query(`delete from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
  }
  if (itemIds.length) {
    await client.query(`delete from inventory_position_balances where company_id=$1 and inventory_item_id=any($2::uuid[])`, [COMPANY_ID, itemIds]);
    await client.query(`delete from inventory_items where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, itemIds]);
  }
  if (receiptIds.length) {
    await client.query(`delete from local_inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from local_inventory_receipts where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from inventory_receipts where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
  }
  await client.query(`delete from inventory_positions where company_id=$1 and code like 'DEMO-%'` , [COMPANY_ID]);
  const synthetic = await client.query(`select id from parts_catalog where company_id=$1 and source_provider='demo' and external_id like $2`, [COMPANY_ID, `${PREVIOUS_FIXTURE_KEY}:%`]);
  if (synthetic.rows.length) await client.query(`delete from parts_catalog where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, synthetic.rows.map((row) => row.id)]);
  return { workorders: workorderIds.length, receipts: receiptIds.length, items: itemIds.length, parts: synthetic.rows.length };
}

async function removeCurrentFixture(client) {
  const workorders = await client.query(`select id from operational_workorders where company_id=$1 and form_data->'testFixture'->>'key'=$2`, [COMPANY_ID, REALISTIC_INVENTORY_DEMO_KEY]);
  const workorderIds = workorders.rows.map((row) => row.id);
  const usages = workorderIds.length ? await client.query(`select id from workorder_aggregate_part_usages where company_id=$1 and workorder_id=any($2::uuid[])`, [COMPANY_ID, workorderIds]) : { rows: [] };
  const usageIds = usages.rows.map((row) => row.id);
  const receipts = await client.query(`select id from inventory_receipts where company_id=$1 and provider_marker like $2`, [COMPANY_ID, `${MARKER_PREFIX}-%`]);
  const receiptIds = receipts.rows.map((row) => row.id);
  const items = await client.query(`select id from inventory_items where company_id=$1 and external_id like $2`, [COMPANY_ID, `${REALISTIC_INVENTORY_DEMO_KEY}:%`]);
  const itemIds = items.rows.map((row) => row.id);
  if (usageIds.length) {
    await client.query(`delete from inventory_aggregate_usage_position_allocations where company_id=$1 and usage_id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
    await client.query(`delete from workorder_aggregate_part_usage_events where company_id=$1 and usage_id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
  }
  if (workorderIds.length || receiptIds.length || usageIds.length) await client.query(`delete from inventory_stock_movements where company_id=$1 and (workorder_id=any($2::uuid[]) or receipt_id=any($3::uuid[]) or aggregate_usage_id=any($4::uuid[]))`, [COMPANY_ID, workorderIds, receiptIds, usageIds]);
  if (usageIds.length) await client.query(`delete from workorder_aggregate_part_usages where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, usageIds]);
  if (workorderIds.length) await client.query(`delete from operational_workorders where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, workorderIds]);
  if (receiptIds.length) {
    const units = await client.query(`select id from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    if (units.rows.length) await client.query(`delete from inventory_unit_events where company_id=$1 and unit_id=any($2::uuid[])`, [COMPANY_ID, units.rows.map((row) => row.id)]);
    await client.query(`delete from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
  }
  if (itemIds.length) {
    await client.query(`delete from inventory_position_balances where company_id=$1 and inventory_item_id=any($2::uuid[])`, [COMPANY_ID, itemIds]);
    await client.query(`delete from inventory_items where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, itemIds]);
  }
  if (receiptIds.length) {
    await client.query(`delete from local_inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from local_inventory_receipts where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
    await client.query(`delete from inventory_receipts where company_id=$1 and id=any($2::uuid[])`, [COMPANY_ID, receiptIds]);
  }
  return { workorders: workorderIds.length, receipts: receiptIds.length, items: itemIds.length };
}

async function verify(client, parts) {
  const codes = DEMO_SHOPS.flatMap((shop) => shop.positions.map((position) => position.code));
  const partIds = [...parts.values()].map((part) => part.id);
  const rows = await client.query(`select
    (select count(*)::int from inventory_positions where company_id=$1 and code=any($2::text[])) positions,
    (select count(*)::int from parts_catalog where company_id=$1 and id=any($3::uuid[])) parts,
    (select count(*)::int from inventory_items where company_id=$1 and external_id like $4) stock_items,
    (select count(*)::int from inventory_serialized_units unit join inventory_receipts receipt on receipt.id=unit.receipt_id and receipt.company_id=unit.company_id where unit.company_id=$1 and receipt.provider_marker like $5) serialized_units,
    (select count(*)::int from operational_workorders where company_id=$1 and form_data->'testFixture'->>'key'=$6) workorders,
    (select count(*)::int from workorder_part_requests request join operational_workorders workorder on workorder.id=request.workorder_id where workorder.company_id=$1 and workorder.form_data->'testFixture'->>'key'=$6) requests,
    (select count(*)::int from workorder_aggregate_part_usages usage join operational_workorders workorder on workorder.id=usage.workorder_id where usage.company_id=$1 and workorder.form_data->'testFixture'->>'key'=$6) usages`, [COMPANY_ID, codes, partIds, `${REALISTIC_INVENTORY_DEMO_KEY}:%`, `${MARKER_PREFIX}-%`, REALISTIC_INVENTORY_DEMO_KEY]);
  const summary = rows.rows[0], expected = validateRealisticInventoryDemo();
  if (summary.positions !== expected.positions || summary.parts !== expected.parts || summary.stock_items !== expected.stockPlacements || summary.serialized_units !== 1 || summary.workorders !== expected.workorders || summary.requests !== expected.workorders || summary.usages !== 2) throw new Error(`Test fixture reconciliation failed: ${JSON.stringify(summary)}`);
  const aggregate = await client.query(`select count(*)::int problems from inventory_items item where item.company_id=$1 and item.external_id like $2 and item.quantity_on_hand<>(select coalesce(sum(balance.quantity),0) from inventory_position_balances balance where balance.company_id=item.company_id and balance.inventory_item_id=item.id) and not exists(select 1 from inventory_serialized_units unit where unit.company_id=item.company_id and unit.location_id=item.location_id and unit.status='in_stock' and unit.receipt_id in(select id from inventory_receipts where provider_marker like $3))`, [COMPANY_ID, `${REALISTIC_INVENTORY_DEMO_KEY}:%`, `${MARKER_PREFIX}-%`]);
  if (aggregate.rows[0].problems) throw new Error("Test fixture position balances do not reconcile.");
  const tracking = await client.query(`select coalesce(part.tracking_mode,'quantity') tracking_mode,count(*)::int stock_placements from inventory_items item join parts_catalog part on part.id=item.catalog_part_id and part.company_id=item.company_id where item.company_id=$1 and item.external_id like $2 group by coalesce(part.tracking_mode,'quantity') order by tracking_mode`, [COMPANY_ID, `${REALISTIC_INVENTORY_DEMO_KEY}:%`]);
  if (!tracking.rows.some((row) => row.tracking_mode === "quantity") || !tracking.rows.some((row) => row.tracking_mode === "measured_bulk") || !tracking.rows.some((row) => row.tracking_mode === "serialized")) throw new Error(`Test fixture tracking mix is incomplete: ${JSON.stringify(tracking.rows)}`);
  return { fixture: REALISTIC_INVENTORY_DEMO_KEY, ...summary, tracking: tracking.rows, shops: DEMO_SHOPS.map((shop) => shop.name), parts: [...parts.values()].map((part) => ({ partNumber: part.part_number, description: part.description, trackingMode: part.tracking })), search: { workorders: "TEST-WO-", location: "W1" } };
}

async function seed() {
  assertLocalDatabase();
  validateRealisticInventoryDemo();
  const client = await getPool().connect();
  try {
    const context = await resolveContext(client);
    await prepareDemoCatalogPolicies(client);
    const parts = await resolveExistingParts(client);
    const existing = await client.query(`select id from inventory_receipts where company_id=$1 and provider_marker=$2`, [COMPANY_ID, `${MARKER_PREFIX}-chino`]);
    if (existing.rows[0]) {
      await client.query("begin");
      try {
        await reconcileDemoLocationLabels(client, context);
        const current = await client.query(`select count(*)::int stock_placements from inventory_items where company_id=$1 and external_id like $2`, [COMPANY_ID, `${REALISTIC_INVENTORY_DEMO_KEY}:%`]);
        if (current.rows[0].stock_placements === DEMO_STOCK.length) {
          await client.query("commit");
          return console.log(JSON.stringify({ replayed: true, ...(await verify(client, parts)) }, null, 2));
        }
        await removeCurrentFixture(client);
      }
      catch (error) { await client.query("rollback"); throw error; }
    } else {
      await client.query("begin");
    }
    const removed = await removePreviousSyntheticFixture(client);
    await reconcileDemoLocationLabels(client, context);
    const shopContext = new Map();
    for (const shop of DEMO_SHOPS) {
      const locationId = context.locations.get(shop.name), positionIds = new Map();
      for (const position of shop.positions) {
        const knownCodes = [...new Set([position.code, position.legacyCode, ...(position.legacyCodes || [])].filter(Boolean))];
        const existingPosition = await client.query(`select id from inventory_positions where company_id=$1 and location_id=$2 and code=any($3::text[]) order by case when code=$4 then 0 else 1 end limit 1`, [COMPANY_ID, locationId, knownCodes, position.code]);
        const parentId = position.parent ? positionIds.get(position.parent) : null;
        if (!existingPosition.rows[0]) throw new Error(`Fixture position ${shop.name}/${position.code} was not reconciled.`);
        await client.query(`update inventory_positions set parent_id=$3,code=$4,name=$5,kind=$6,usage=$7,can_store=$8,is_pickable=$8,updated_at=now() where company_id=$1 and id=$2`, [COMPANY_ID, existingPosition.rows[0].id, parentId, position.code, position.name, position.kind, position.stores ? "storage" : null, Boolean(position.stores)]);
        positionIds.set(position.key, existingPosition.rows[0].id);
      }
      shopContext.set(shop.key, { locationId, positionIds });
    }
    await client.query(`update inventory_positions set name='Receiving area',updated_at=now() where company_id=$1 and location_id=$2 and system_key='receiving'`, [COMPANY_ID, context.locations.get("Chino Yard")]);
    const receiptByShop = new Map(), lineByPlacement = new Map();
    for (const shop of DEMO_SHOPS) {
      const stockRows = DEMO_STOCK.filter((stock) => stock.shop === shop.key);
      if (!stockRows.length) continue;
      const receiptId = randomUUID(), locationId = shopContext.get(shop.key).locationId, idempotencyKey = `test-receipt:${REALISTIC_INVENTORY_DEMO_KEY}:${shop.key}`;
      await client.query(`insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at) values($1,$2,$3,$4,$5,'local_direct',$6,'Local test opening stock','confirmed',now())`, [receiptId, COMPANY_ID, locationId, context.actorId, idempotencyKey, `${MARKER_PREFIX}-${shop.key}`]);
      await client.query(`insert into local_inventory_receipts(id,company_id,location_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,physical_confirmation,confirmation_hash,source_type,source_reference,posting_route,no_purchase_order_reason) values($1,$2,$3,$4,$5,$6,'posted',$7,$8,'physically_received',$9,'direct','Local test opening stock','no_purchase_order','Local test fixture')`, [receiptId, COMPANY_ID, locationId, context.actorId, idempotencyKey, hash(idempotencyKey), stockRows.length, stockRows.reduce((sum, row) => sum + row.received, 0), hash(`${idempotencyKey}:confirmation`)]);
      receiptByShop.set(shop.key, receiptId);
      for (let index = 0; index < stockRows.length; index += 1) {
        const stock = stockRows[index], part = parts.get(stock.part), lineId = randomUUID(), total = Number((stock.received * part.cost).toFixed(2));
        await client.query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode,catalog_tracking_mode,currency,unit_cost,line_total,cost_source) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'USD',$13,$14,'manual')`, [lineId, COMPANY_ID, receiptId, index, part.id, `local-test:${part.id}`, part.part_number, part.description, stock.received, part.uom_code, part.tracking === "serialized" ? "serial" : "aggregate", part.tracking, part.cost, total]);
        await client.query(`insert into local_inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,normalized_part_number,part_number,description,quantity,uom_code,unit_cost,line_total) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)`, [lineId, COMPANY_ID, receiptId, index, part.id, part.normalized_part_number, part.part_number, part.description, stock.received, part.uom_code, part.cost, total]);
        lineByPlacement.set(`${shop.key}:${stock.part}`, lineId);
      }
    }
    const itemByPlacement = new Map();
    for (const stock of DEMO_STOCK) {
      const part = parts.get(stock.part), { locationId, positionIds } = shopContext.get(stock.shop), positionId = positionIds.get(stock.position), receiptId = receiptByShop.get(stock.shop), lineId = lineByPlacement.get(`${stock.shop}:${stock.part}`);
      const item = await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,manufacturer,description,quantity_on_hand,quantity_reserved,bin_location,uom_code,source_provider,external_id,last_seen_at) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,'local',$12,now()) returning id`, [COMPANY_ID, locationId, part.id, part.normalized_part_number, part.part_number, part.manufacturer, part.description, stock.onHand, stock.reserved || 0, DEMO_SHOPS.find((shop) => shop.key === stock.shop).positions.find((position) => position.key === stock.position).code, part.uom_code, `${REALISTIC_INVENTORY_DEMO_KEY}:${stock.shop}:${part.key}`]);
      itemByPlacement.set(`${stock.shop}:${stock.part}`, item.rows[0].id);
      if (part.tracking !== "serialized") await client.query(`insert into inventory_position_balances(company_id,location_id,position_id,inventory_item_id,catalog_part_id,uom_code,quantity,quantity_reserved) values($1,$2,$3,$4,$5,$6,$7,$8)`, [COMPANY_ID, locationId, positionId, item.rows[0].id, part.id, part.uom_code, stock.onHand, stock.reserved || 0]);
      else for (let ordinal = 0; ordinal < stock.serials.length; ordinal += 1) await client.query(`insert into inventory_serialized_units(company_id,location_id,receipt_id,receipt_line_id,unit_ordinal,serial_number,status,condition_code,custody_holder_type,custody_location_id,current_position_id) values($1,$2,$3,$4,$5,$6,'in_stock','serviceable_used','inventory_location',$2,$7)`, [COMPANY_ID, locationId, receiptId, lineId, ordinal + 1, stock.serials[ordinal], positionId]);
      await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,receipt_id,receipt_line_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key) values($1,$2,$3,$4,$5,'direct_receipt',$6,$7,$8,'Local test opening stock',$9)`, [COMPANY_ID, locationId, part.id, receiptId, lineId, stock.received, part.uom_code, context.actorId, `test-movement:${stock.shop}:${stock.part}`]);
    }
    for (const workorder of DEMO_WORKORDERS) {
      const { locationId, positionIds } = shopContext.get(workorder.shop), part = parts.get(workorder.part), createdAt = new Date(Date.now() - (DEMO_WORKORDERS.indexOf(workorder) + 1) * 86400000);
      const acceptedAt = ["accepted", "in_progress", "closed"].includes(workorder.status) ? createdAt : null, startedAt = ["in_progress", "closed"].includes(workorder.status) ? createdAt : null, closedAt = workorder.status === "closed" ? new Date(createdAt.getTime() + 7200000) : null;
      const inserted = await client.query(`insert into operational_workorders(company_id,serial,location_id,created_by_user_id,status,concern,diagnosis,work_performed,office_notes,form_data,accepted_at,started_at,closed_at,created_at,updated_at,approved_by_user_id) values($1,$2,$3,$4,$5,$6,$7,$8,'',$9::jsonb,$10,$11,$12,$13,now(),$4) returning id`, [COMPANY_ID, workorder.serial, locationId, context.actorId, workorder.status, workorder.concern, workorder.diagnosis, workorder.workPerformed || "", JSON.stringify({ unitNo: workorder.unitNo, unitType: "Truck", companyName: DEMO_SHOPS.find((shop) => shop.key === workorder.shop).name, mechanicConcern: workorder.concern, testFixture: { key: REALISTIC_INVENTORY_DEMO_KEY } }), acceptedAt, startedAt, closedAt, createdAt]);
      const workorderId = inserted.rows[0].id, mechanicId = context.mechanicByLocation.get(locationId) || context.fallbackMechanic;
      await client.query(`insert into workorder_status_events(workorder_id,from_status,to_status,changed_by_user_id,note,created_at) values($1,null,$2,$3,'Local inventory test workorder',$4)`, [workorderId, workorder.status, context.actorId, createdAt]);
      await client.query(`insert into workorder_mechanic_assignments(workorder_id,mechanic_user_id,assignment_role,active,assigned_by_user_id,assigned_at,reason) values($1,$2,'primary',true,$3,$4,'Local inventory workflow test')`, [workorderId, mechanicId, context.actorId, createdAt]);
      await client.query(`insert into workorder_part_requests(workorder_id,requested_by_user_id,catalog_part_id,raw_query,part_number,normalized_part_number,manufacturer,description,category,quantity,repair_order,approval_status,fitment_status,usage_status,approved_by_user_id,approved_at,decision_reason,raw_context,uom_code) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,'confirmed',$13,$14,$15,$16,$17::jsonb,$18)`, [workorderId, mechanicId, part.id, part.description, part.part_number, part.normalized_part_number, part.manufacturer, part.description, part.category, workorder.quantity, workorder.repairOrder, workorder.request, workorder.usage === "consumed" ? "installed" : "not_issued", workorder.request === "approved" ? context.actorId : null, workorder.request === "approved" ? createdAt : null, workorder.request === "approved" ? "Approved local test request" : "", JSON.stringify({ testFixture: REALISTIC_INVENTORY_DEMO_KEY }), part.uom_code]);
      if (workorder.usage) {
        const usageId = randomUUID(), usageKey = `test-usage:${workorder.key}`, consumed = workorder.usage === "consumed";
        await client.query(`insert into workorder_aggregate_part_usages(id,company_id,workorder_id,location_id,catalog_part_id,quantity,uom_code,status,repair_order,created_by_user_id,finalized_by_user_id,idempotency_key,request_hash,pending_at,consumed_at,tracking_mode) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,$15,'quantity')`, [usageId, COMPANY_ID, workorderId, locationId, part.id, workorder.quantity, part.uom_code, workorder.usage, workorder.repairOrder, mechanicId, consumed ? context.actorId : null, usageKey, hash(usageKey), consumed ? createdAt : null, consumed ? closedAt : null]);
        await client.query(`insert into workorder_aggregate_part_usage_events(company_id,usage_id,event_type,quantity_delta,actor_id,details) values($1,$2,'reserved',$3,$4,$5::jsonb)`, [COMPANY_ID, usageId, workorder.quantity, mechanicId, JSON.stringify({ testFixture: REALISTIC_INVENTORY_DEMO_KEY })]);
        const stock = DEMO_STOCK.find((candidate) => candidate.shop === workorder.shop && candidate.part === workorder.part), itemId = itemByPlacement.get(`${workorder.shop}:${workorder.part}`), positionId = positionIds.get(stock.position);
        await client.query(`insert into inventory_aggregate_usage_position_allocations(company_id,usage_id,position_id,inventory_item_id,quantity,status) values($1,$2,$3,$4,$5,$6)`, [COMPANY_ID, usageId, positionId, itemId, workorder.quantity, consumed ? "consumed" : "reserved"]);
        if (consumed) {
          await client.query(`insert into workorder_aggregate_part_usage_events(company_id,usage_id,event_type,quantity_delta,actor_id) values($1,$2,'installed_pending_approval',0,$3),($1,$2,'consumed',$4,$3)`, [COMPANY_ID, usageId, context.actorId, -workorder.quantity]);
          await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key,aggregate_usage_id,workorder_id) values($1,$2,$3,'issue',$4,$5,$6,'Consumed on local test workorder',$7,$8,$9)`, [COMPANY_ID, locationId, part.id, -workorder.quantity, part.uom_code, context.actorId, `test-consume:${workorder.key}`, usageId, workorderId]);
        }
      }
    }
    await client.query("commit");
    console.log(JSON.stringify({ replayed: false, removedPreviousFixture: removed, ...(await verify(client, parts)) }, null, 2));
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}

seed().catch((error) => { console.error(error); process.exitCode = 1; }).finally(closePool);
