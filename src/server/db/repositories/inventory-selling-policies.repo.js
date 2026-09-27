import { getPool, query } from "../pool.js";

function publicPolicy(row) {
  return row && {
    id: row.id,
    locationId: row.location_id || null,
    catalogPartId: row.catalog_part_id,
    version: Number(row.version),
    method: row.method,
    value: String(row.value),
    currency: row.currency || null,
    reason: row.reason,
    effectiveAt: row.effective_at,
    createdBy: row.created_by ? { id: row.created_by, name: row.created_by_name || "" } : null,
  };
}

export async function getInventorySellingPolicy({
  catalogPartId,
  companyIds,
  locationIds = [],
  isAdmin = false,
  locationId = null,
}) {
  const result = await query(
    `select catalog.company_id catalog_company_id, policy.*, actor.display_name created_by_name,
            coalesce((
              select max(scoped.version)
              from inventory_part_selling_policy_versions scoped
              where scoped.company_id=catalog.company_id
                and scoped.catalog_part_id=catalog.id
                and scoped.location_id is not distinct from $3::uuid
            ),0) write_version
     from parts_catalog catalog
     left join locations location
       on location.company_id=catalog.company_id and location.id=$3 and location.active=true
     left join lateral (
       select candidate.*
       from inventory_part_selling_policy_versions candidate
       where candidate.company_id=catalog.company_id
         and candidate.catalog_part_id=catalog.id
         and (candidate.location_id is null or candidate.location_id=$3)
       order by (candidate.location_id is not null) desc,candidate.version desc
       limit 1
     ) policy on true
     left join user_profiles actor on actor.id=policy.created_by
     where catalog.id=$1 and catalog.company_id=any($2::uuid[])
       and ($3::uuid is null or location.id is not null)
       and ($3::uuid is null or $5::boolean or location.id=any($4::uuid[]))
     limit 1`,
    [catalogPartId, companyIds, locationId, locationIds, isAdmin],
  );
  if (!result.rows[0]) return null;
  const companyId = result.rows[0].catalog_company_id;
  const batches = await query(
    `with recursive position_tree as (
       select position.id,position.company_id,position.location_id,position.parent_id,
              position.code,position.name,position.usage,position.system_key,position.name::text path
       from inventory_positions position
       where position.company_id=$1 and position.parent_id is null
       union all
       select child.id,child.company_id,child.location_id,child.parent_id,
              child.code,child.name,child.usage,child.system_key,(tree.path||' / '||child.name)::text
       from inventory_positions child join position_tree tree
         on child.company_id=tree.company_id and child.location_id=tree.location_id and child.parent_id=tree.id
     )
     select layer.id,layer.location_id,location.name location_name,layer.receipt_line_id,
            layer.source_kind,layer.received_quantity,layer.quantity_on_hand,layer.quantity_reserved,
            layer.uom_code,coalesce(revision.unit_cost,line.unit_cost,layer.unit_cost) unit_cost,
            coalesce(revision.currency,line.currency,layer.currency) currency,
            case when revision.id is not null then 'manual_correction'
              else coalesce(line.cost_source,layer.cost_source) end cost_source,
            coalesce(revision.version,0) cost_version,revision.reason cost_reason,
            revision.effective_at cost_effective_at,layer.received_at,
            coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),
              receipt.provider_picking_name,receipt.provider_marker,'') receipt_reference,
            coalesce(placement.positions,'[]'::jsonb) positions,
            coalesce(placement.positioned_quantity,0) positioned_quantity
     from inventory_aggregate_cost_layers layer
     join locations location on location.company_id=layer.company_id and location.id=layer.location_id
     left join inventory_receipt_lines line
       on line.company_id=layer.company_id and line.id=layer.receipt_line_id
     left join lateral (
       select correction.*
       from inventory_aggregate_cost_layer_revisions correction
       where correction.company_id=layer.company_id and correction.cost_layer_id=layer.id
       order by correction.version desc limit 1
     ) revision on true
     left join inventory_receipts receipt
       on receipt.company_id=line.company_id and receipt.id=line.receipt_id
     left join invoice_extraction_runs run
       on run.company_id=receipt.company_id and run.id=receipt.invoice_run_id
     left join lateral (
       select jsonb_agg(jsonb_build_object(
                'positionId',position.id,
                'code',position.code,
                'name',position.name,
                'path',position.path,
                'usage',position.usage,
                'systemKey',position.system_key,
                'quantity',batch_position.quantity_on_hand::text,
                'reservedQuantity',batch_position.quantity_reserved::text
              ) order by position.path,position.id) positions,
              sum(batch_position.quantity_on_hand) positioned_quantity
       from inventory_aggregate_cost_layer_positions batch_position
       join position_tree position
         on position.company_id=batch_position.company_id and position.id=batch_position.position_id
       where batch_position.company_id=layer.company_id and batch_position.cost_layer_id=layer.id
         and batch_position.quantity_on_hand>0
     ) placement on true
     where layer.company_id=$1 and layer.catalog_part_id=$2 and layer.quantity_on_hand>0
       and ($3::uuid is null or layer.location_id=$3)
       and ($4::boolean or layer.location_id=any($5::uuid[]))
     order by layer.received_at,layer.id limit 50`,
    [companyId, catalogPartId, locationId, isAdmin, locationIds],
  );
  return {
    companyId,
    policy: publicPolicy(result.rows[0].id ? result.rows[0] : null),
    writeVersion: Number(result.rows[0].write_version),
    availableBatches: batches.rows.map((row) => ({
      costLayerId: row.id,
      locationId: row.location_id,
      locationName: row.location_name,
      receiptLineId: row.receipt_line_id || null,
      sourceKind: row.source_kind,
      receivedQuantity: String(row.received_quantity),
      onHandQuantity: String(row.quantity_on_hand),
      reservedQuantity: String(row.quantity_reserved),
      availableQuantity: String(Number(row.quantity_on_hand) - Number(row.quantity_reserved)),
      uomCode: row.uom_code,
      unitCost: row.unit_cost === null ? null : String(row.unit_cost),
      currency: row.currency || null,
      costSource: row.cost_source,
      costVersion: Number(row.cost_version || 0),
      costReason: row.cost_reason || "",
      costEffectiveAt: row.cost_effective_at || null,
      receivedAt: row.received_at,
      receiptReference: row.receipt_reference || "",
      placements: row.positions || [],
      placementStatus: Number(row.positioned_quantity) === Number(row.quantity_on_hand)
        ? "exact" : Number(row.positioned_quantity) > 0 ? "partial" : "unresolved",
    })),
  };
}

export async function appendInventorySellingPolicy(input) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const part = await client.query(
      `select catalog.company_id
       from parts_catalog catalog
       left join locations location
         on location.company_id=catalog.company_id and location.id=$3 and location.active=true
       where catalog.id=$1 and catalog.company_id=any($2::uuid[])
         and ($3::uuid is null or location.id is not null)
         and ($3::uuid is null or $5::boolean or location.id=any($4::uuid[]))
       limit 1`,
      [input.catalogPartId, input.companyIds, input.locationId, input.locationIds, input.isAdmin],
    );
    if (!part.rows[0]) {
      await client.query("rollback");
      return { kind: "not_found" };
    }
    const companyId = part.rows[0].company_id;
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [
      `selling-policy:${companyId}:${input.catalogPartId}:${input.locationId || "company"}`,
    ]);
    const replay = await client.query(
      `select * from inventory_part_selling_policy_versions
       where company_id=$1 and created_by=$2 and idempotency_key=$3
       limit 1`,
      [companyId, input.actorId, input.idempotencyKey],
    );
    if (replay.rows[0]) {
      await client.query("commit");
      return replay.rows[0].request_hash === input.requestHash
        ? { kind: "saved", policy: publicPolicy(replay.rows[0]), replayed: true }
        : { kind: "idempotency_conflict" };
    }
    const current = await client.query(
      `select id,version
       from inventory_part_selling_policy_versions
       where company_id=$1 and catalog_part_id=$2 and location_id is not distinct from $3::uuid
       order by version desc
       limit 1`,
      [companyId, input.catalogPartId, input.locationId],
    );
    const version = Number(current.rows[0]?.version || 0);
    if (version !== input.expectedVersion) {
      await client.query("rollback");
      return { kind: "stale", currentVersion: version };
    }
    const saved = await client.query(
      `insert into inventory_part_selling_policy_versions(
         company_id,location_id,catalog_part_id,version,method,value,currency,
         previous_version_id,reason,created_by,idempotency_key,request_hash
       ) values($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11,$12)
       returning *`,
      [
        companyId, input.locationId, input.catalogPartId, version + 1, input.method,
        input.value, input.currency, current.rows[0]?.id || null, input.reason,
        input.actorId, input.idempotencyKey, input.requestHash,
      ],
    );
    await client.query("commit");
    return { kind: "saved", policy: publicPolicy(saved.rows[0]), replayed: false };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
