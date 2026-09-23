import { createHash, randomUUID } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { closePool, getPool } from "../../src/server/db/pool.js";
import { DEFAULT_COMPANY_ID } from "../../src/server/db/company.js";
import { normalizePartNumber } from "../../src/server/modules/parts/part.constants.js";
import { inspectInventoryAuthority, recordInventoryAuthorityCutover } from "../../src/server/db/repositories/inventory-authority.repo.js";
import { placeAggregateInventoryReceipt } from "../../src/server/db/repositories/inventory-positions.repo.js";
import { DEMO_SHOPS, REALISTIC_INVENTORY_DEMO_KEY } from "../../src/server/db/seeds/realistic-inventory-demo.data.js";

const COMPANY_ID = DEFAULT_COMPANY_ID;
const DEFAULT_LOCATION_NAME = "Chino Yard";
const STAGING_PROJECT_NAME = "junior";
const STAGING_SERVICE_NAME = "junior";
const STAGING_PUBLIC_DOMAIN = "junior-staging.up.railway.app";
const FIXTURE_MARKER_PREFIX = `SHOP-TEST-${REALISTIC_INVENTORY_DEMO_KEY}`;
const SOURCE_PREFIX = "chino-manager-csv";
const EXPECTED_HEADERS = ["Part #", "Part Name", "Category", "Fits / Description", "Bin / Shelf", "Opening Qty", "Total In", "Total Used", "Current Qty", "Reorder At", "Status", "Avg Cost", "Sell Price", "Inventory Value"];
const sha256 = (value) => createHash("sha256").update(value).digest("hex");

export function parseCsv(text) {
  const rows = [];
  let row = [], value = "", quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { value += '"'; index += 1; }
      else if (character === '"') quoted = false;
      else value += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(value); value = ""; }
    else if (character === "\n") { row.push(value.replace(/\r$/, "")); rows.push(row); row = []; value = ""; }
    else value += character;
  }
  if (quoted) throw new Error("CSV contains an unterminated quoted value.");
  if (value || row.length) { row.push(value.replace(/\r$/, "")); rows.push(row); }
  return rows;
}

function number(value, label, rowNumber) {
  const normalized = String(value || "").trim().replaceAll(",", "").replace(/^\$/, "");
  if (!normalized) return null;
  const parsed = Number(normalized);
  if (!Number.isFinite(parsed) || parsed < 0) throw new Error(`Invalid ${label} on CSV row ${rowNumber}: ${value}`);
  return parsed;
}

function generatedPartNumber(row, rowNumber) {
  const name = String(row[1] || "").trim();
  const location = String(row[4] || "").trim();
  const slug = normalizePartNumber(name).slice(0, 30);
  if (slug) return `LOCAL-${slug}-${rowNumber}`;
  return `UNIDENTIFIED-${normalizePartNumber(location) || "NOLOCATION"}-${rowNumber}`;
}

export function buildImportPlan(text, fileName = "inventory.csv") {
  const rows = parseCsv(text);
  const headerIndex = rows.findIndex((row) => row[0]?.trim() === EXPECTED_HEADERS[0]);
  if (headerIndex < 0) throw new Error("Could not find the Parts Inventory header row.");
  const headers = rows[headerIndex].map((value) => value.trim());
  if (EXPECTED_HEADERS.some((header, index) => headers[index] !== header)) throw new Error("The CSV columns do not match the expected Parts Inventory format.");
  const rawLines = rows.slice(headerIndex + 1).map((row, index) => ({ row, rowNumber: headerIndex + index + 2 })).filter(({ row }) => row.some((value) => value.trim()));
  const lines = rawLines.map(({ row, rowNumber }) => {
    const suppliedPartNumber = String(row[0] || "").trim();
    const partNumber = suppliedPartNumber || generatedPartNumber(row, rowNumber);
    const current = number(row[8], "Current Qty", rowNumber);
    const opening = number(row[5], "Opening Qty", rowNumber);
    const quantity = current ?? opening ?? 0;
    if (!Number.isInteger(quantity)) throw new Error(`CSV row ${rowNumber} uses a fractional quantity without a measured/bulk unit.`);
    const rawPosition = String(row[4] || "").trim().toUpperCase();
    const match = rawPosition.match(/^A(\d+)-B(\d+)-S(\d+)$/);
    if (rawPosition && rawPosition !== "1" && !match) throw new Error(`Unsupported location '${rawPosition}' on CSV row ${rowNumber}.`);
    const positionKey = !rawPosition ? "SYS-UNASSIGNED" : rawPosition === "1" ? "SHOP-1" : rawPosition;
    return {
      rowNumber, suppliedPartNumber, partNumber, normalizedPartNumber: normalizePartNumber(partNumber),
      name: String(row[1] || "").trim(), category: String(row[2] || "").trim(),
      fits: String(row[3] || "").trim(), rawPosition, positionKey, quantity,
      reorderAt: number(row[9], "Reorder At", rowNumber), status: String(row[10] || "").trim(),
    };
  });
  const placements = new Map(), parts = new Map();
  for (const line of lines) {
    if (!line.normalizedPartNumber) throw new Error(`CSV row ${line.rowNumber} has no usable part identity.`);
    const known = parts.get(line.normalizedPartNumber);
    if (!known) parts.set(line.normalizedPartNumber, { ...line, sourceRows: [line.rowNumber], totalQuantity: line.quantity });
    else {
      known.sourceRows.push(line.rowNumber); known.totalQuantity += line.quantity;
      if (!known.name && line.name) known.name = line.name;
      if (!known.category && line.category) known.category = line.category;
      if (!known.fits && line.fits) known.fits = line.fits;
    }
    if (line.quantity <= 0) continue;
    const key = `${line.normalizedPartNumber}:${line.positionKey}`;
    const placement = placements.get(key);
    if (placement) { placement.quantity += line.quantity; placement.sourceRows.push(line.rowNumber); }
    else placements.set(key, { ...line, sourceRows: [line.rowNumber] });
  }
  return { fileName, lineCount: lines.length, parts: [...parts.values()], placements: [...placements.values()], generatedPartNumbers: lines.filter((line) => !line.suppliedPartNumber).map((line) => ({ row: line.rowNumber, partNumber: line.partNumber })) };
}

export function assertImportTarget({ target = "local", stagingConfirmation = null, env = process.env } = {}) {
  if (!env.DATABASE_URL) throw new Error("DATABASE_URL is required.");
  const url = new URL(env.DATABASE_URL.replace("postgresql+asyncpg:", "postgresql:"));
  const isLocalHost = ["localhost", "127.0.0.1", "::1"].includes(url.hostname);
  if (target === "local") {
    if (!isLocalHost) throw new Error("Local import mode only runs against a localhost database.");
    if (env.NODE_ENV === "production") throw new Error("Local import mode cannot run in production mode.");
    return { target, databaseHost: url.hostname };
  }
  if (target !== "staging") throw new Error(`Unsupported import target '${target}'.`);
  if (stagingConfirmation !== STAGING_PUBLIC_DOMAIN) throw new Error(`Staging import requires --confirm-staging=${STAGING_PUBLIC_DOMAIN}.`);
  if (env.RAILWAY_ENVIRONMENT_NAME !== "staging" || env.RAILWAY_PROJECT_NAME !== STAGING_PROJECT_NAME || env.RAILWAY_SERVICE_NAME !== STAGING_SERVICE_NAME || env.RAILWAY_PUBLIC_DOMAIN !== STAGING_PUBLIC_DOMAIN) {
    throw new Error("Staging import target does not match the expected Railway project, service, environment, and public domain.");
  }
  if (isLocalHost) throw new Error("Staging import mode requires the Railway staging database.");
  return { target, databaseHost: url.hostname, publicDomain: env.RAILWAY_PUBLIC_DOMAIN };
}

async function resolveContext(client, locationName) {
  const location = (await client.query("select id,name from locations where company_id=$1 and active=true and lower(name)=lower($2)", [COMPANY_ID, locationName])).rows[0];
  if (!location) throw new Error(`Inventory location '${locationName}' is missing.`);
  const actor = (await client.query(`select profile.id from user_profiles profile join user_company_memberships membership on membership.user_id=profile.id and membership.company_id=$1 and membership.active=true and membership.role in ('admin','office') where profile.active=true and profile.deleted_at is null order by case membership.role when 'admin' then 0 else 1 end,profile.created_at limit 1`, [COMPANY_ID])).rows[0];
  if (!actor) throw new Error("An active administrator or office user is required.");
  return { locationId: location.id, locationName: location.name, actorId: actor.id };
}

async function removeInventoryDemoFixture(client, locationName) {
  const workorderIds = (await client.query(`select id from operational_workorders where company_id=$1 and form_data->'testFixture'->>'key'=$2`, [COMPANY_ID, REALISTIC_INVENTORY_DEMO_KEY])).rows.map((row) => row.id);
  const usageIds = workorderIds.length ? (await client.query("select id from workorder_aggregate_part_usages where company_id=$1 and workorder_id=any($2::uuid[])", [COMPANY_ID, workorderIds])).rows.map((row) => row.id) : [];
  const receiptIds = (await client.query("select id from inventory_receipts where company_id=$1 and provider_marker like $2", [COMPANY_ID, `${FIXTURE_MARKER_PREFIX}-%`])).rows.map((row) => row.id);
  const itemIds = (await client.query("select id from inventory_items where company_id=$1 and external_id like $2", [COMPANY_ID, `${REALISTIC_INVENTORY_DEMO_KEY}:%`])).rows.map((row) => row.id);
  if (usageIds.length) {
    await client.query("delete from inventory_aggregate_usage_position_allocations where company_id=$1 and usage_id=any($2::uuid[])", [COMPANY_ID, usageIds]);
    await client.query("delete from workorder_aggregate_part_usage_events where company_id=$1 and usage_id=any($2::uuid[])", [COMPANY_ID, usageIds]);
  }
  if (workorderIds.length || receiptIds.length || usageIds.length) await client.query("delete from inventory_stock_movements where company_id=$1 and (workorder_id=any($2::uuid[]) or receipt_id=any($3::uuid[]) or aggregate_usage_id=any($4::uuid[]))", [COMPANY_ID, workorderIds, receiptIds, usageIds]);
  if (usageIds.length) await client.query("delete from workorder_aggregate_part_usages where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, usageIds]);
  if (workorderIds.length) await client.query("delete from operational_workorders where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, workorderIds]);
  if (receiptIds.length) {
    const operationIds = (await client.query("select id from inventory_position_operations where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds])).rows.map((row) => row.id);
    if (operationIds.length) await client.query("delete from inventory_position_movements where company_id=$1 and operation_id=any($2::uuid[])", [COMPANY_ID, operationIds]);
    if (operationIds.length) await client.query("delete from inventory_position_operations where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, operationIds]);
    const unitIds = (await client.query("select id from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds])).rows.map((row) => row.id);
    if (unitIds.length) await client.query("delete from inventory_unit_events where company_id=$1 and unit_id=any($2::uuid[])", [COMPANY_ID, unitIds]);
    await client.query("delete from inventory_serialized_units where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
  }
  if (itemIds.length) {
    await client.query("delete from inventory_position_balances where company_id=$1 and inventory_item_id=any($2::uuid[])", [COMPANY_ID, itemIds]);
    await client.query("delete from inventory_items where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, itemIds]);
  }
  if (receiptIds.length) {
    await client.query("delete from inventory_authority_cutovers where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
    await client.query("delete from local_inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
    await client.query("delete from inventory_receipt_lines where company_id=$1 and receipt_id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
    await client.query("delete from local_inventory_receipts where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
    await client.query("delete from inventory_receipts where company_id=$1 and id=any($2::uuid[])", [COMPANY_ID, receiptIds]);
  }
  for (const shop of DEMO_SHOPS) {
    const location = (await client.query("select id from locations where company_id=$1 and name=$2", [COMPANY_ID, shop.name])).rows[0];
    if (!location) continue;
    const codes = [...new Set(shop.positions.flatMap((position) => [position.code, position.legacyCode, ...(position.legacyCodes || [])]).filter(Boolean))];
    await client.query(`delete from inventory_positions position where position.company_id=$1 and position.location_id=$2 and position.system_key is null and position.code=any($3::text[])
      and not exists(select 1 from inventory_position_balances balance where balance.company_id=position.company_id and balance.position_id=position.id)
      and not exists(select 1 from inventory_serialized_units unit where unit.company_id=position.company_id and unit.current_position_id=position.id)
      and not exists(select 1 from inventory_positions child where child.company_id=position.company_id and child.parent_id=position.id)`, [COMPANY_ID, location.id, codes]);
    for (let attempt = 0; attempt < 8; attempt += 1) await client.query(`delete from inventory_positions position where position.company_id=$1 and position.location_id=$2 and position.system_key is null and position.code=any($3::text[])
      and not exists(select 1 from inventory_position_balances balance where balance.company_id=position.company_id and balance.position_id=position.id)
      and not exists(select 1 from inventory_serialized_units unit where unit.company_id=position.company_id and unit.current_position_id=position.id)
      and not exists(select 1 from inventory_positions child where child.company_id=position.company_id and child.parent_id=position.id)`, [COMPANY_ID, location.id, codes]);
  }
  await client.query(`delete from inventory_position_count_sessions session
    where session.company_id=$1 and session.position_id in(
      select position.id from inventory_positions position where position.company_id=$1
        and position.location_id=(select id from locations where company_id=$1 and name=$2 limit 1)
        and position.code='455' and position.name='bin1')`, [COMPANY_ID, locationName]);
  await client.query(`delete from inventory_position_admin_commands command where command.company_id=$1 and command.position_id in(
    select position.id from inventory_positions position where position.company_id=$1
      and position.location_id=(select id from locations where company_id=$1 and name=$2 limit 1)
      and position.code='455' and position.name='bin1')`, [COMPANY_ID, locationName]);
  await client.query(`delete from inventory_positions position where position.company_id=$1
    and position.location_id=(select id from locations where company_id=$1 and name=$2 limit 1)
    and position.code='455' and position.name='bin1' and position.system_key is null
    and not exists(select 1 from inventory_position_balances balance where balance.company_id=position.company_id and balance.position_id=position.id)
    and not exists(select 1 from inventory_serialized_units unit where unit.company_id=position.company_id and unit.current_position_id=position.id)
    and not exists(select 1 from inventory_positions child where child.company_id=position.company_id and child.parent_id=position.id)`, [COMPANY_ID, locationName]);
  return { workorders: workorderIds.length, usages: usageIds.length, receipts: receiptIds.length, items: itemIds.length };
}

async function upsertPosition(client, { locationId, actorId, parentId = null, code, name, kind, canStore = false }) {
  const result = await client.query(`insert into inventory_positions(company_id,location_id,parent_id,code,name,kind,usage,can_store,is_pickable,created_by)
    values($1,$2,$3,$4,$5,$6,$7,$8,$8,$9)
    on conflict(company_id,location_id,(lower(code))) do update set parent_id=excluded.parent_id,name=excluded.name,kind=excluded.kind,usage=excluded.usage,can_store=excluded.can_store,is_pickable=excluded.is_pickable,is_active=true,updated_at=now()
    returning id`, [COMPANY_ID, locationId, parentId, code, name, kind, canStore ? "storage" : null, canStore, actorId]);
  return result.rows[0].id;
}

async function buildPositions(client, context, plan) {
  const positions = new Map();
  const shopId = await upsertPosition(client, { ...context, code: "SHOP", name: "Shop", kind: "room" });
  positions.set("SHOP", shopId);
  const required = new Set(plan.placements.map((line) => line.positionKey));
  if (required.has("SHOP-1")) positions.set("SHOP-1", await upsertPosition(client, { ...context, parentId: shopId, code: "SHOP-1", name: "Shelf 1", kind: "shelf", canStore: true }));
  for (const raw of [...required].filter((key) => /^A\d+-B\d+-S\d+$/.test(key)).sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))) {
    const [, aisleNo, binNo, shelfNo] = raw.match(/^A(\d+)-B(\d+)-S(\d+)$/);
    const aisleCode = `A${aisleNo}`, shelfCode = `${aisleCode}-S${shelfNo}`, binCode = `${shelfCode}-B${binNo}`;
    if (!positions.has(aisleCode)) positions.set(aisleCode, await upsertPosition(client, { ...context, parentId: shopId, code: aisleCode, name: `Aisle ${aisleNo}`, kind: "aisle" }));
    if (!positions.has(shelfCode)) positions.set(shelfCode, await upsertPosition(client, { ...context, parentId: positions.get(aisleCode), code: shelfCode, name: `Shelf ${shelfNo}`, kind: "shelf" }));
    if (!positions.has(binCode)) positions.set(binCode, await upsertPosition(client, { ...context, parentId: positions.get(shelfCode), code: binCode, name: `Bin ${binNo}`, kind: "bin", canStore: true }));
    positions.set(raw, positions.get(binCode));
  }
  const unassigned = (await client.query("select id from inventory_positions where company_id=$1 and location_id=$2 and system_key='unassigned'", [COMPANY_ID, context.locationId])).rows[0];
  if (!unassigned) throw new Error("Chino Yard system unassigned position is missing.");
  positions.set("SYS-UNASSIGNED", unassigned.id);
  return positions;
}

async function resolveCatalog(client, plan, sourceHash) {
  const normalized = plan.parts.map((part) => part.normalizedPartNumber);
  const existing = await client.query("select * from parts_catalog where company_id=$1 and normalized_part_number=any($2::text[])", [COMPANY_ID, normalized]);
  const byNormalized = new Map(existing.rows.map((row) => [row.normalized_part_number, row]));
  let created = 0, reused = 0;
  for (const source of plan.parts) {
    let part = byNormalized.get(source.normalizedPartNumber);
    if (part) {
      const activity = await client.query(`select exists(select 1 from inventory_items where company_id=$1 and catalog_part_id=$2) or exists(select 1 from inventory_stock_movements where company_id=$1 and catalog_part_id=$2) active`, [COMPANY_ID, part.id]);
      if (part.tracking_mode && part.tracking_mode !== "quantity") throw new Error(`Part ${part.part_number} uses ${part.tracking_mode} tracking and cannot accept this quantity-only source.`);
      if (!part.tracking_mode && activity.rows[0].active) throw new Error(`Part ${part.part_number} has activity but no reviewed tracking mode.`);
      if (!part.tracking_mode) await client.query("update parts_catalog set tracking_mode='quantity',version=version+1,updated_at=now() where company_id=$1 and id=$2", [COMPANY_ID, part.id]);
      part = { ...part, tracking_mode: "quantity" }; reused += 1;
    } else {
      const description = source.name || source.category || source.partNumber;
      part = (await client.query(`insert into parts_catalog(company_id,normalized_part_number,part_number,description,category,repair_template,uom_code,tracking_mode,source_provider,external_id,last_seen_at)
        values($1,$2,$3,$4,$5,$6,'ea','quantity','local',$7,now()) returning *`, [COMPANY_ID, source.normalizedPartNumber, source.partNumber, description, source.category, source.fits, `${SOURCE_PREFIX}:${sourceHash.slice(0, 16)}:${source.normalizedPartNumber}`])).rows[0];
      byNormalized.set(source.normalizedPartNumber, part); created += 1;
    }
  }
  return { byNormalized, created, reused };
}

async function applyPlan(client, plan, context, sourceHash) {
  const demoRemoved = await removeInventoryDemoFixture(client, context.locationName);
  const positions = await buildPositions(client, context, plan);
  const catalog = await resolveCatalog(client, plan, sourceHash);
  const positiveParts = new Map();
  for (const placement of plan.placements) positiveParts.set(placement.normalizedPartNumber, (positiveParts.get(placement.normalizedPartNumber) || 0) + placement.quantity);
  const items = new Map();
  for (const [normalizedPartNumber, quantity] of positiveParts) {
    const part = catalog.byNormalized.get(normalizedPartNumber);
    const locations = plan.placements.filter((line) => line.normalizedPartNumber === normalizedPartNumber).map((line) => line.positionKey);
    const item = await client.query(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,manufacturer,description,quantity_on_hand,quantity_reserved,bin_location,uom_code,source_provider,external_id,last_seen_at)
      values($1,$2,$3,$4,$5,$6,$7,$8,0,$9,'ea','local',$10,now()) returning id`, [COMPANY_ID, context.locationId, part.id, normalizedPartNumber, part.part_number, part.manufacturer, part.description, quantity, locations.length === 1 ? locations[0] : "Multiple", `${SOURCE_PREFIX}:${sourceHash.slice(0, 16)}:${part.id}`]);
    items.set(normalizedPartNumber, item.rows[0].id);
  }
  const chunks = [];
  for (let index = 0; index < plan.placements.length; index += 500) chunks.push(plan.placements.slice(index, index + 500));
  const authorityRecorded = new Set();
  for (const [chunkIndex, lines] of chunks.entries()) {
    const receiptId = randomUUID(), idempotencyKey = `${SOURCE_PREFIX}:${sourceHash.slice(0, 20)}:${chunkIndex + 1}`;
    await client.query(`insert into inventory_receipts(id,company_id,location_id,created_by,idempotency_key,provider,provider_marker,provider_picking_name,status,confirmed_at)
      values($1,$2,$3,$4,$5,'local_direct',$6,$7,'confirmed',now())`, [receiptId, COMPANY_ID, context.locationId, context.actorId, idempotencyKey, `SHOP-MANAGER-${sourceHash.slice(0, 24)}-${chunkIndex + 1}`, `Opening inventory · ${plan.fileName} · ${chunkIndex + 1}/${chunks.length}`]);
    await client.query(`insert into local_inventory_receipts(id,company_id,location_id,created_by,idempotency_key,request_hash,status,line_count,total_quantity,physical_confirmation,confirmation_hash,source_type,source_reference,posting_route,no_purchase_order_reason)
      values($1,$2,$3,$4,$5,$6,'posted',$7,$8,'all_received_undamaged',$9,'direct',$10,'no_purchase_order','Opening inventory supplied by Chino shop manager')`, [receiptId, COMPANY_ID, context.locationId, context.actorId, idempotencyKey, sha256(idempotencyKey), lines.length, lines.reduce((sum, line) => sum + line.quantity, 0), sha256(`${idempotencyKey}:confirmed`), plan.fileName]);
    for (const [lineIndex, line] of lines.entries()) {
      const part = catalog.byNormalized.get(line.normalizedPartNumber), receiptLineId = randomUUID();
      await client.query(`insert into inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,product_external_id,part_number,description,quantity,uom_code,tracking_mode,catalog_tracking_mode,cost_source)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'ea','aggregate','quantity','unknown')`, [receiptLineId, COMPANY_ID, receiptId, lineIndex, part.id, part.external_id || `local:${part.id}`, part.part_number, part.description, line.quantity]);
      await client.query(`insert into local_inventory_receipt_lines(id,company_id,receipt_id,line_index,catalog_part_id,normalized_part_number,part_number,description,quantity,uom_code)
        values($1,$2,$3,$4,$5,$6,$7,$8,$9,'ea')`, [receiptLineId, COMPANY_ID, receiptId, lineIndex, part.id, part.normalized_part_number, part.part_number, part.description, line.quantity]);
      if (!authorityRecorded.has(part.id)) {
        const claim = await inspectInventoryAuthority(client, { companyId: COMPANY_ID, locationId: context.locationId, catalogPartId: part.id, normalizedPartNumber: part.normalized_part_number, uomCode: "ea" });
        if (claim.kind !== "claimable") throw new Error(`Inventory authority conflict for ${part.part_number}: ${claim.kind}`);
        await recordInventoryAuthorityCutover(client, { claim, companyId: COMPANY_ID, locationId: context.locationId, catalogPartId: part.id, receiptId, receiptLineId });
        authorityRecorded.add(part.id);
      }
      const sourceRows = line.sourceRows.join(", ");
      await client.query(`insert into inventory_stock_movements(company_id,location_id,catalog_part_id,receipt_id,receipt_line_id,movement_type,quantity_delta,uom_code,actor_id,reason,idempotency_key)
        values($1,$2,$3,$4,$5,'adjustment',$6,'ea',$7,$8,$9)`, [COMPANY_ID, context.locationId, part.id, receiptId, receiptLineId, line.quantity, context.actorId, `Opening count from ${plan.fileName}, source row${line.sourceRows.length === 1 ? "" : "s"} ${sourceRows}`, `${SOURCE_PREFIX}:${sourceHash.slice(0, 16)}:movement:${chunkIndex}:${lineIndex}`]);
      await placeAggregateInventoryReceipt(client, { companyId: COMPANY_ID, locationId: context.locationId, inventoryItemId: items.get(line.normalizedPartNumber), catalogPartId: part.id, uomCode: "ea", quantity: line.quantity, actorId: context.actorId, idempotencyKey: `${SOURCE_PREFIX}:${sourceHash.slice(0, 16)}:position:${chunkIndex}:${lineIndex}`, receiptId, systemKey: line.positionKey === "SYS-UNASSIGNED" ? "unassigned" : "receiving", targetPositionId: line.positionKey === "SYS-UNASSIGNED" ? null : positions.get(line.positionKey), reason: `Opening count · ${line.positionKey} · source row${line.sourceRows.length === 1 ? "" : "s"} ${sourceRows}` });
    }
  }
  return { demoRemoved, catalogCreated: catalog.created, catalogReused: catalog.reused, receipts: chunks.length, inventoryItems: items.size, placements: plan.placements.length };
}

async function verifyApplied(client, plan, context, sourceHash) {
  const marker = `${SOURCE_PREFIX}:${sourceHash.slice(0, 16)}:%`;
  const result = await client.query(`select
    (select count(*)::int from parts_catalog where company_id=$1 and external_id like $3) imported_catalog,
    (select count(*)::int from inventory_items where company_id=$1 and location_id=$2 and external_id like $3) imported_items,
    (select coalesce(sum(quantity_on_hand),0)::numeric from inventory_items where company_id=$1 and location_id=$2 and external_id like $3) item_quantity,
    (select count(*)::int from inventory_position_balances balance join inventory_items item on item.company_id=balance.company_id and item.id=balance.inventory_item_id where balance.company_id=$1 and balance.location_id=$2 and item.external_id like $3) balances,
    (select coalesce(sum(balance.quantity),0)::numeric from inventory_position_balances balance join inventory_items item on item.company_id=balance.company_id and item.id=balance.inventory_item_id where balance.company_id=$1 and balance.location_id=$2 and item.external_id like $3) balance_quantity,
    (select count(*)::int from inventory_receipts where company_id=$1 and provider_marker like $4) receipts,
    (select count(*)::int from operational_workorders where company_id=$1 and form_data->'testFixture'->>'key'=$5) demo_workorders,
    (select count(*)::int from inventory_items where company_id=$1 and external_id like $6) demo_items`, [COMPANY_ID, context.locationId, marker, `SHOP-MANAGER-${sourceHash.slice(0, 24)}-%`, REALISTIC_INVENTORY_DEMO_KEY, `${REALISTIC_INVENTORY_DEMO_KEY}:%`]);
  const summary = result.rows[0], expectedQuantity = plan.placements.reduce((sum, line) => sum + line.quantity, 0), expectedItems = new Set(plan.placements.map((line) => line.normalizedPartNumber)).size;
  if (Number(summary.imported_items) !== expectedItems || Number(summary.item_quantity) !== expectedQuantity || Number(summary.balances) !== plan.placements.length || Number(summary.balance_quantity) !== expectedQuantity || summary.demo_workorders || summary.demo_items) throw new Error(`Applied inventory did not reconcile: ${JSON.stringify({ summary, expectedQuantity, expectedItems, expectedPlacements: plan.placements.length })}`);
  return { ...summary, expectedQuantity, expectedItems, expectedPlacements: plan.placements.length };
}

export async function runImport({ file, apply = false, reportFile = null, target = "local", stagingConfirmation = null, locationName = DEFAULT_LOCATION_NAME }) {
  const targetEvidence = assertImportTarget({ target, stagingConfirmation });
  const buffer = await readFile(file), sourceHash = sha256(buffer), text = new TextDecoder("windows-1252").decode(buffer);
  const plan = buildImportPlan(text, path.basename(file));
  const client = await getPool().connect();
  try {
    const context = await resolveContext(client, locationName);
    const existing = await client.query("select id from inventory_receipts where company_id=$1 and provider_marker like $2", [COMPANY_ID, `SHOP-MANAGER-${sourceHash.slice(0, 24)}-%`]);
    if (existing.rowCount) throw new Error("This exact manager CSV has already been imported.");
    const catalogMatches = await client.query("select count(*)::int count from parts_catalog where company_id=$1 and normalized_part_number=any($2::text[])", [COMPANY_ID, plan.parts.map((part) => part.normalizedPartNumber)]);
    const report = { mode: apply ? "apply" : "dry-run", target: targetEvidence, source: { file: path.resolve(file), sha256: sourceHash, encoding: "windows-1252" }, scope: { companyId: COMPANY_ID, locationId: context.locationId, locationName: context.locationName }, parsed: { sourceLines: plan.lineCount, uniqueParts: plan.parts.length, positivePlacements: plan.placements.length, totalQuantity: plan.placements.reduce((sum, line) => sum + line.quantity, 0), catalogMatches: catalogMatches.rows[0].count, catalogCreates: plan.parts.length - catalogMatches.rows[0].count, generatedPartNumbers: plan.generatedPartNumbers } };
    if (apply) {
      await client.query("begin");
      await client.query("select pg_advisory_xact_lock(hashtext($1))", [`${SOURCE_PREFIX}:${COMPANY_ID}:${context.locationId}`]);
      await client.query("set local app.allow_inventory_evidence_teardown='on'");
      report.applied = await applyPlan(client, plan, context, sourceHash);
      report.verified = await verifyApplied(client, plan, context, sourceHash);
      await client.query("commit");
    }
    if (reportFile) await writeFile(reportFile, `${JSON.stringify(report, null, 2)}\n`, "utf8");
    return report;
  } catch (error) {
    if (apply) await client.query("rollback").catch(() => {});
    throw error;
  } finally { client.release(); }
}

const invokedDirectly = process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1]);
if (invokedDirectly) {
  const file = process.argv.find((value) => value.startsWith("--file="))?.slice(7);
  const reportFile = process.argv.find((value) => value.startsWith("--report="))?.slice(9) || null;
  const target = process.argv.find((value) => value.startsWith("--target="))?.slice(9) || "local";
  const stagingConfirmation = process.argv.find((value) => value.startsWith("--confirm-staging="))?.slice(18) || null;
  const locationName = process.argv.find((value) => value.startsWith("--location="))?.slice(11) || DEFAULT_LOCATION_NAME;
  if (!file) { console.error("Usage: node --env-file=.env scripts/inventory/import-chino-manager-inventory.js --file=/path/to.csv [--apply] [--report=/path/report.json] [--location='Chino shop'] [--target=local|staging] [--confirm-staging=junior-staging.up.railway.app]"); process.exitCode = 2; }
  else runImport({ file, apply: process.argv.includes("--apply"), reportFile, target, stagingConfirmation, locationName }).then((report) => console.log(JSON.stringify(report, null, 2))).catch((error) => { console.error(error); process.exitCode = 1; }).finally(closePool);
}
