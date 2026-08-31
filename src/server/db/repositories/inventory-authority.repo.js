import { getPool, query } from "../pool.js";

function publicException(row) {
  return row && {
    id: row.id,
    state: row.state,
    sourceKind: row.source_kind,
    locationId: row.location_id,
    locationName: row.location_name,
    requestedCatalogPartId: row.requested_catalog_part_id,
    requestedPartNumber: row.requested_part_number,
    requestedDescription: row.requested_description,
    requestedNormalizedPartNumber: row.requested_normalized_part_number,
    requestedUomCode: row.requested_uom_code,
    sourceCatalogPartId: row.source_catalog_part_id || null,
    sourcePartNumber: row.source_part_number || "",
    sourceUomCode: row.source_uom_code || "",
    quantityOnHand: Number(row.source_quantity_on_hand || 0),
    quantityReserved: Number(row.source_quantity_reserved || 0),
    firstSeenAt: row.first_seen_at,
    lastSeenAt: row.last_seen_at,
  };
}

const exceptionSelect = `
  select exception.*, location.name as location_name,
         requested.part_number as requested_part_number,
         requested.description as requested_description,
         coalesce(legacy.catalog_part_id, balance.catalog_part_id) as source_catalog_part_id,
         coalesce(source_catalog.part_number, '') as source_part_number,
         coalesce(legacy.uom_code, balance.uom_code, '') as source_uom_code,
         coalesce(legacy.quantity_on_hand, balance.quantity_on_hand, 0) as source_quantity_on_hand,
         coalesce(legacy.quantity_reserved, 0) as source_quantity_reserved
  from inventory_authority_exceptions exception
  join locations location on location.company_id=exception.company_id and location.id=exception.location_id
  join parts_catalog requested on requested.company_id=exception.company_id and requested.id=exception.requested_catalog_part_id
  left join inventory_items legacy on legacy.company_id=exception.company_id and legacy.id=exception.inventory_item_id
  left join odoo_inventory_balances balance on balance.company_id=exception.company_id and balance.id=exception.odoo_balance_id
  left join parts_catalog source_catalog on source_catalog.company_id=exception.company_id
    and source_catalog.id=coalesce(legacy.catalog_part_id,balance.catalog_part_id)`;

export async function listInventoryAuthorityExceptions({ companyIds, locationIds, isAdmin, limit, offset }) {
  const [rows, count] = await Promise.all([
    query(`${exceptionSelect}
      where exception.company_id=any($1::uuid[]) and ($5::boolean or exception.location_id=any($2::uuid[]))
        and exception.resolved_at is null
      order by exception.last_seen_at desc, exception.id
      limit $3 offset $4`, [companyIds, locationIds, limit, offset, isAdmin]),
    query(`select count(*)::integer as total from inventory_authority_exceptions
      where company_id=any($1::uuid[]) and ($3::boolean or location_id=any($2::uuid[])) and resolved_at is null`,
    [companyIds, locationIds, isAdmin]),
  ]);
  return { items: rows.rows.map(publicException), total: count.rows[0]?.total || 0 };
}

export async function getInventoryAuthorityException({ exceptionId, companyIds, locationIds, isAdmin }) {
  const result = await query(`${exceptionSelect}
    where exception.id=$1 and exception.company_id=any($2::uuid[])
      and ($4::boolean or exception.location_id=any($3::uuid[])) and exception.resolved_at is null limit 1`,
  [exceptionId, companyIds, locationIds, isAdmin]);
  return publicException(result.rows[0]);
}

export async function acknowledgeInventoryAuthorityException(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `inventory-authority-ack:${input.actorId}:${input.idempotencyKey}`,
    ]);
    const prior = await client.query(
      `select exception_id, request_hash from inventory_authority_exception_events
       where company_id=any($1::uuid[]) and actor_id=$2 and idempotency_key=$3 limit 1`,
      [input.companyIds, input.actorId, input.idempotencyKey],
    );
    if (prior.rows[0]) {
      await client.query("commit");
      return prior.rows[0].request_hash === input.requestHash
        ? { kind: "replay", exceptionId: prior.rows[0].exception_id }
        : { kind: "idempotency_conflict" };
    }
    const selected = await client.query(
      `select * from inventory_authority_exceptions
       where id=$1 and company_id=any($2::uuid[]) and ($4::boolean or location_id=any($3::uuid[]))
         and resolved_at is null limit 1 for update`,
      [input.exceptionId, input.companyIds, input.locationIds, input.isAdmin],
    );
    const exception = selected.rows[0];
    if (!exception) { await client.query("rollback"); return { kind: "not_found" }; }
    let reserved = 0;
    if (exception.inventory_item_id) {
      const source = await client.query(
        `select quantity_reserved from inventory_items
         where company_id=$1 and id=$2 limit 1 for update`,
        [exception.company_id, exception.inventory_item_id],
      );
      reserved = Number(source.rows[0]?.quantity_reserved || 0);
    }
    if (reserved > 0) { await client.query("rollback"); return { kind: "reservation_blocked" }; }
    await client.query(
      `update inventory_authority_exceptions set resolved_at=now(), last_seen_at=now()
       where company_id=$1 and id=$2`, [exception.company_id, exception.id],
    );
    await client.query(
      `insert into inventory_authority_exception_events (
         company_id,exception_id,event_type,outcome,reason,actor_id,idempotency_key,request_hash,details
       ) values ($1,$2,'acknowledged_no_stock_change','resolved_without_stock_mutation',$3,$4,$5,$6,$7::jsonb)`,
      [exception.company_id, exception.id, input.reason, input.actorId,
        input.idempotencyKey, input.requestHash,
        JSON.stringify({ state: exception.state, sourceKind: exception.source_kind, stockMutation: false })],
    );
    await client.query("commit");
    return { kind: "resolved", exceptionId: exception.id, outcome: "resolved_without_stock_mutation" };
  } catch (error) { await client.query("rollback").catch(() => {}); throw error; }
  finally { client.release(); }
}

export async function inspectInventoryAuthority(client, {
  companyId,
  locationId,
  catalogPartId,
  normalizedPartNumber,
  uomCode,
}) {
  const legacy = await client.query(
    `select id, catalog_part_id, uom_code, source_provider, external_id,
            quantity_on_hand, quantity_reserved, provider_updated_at, last_seen_at
     from inventory_items
     where company_id = $1 and location_id = $2
       and source_provider <> 'local'
       and (catalog_part_id = $3 or normalized_part_number = $4)
     order by id
     for update`,
    [companyId, locationId, catalogPartId, normalizedPartNumber],
  );
  const odoo = await client.query(
    `select id, catalog_part_id, uom_code, external_id, quantity_on_hand,
            provider_updated_at, last_seen_at
     from odoo_inventory_balances
     where company_id = $1 and location_id = $2
       and (catalog_part_id = $3 or normalized_part_number = $4)
     order by id
     for update`,
    [companyId, locationId, catalogPartId, normalizedPartNumber],
  );
  const sources = [
    ...legacy.rows.map((row) => ({ sourceKind: "legacy_inventory_item", row })),
    ...odoo.rows.map((row) => ({ sourceKind: "odoo_balance", row })),
  ];
  const unmatched = sources.find(({ row }) => (
    row.catalog_part_id !== catalogPartId || row.uom_code !== uomCode
  ));
  if (unmatched) return { kind: "unmatched_identity", source: unmatched, sources };
  const reserved = sources.find(({ sourceKind, row }) => (
    sourceKind === "legacy_inventory_item" && Number(row.quantity_reserved) > 0
  ));
  if (reserved) return { kind: "reservation_blocked", source: reserved, sources };
  return { kind: "claimable", sources };
}

export async function recordInventoryAuthorityException(client, {
  claim,
  companyId,
  locationId,
  catalogPartId,
  normalizedPartNumber,
  uomCode,
}) {
  const { sourceKind, row } = claim.source;
  await client.query(
    `insert into inventory_authority_exceptions (
       company_id, location_id, requested_catalog_part_id,
       requested_normalized_part_number, requested_uom_code,
       state, source_kind, inventory_item_id, odoo_balance_id, details
     ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10::jsonb)
     on conflict do nothing`,
    [companyId, locationId, catalogPartId, normalizedPartNumber, uomCode,
      claim.kind, sourceKind,
      sourceKind === "legacy_inventory_item" ? row.id : null,
      sourceKind === "odoo_balance" ? row.id : null,
      JSON.stringify({
        sourceCatalogPartId: row.catalog_part_id,
        quantityOnHand: Number(row.quantity_on_hand),
        quantityReserved: Number(row.quantity_reserved || 0),
      })],
  );
}

export async function recordInventoryAuthorityCutover(client, {
  claim,
  companyId,
  locationId,
  catalogPartId,
  receiptId,
  receiptLineId,
}) {
  for (const { sourceKind, row } of claim.sources) {
    await client.query(
      `insert into inventory_authority_cutovers (
         company_id, location_id, catalog_part_id, inventory_item_id,
         receipt_id, receipt_line_id, previous_source_provider,
         previous_external_id, previous_quantity_on_hand,
         previous_quantity_reserved, previous_provider_updated_at,
         previous_last_seen_at, source_kind, odoo_balance_id, resolution_state
       ) values ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12,$13,$14,'superseded')
       on conflict do nothing`,
      [companyId, locationId, catalogPartId,
        sourceKind === "legacy_inventory_item" ? row.id : null,
        receiptId, receiptLineId,
        sourceKind === "legacy_inventory_item" ? row.source_provider : "odoo",
        row.external_id || "", row.quantity_on_hand, row.quantity_reserved || 0,
        row.provider_updated_at, row.last_seen_at, sourceKind,
        sourceKind === "odoo_balance" ? row.id : null],
    );
    if (sourceKind === "legacy_inventory_item") {
      await client.query(
        `update inventory_items
         set normalized_part_number = 'LEGACY-PROVIDER-' || id::text,
             source_provider = case when source_provider = 'odoo'
               then 'odoo_legacy_reference' else source_provider end,
             external_id = 'legacy:' || id::text,
             quantity_on_hand = quantity_reserved,
             provider_updated_at = null, last_seen_at = null, updated_at = now()
         where company_id = $1 and id = $2 and source_provider <> 'local'`,
        [companyId, row.id],
      );
    }
    await client.query(
      `update inventory_authority_exceptions
       set resolved_at = now(), last_seen_at = now()
       where company_id = $1 and resolved_at is null
         and (($2::uuid is not null and inventory_item_id = $2)
           or ($3::uuid is not null and odoo_balance_id = $3))`,
      [companyId,
        sourceKind === "legacy_inventory_item" ? row.id : null,
        sourceKind === "odoo_balance" ? row.id : null],
    );
  }
}
