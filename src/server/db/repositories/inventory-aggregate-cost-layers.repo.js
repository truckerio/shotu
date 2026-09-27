function number(value) {
  return Number(value || 0);
}

function batchPlacementConflict(message) {
  const error = new Error(message);
  error.code = "INVENTORY_BATCH_PLACEMENT_RECONCILIATION_REQUIRED";
  return error;
}

function publicAllocation(row) {
  return {
    costLayerId: row.cost_layer_id,
    receiptLineId: row.receipt_line_id || null,
    sourceKind: row.source_kind,
    quantity: String(row.quantity),
    uomCode: row.uom_code,
    unitCost: row.current_unit_cost === null ? null : String(row.current_unit_cost),
    currency: row.current_currency || null,
    costSource: row.current_cost_source || "unknown",
    receivedAt: row.received_at,
    receiptReference: row.receipt_reference || "",
    positionId: row.position_id || null,
  };
}

export async function recordAggregateCostLayerPosition(client, {
  companyId,
  locationId,
  costLayerId,
  positionId,
  quantity,
}) {
  if (!costLayerId || !positionId || number(quantity) <= 0) return;
  await client.query(
    `insert into inventory_aggregate_cost_layer_positions(
       company_id,cost_layer_id,location_id,position_id,quantity_on_hand
     ) values($1,$2,$3,$4,$5)
     on conflict(company_id,cost_layer_id,position_id) do update set
       quantity_on_hand=inventory_aggregate_cost_layer_positions.quantity_on_hand+excluded.quantity_on_hand,
       version=inventory_aggregate_cost_layer_positions.version+1,updated_at=now()`,
    [companyId, costLayerId, locationId, positionId, quantity],
  );
}

export async function moveAggregateCostLayerPositions(client, {
  companyId,
  locationId,
  catalogPartId,
  uomCode,
  fromPositionId,
  toPositionId,
  quantity,
}) {
  const rows = (await client.query(
    `select placement.*,layer.received_at
     from inventory_aggregate_cost_layer_positions placement
     join inventory_aggregate_cost_layers layer
       on layer.company_id=placement.company_id and layer.id=placement.cost_layer_id
     where placement.company_id=$1 and placement.location_id=$2 and placement.position_id=$3
       and layer.catalog_part_id=$4 and layer.uom_code=$5 and placement.quantity_on_hand>0
     order by layer.received_at,layer.id
     for update of placement,layer`,
    [companyId, locationId, fromPositionId, catalogPartId, uomCode],
  )).rows;
  if (!rows.length) {
    const tracked = await client.query(
      `select 1 from inventory_aggregate_cost_layer_positions placement
       join inventory_aggregate_cost_layers layer
         on layer.company_id=placement.company_id and layer.id=placement.cost_layer_id
       where placement.company_id=$1 and placement.location_id=$2
         and layer.catalog_part_id=$3 and layer.uom_code=$4 and placement.quantity_on_hand>0
       limit 1`,
      [companyId, locationId, catalogPartId, uomCode],
    );
    if (tracked.rows[0]) throw batchPlacementConflict("This position is missing batch lineage. Reconcile batch placement before moving stock.");
    return { kind: "unresolved" };
  }
  let remaining = number(quantity);
  for (const row of rows) {
    const available = number(row.quantity_on_hand) - number(row.quantity_reserved);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    await client.query(
      `update inventory_aggregate_cost_layer_positions
       set quantity_on_hand=quantity_on_hand-$4,version=version+1,updated_at=now()
       where company_id=$1 and cost_layer_id=$2 and position_id=$3`,
      [companyId, row.cost_layer_id, fromPositionId, take],
    );
    await client.query(
      `insert into inventory_aggregate_cost_layer_positions(
         company_id,cost_layer_id,location_id,position_id,quantity_on_hand
       ) values($1,$2,$3,$4,$5)
       on conflict(company_id,cost_layer_id,position_id) do update set
         quantity_on_hand=inventory_aggregate_cost_layer_positions.quantity_on_hand+excluded.quantity_on_hand,
         version=inventory_aggregate_cost_layer_positions.version+1,updated_at=now()`,
      [companyId, row.cost_layer_id, locationId, toPositionId, take],
    );
    remaining = Number((remaining - take).toFixed(3));
    if (remaining <= 0) break;
  }
  if (remaining > 0) throw batchPlacementConflict("Batch placement is lower than the movable stock at this position. Reconcile batch placement before moving stock.");
  return { kind: "moved" };
}

export async function recordAggregateReceiptCostLayer(client, {
  companyId,
  locationId,
  catalogPartId,
  receiptLineId,
  quantity,
  uomCode,
  unitCost,
  currency,
  costSource = "unknown",
  receivedAt = null,
}) {
  const result = await client.query(
    `insert into inventory_aggregate_cost_layers(
       company_id,location_id,catalog_part_id,receipt_line_id,source_kind,
       received_quantity,quantity_on_hand,uom_code,unit_cost,currency,cost_source,received_at
     ) values($1,$2,$3,$4,'receipt',$5,$5,$6,$7,$8,$9,coalesce($10,now()))
     on conflict(company_id,receipt_line_id) where receipt_line_id is not null do update set
       updated_at=inventory_aggregate_cost_layers.updated_at
     returning id`,
    [companyId, locationId, catalogPartId, receiptLineId, quantity, uomCode,
      unitCost, unitCost === null ? null : currency, costSource, receivedAt],
  );
  return result.rows[0]?.id || null;
}

async function lockedLayers(client, scope) {
  return (await client.query(
    `select layer.*,
            coalesce(revision.unit_cost,line.unit_cost,layer.unit_cost) current_unit_cost,
            coalesce(revision.currency,line.currency,layer.currency) current_currency,
            case when revision.id is not null then 'manual_correction'
              else coalesce(line.cost_source,layer.cost_source) end current_cost_source,
            coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),
              receipt.provider_picking_name,receipt.provider_marker,'') receipt_reference
     from inventory_aggregate_cost_layers layer
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
     where layer.company_id=$1 and layer.location_id=$2 and layer.catalog_part_id=$3 and layer.uom_code=$4
     order by layer.received_at,layer.id
     for update of layer`,
    [scope.companyId, scope.locationId, scope.catalogPartId, scope.uomCode],
  )).rows;
}

export async function reconcileAggregateCostLayers(client, scope) {
  let layers = await lockedLayers(client, scope);
  const recorded = layers.reduce((sum, layer) => sum + number(layer.quantity_on_hand), 0);
  let difference = Number((number(scope.quantityOnHand) - recorded).toFixed(3));
  if (difference > 0) {
    await client.query(
      `insert into inventory_aggregate_cost_layers(
         company_id,location_id,catalog_part_id,source_kind,received_quantity,
         quantity_on_hand,uom_code,cost_source,received_at
       ) values($1,$2,$3,'reconciliation',$5,$5,$4,'unknown',now())`,
      [scope.companyId, scope.locationId, scope.catalogPartId, scope.uomCode, difference],
    );
  } else if (difference < 0) {
    let remove = -difference;
    for (const layer of layers) {
      const available = number(layer.quantity_on_hand) - number(layer.quantity_reserved);
      if (available <= 0) continue;
      const take = Math.min(available, remove);
      await client.query(
        `update inventory_aggregate_cost_layers
         set quantity_on_hand=quantity_on_hand-$3,version=version+1,updated_at=now()
         where company_id=$1 and id=$2`,
        [scope.companyId, layer.id, take],
      );
      remove = Number((remove - take).toFixed(3));
      if (remove <= 0) break;
    }
    if (remove > 0) throw new Error("Aggregate cost layers conflict with reserved inventory.");
  }
  if (difference !== 0) layers = await lockedLayers(client, scope);
  return layers;
}

export async function reserveAggregateCostLayers(client, scope) {
  const layers = await reconcileAggregateCostLayers(client, scope);
  let remaining = number(scope.quantity);
  const positioned = scope.sourcePositionId ? (await client.query(
    `select placement.*,layer.received_at
     from inventory_aggregate_cost_layer_positions placement
     join inventory_aggregate_cost_layers layer
       on layer.company_id=placement.company_id and layer.id=placement.cost_layer_id
     where placement.company_id=$1 and placement.location_id=$2 and placement.position_id=$3
       and layer.catalog_part_id=$4 and layer.uom_code=$5 and placement.quantity_on_hand>placement.quantity_reserved
     order by layer.received_at,layer.id for update of placement,layer`,
    [scope.companyId, scope.locationId, scope.sourcePositionId, scope.catalogPartId, scope.uomCode],
  )).rows : [];
  const exactPositionCoverage = positioned.reduce(
    (sum, row) => sum + number(row.quantity_on_hand) - number(row.quantity_reserved), 0,
  ) >= remaining;
  if (!exactPositionCoverage) {
    const tracked = await client.query(
      `select 1 from inventory_aggregate_cost_layer_positions placement
       join inventory_aggregate_cost_layers layer
         on layer.company_id=placement.company_id and layer.id=placement.cost_layer_id
       where placement.company_id=$1 and placement.location_id=$2
         and layer.catalog_part_id=$3 and layer.uom_code=$4 and placement.quantity_on_hand>0
       limit 1`,
      [scope.companyId, scope.locationId, scope.catalogPartId, scope.uomCode],
    );
    if (tracked.rows[0]) throw batchPlacementConflict("The selected pickup position is missing exact batch quantity. Reconcile batch placement before reserving stock.");
  }
  const candidates = exactPositionCoverage ? positioned : layers;
  for (const layer of candidates) {
    const available = number(layer.quantity_on_hand) - number(layer.quantity_reserved);
    if (available <= 0) continue;
    const take = Math.min(available, remaining);
    await client.query(
      `update inventory_aggregate_cost_layers
       set quantity_reserved=quantity_reserved+$3,version=version+1,updated_at=now()
       where company_id=$1 and id=$2`,
      [scope.companyId, layer.cost_layer_id || layer.id, take],
    );
    if (exactPositionCoverage) await client.query(
      `update inventory_aggregate_cost_layer_positions
       set quantity_reserved=quantity_reserved+$4,version=version+1,updated_at=now()
       where company_id=$1 and cost_layer_id=$2 and position_id=$3`,
      [scope.companyId, layer.cost_layer_id, scope.sourcePositionId, take],
    );
    await client.query(
      `insert into inventory_aggregate_usage_cost_allocations(company_id,usage_id,cost_layer_id,quantity,position_id)
       values($1,$2,$3,$4,$5)`,
      [scope.companyId, scope.usageId, layer.cost_layer_id || layer.id, take,
        exactPositionCoverage ? scope.sourcePositionId : null],
    );
    remaining = Number((remaining - take).toFixed(3));
    if (remaining <= 0) break;
  }
  if (remaining > 0) throw new Error("FCFS cost layers are lower than available inventory.");
}

export async function pickAggregateCostLayers(client, { companyId, usageId }) {
  await client.query(
    `update inventory_aggregate_usage_cost_allocations
     set status='picked',updated_at=now()
     where company_id=$1 and usage_id=$2 and status='reserved'`,
    [companyId, usageId],
  );
}

export async function releaseAggregateCostLayers(client, { companyId, usageId }) {
  const allocations = (await client.query(
    `select * from inventory_aggregate_usage_cost_allocations
     where company_id=$1 and usage_id=$2 and status in ('reserved','picked')
     order by cost_layer_id for update`,
    [companyId, usageId],
  )).rows;
  for (const allocation of allocations) {
    await client.query(
      `update inventory_aggregate_cost_layers
       set quantity_reserved=quantity_reserved-$3,version=version+1,updated_at=now()
       where company_id=$1 and id=$2 and quantity_reserved >= $3`,
      [companyId, allocation.cost_layer_id, allocation.quantity],
    );
    if (allocation.position_id) await client.query(
      `update inventory_aggregate_cost_layer_positions
       set quantity_reserved=quantity_reserved-$4,version=version+1,updated_at=now()
       where company_id=$1 and cost_layer_id=$2 and position_id=$3 and quantity_reserved >= $4`,
      [companyId, allocation.cost_layer_id, allocation.position_id, allocation.quantity],
    );
  }
  await client.query(
    `update inventory_aggregate_usage_cost_allocations set status='released',updated_at=now()
     where company_id=$1 and usage_id=$2 and status in ('reserved','picked')`,
    [companyId, usageId],
  );
}

export async function consumeAggregateCostLayers(client, { companyId, usageId }) {
  const allocations = (await client.query(
    `select * from inventory_aggregate_usage_cost_allocations
     where company_id=$1 and usage_id=$2 and status='picked'
     order by cost_layer_id for update`,
    [companyId, usageId],
  )).rows;
  if (!allocations.length) throw new Error("Aggregate usage has no picked FCFS cost allocation.");
  for (const allocation of allocations) {
    const changed = await client.query(
      `update inventory_aggregate_cost_layers
       set quantity_on_hand=quantity_on_hand-$3,quantity_reserved=quantity_reserved-$3,
           version=version+1,updated_at=now()
       where company_id=$1 and id=$2 and quantity_on_hand >= $3 and quantity_reserved >= $3
       returning id`,
      [companyId, allocation.cost_layer_id, allocation.quantity],
    );
    if (!changed.rows[0]) throw new Error("Aggregate cost layer changed before consumption.");
    if (allocation.position_id) {
      const positioned = await client.query(
        `update inventory_aggregate_cost_layer_positions
         set quantity_on_hand=quantity_on_hand-$4,quantity_reserved=quantity_reserved-$4,
             version=version+1,updated_at=now()
         where company_id=$1 and cost_layer_id=$2 and position_id=$3
           and quantity_on_hand >= $4 and quantity_reserved >= $4 returning cost_layer_id`,
        [companyId, allocation.cost_layer_id, allocation.position_id, allocation.quantity],
      );
      if (!positioned.rows[0]) throw new Error("Batch position changed before consumption.");
    }
  }
  await client.query(
    `update inventory_aggregate_usage_cost_allocations set status='consumed',updated_at=now()
     where company_id=$1 and usage_id=$2 and status='picked'`,
    [companyId, usageId],
  );
}

export async function reverseAggregateCostLayers(client, { companyId, usageId }) {
  const allocations = (await client.query(
    `select * from inventory_aggregate_usage_cost_allocations
     where company_id=$1 and usage_id=$2 and status='consumed'
     order by cost_layer_id for update`,
    [companyId, usageId],
  )).rows;
  for (const allocation of allocations) {
    await client.query(
      `update inventory_aggregate_cost_layers
       set quantity_on_hand=quantity_on_hand+$3,version=version+1,updated_at=now()
       where company_id=$1 and id=$2`,
      [companyId, allocation.cost_layer_id, allocation.quantity],
    );
    if (allocation.position_id) await client.query(
      `insert into inventory_aggregate_cost_layer_positions(
         company_id,cost_layer_id,location_id,position_id,quantity_on_hand
       ) select $1,$2,position.location_id,$3,$4
         from inventory_positions position where position.company_id=$1 and position.id=$3
       on conflict(company_id,cost_layer_id,position_id) do update set
         quantity_on_hand=inventory_aggregate_cost_layer_positions.quantity_on_hand+excluded.quantity_on_hand,
         version=inventory_aggregate_cost_layer_positions.version+1,updated_at=now()`,
      [companyId, allocation.cost_layer_id, allocation.position_id, allocation.quantity],
    );
  }
  await client.query(
    `update inventory_aggregate_usage_cost_allocations set status='reversed',updated_at=now()
     where company_id=$1 and usage_id=$2 and status='consumed'`,
    [companyId, usageId],
  );
}

export async function adjustConsumedAggregateCostLayers(client, scope) {
  const delta = number(scope.quantityDelta);
  if (delta > 0) {
    const layers = await reconcileAggregateCostLayers(client, scope);
    let remaining = delta;
    for (const layer of layers) {
      const available = number(layer.quantity_on_hand) - number(layer.quantity_reserved);
      if (available <= 0) continue;
      const take = Math.min(available, remaining);
      await client.query(
        `update inventory_aggregate_cost_layers
         set quantity_on_hand=quantity_on_hand-$3,version=version+1,updated_at=now()
         where company_id=$1 and id=$2 and quantity_on_hand-quantity_reserved >= $3`,
        [scope.companyId, layer.id, take],
      );
      await client.query(
        `insert into inventory_aggregate_usage_cost_allocations(company_id,usage_id,cost_layer_id,quantity,status)
         values($1,$2,$3,$4,'consumed')
         on conflict(company_id,usage_id,cost_layer_id) do update set
           quantity=case when inventory_aggregate_usage_cost_allocations.status in ('released','reversed')
             then excluded.quantity else inventory_aggregate_usage_cost_allocations.quantity+excluded.quantity end,
           status='consumed',updated_at=now()`,
        [scope.companyId, scope.usageId, layer.id, take],
      );
      remaining = Number((remaining - take).toFixed(3));
      if (remaining <= 0) break;
    }
    if (remaining > 0) throw new Error("FCFS cost layers are insufficient for the adjustment.");
    return;
  }
  let restore = -delta;
  const allocations = (await client.query(
    `select allocation.*,layer.received_at
     from inventory_aggregate_usage_cost_allocations allocation
     join inventory_aggregate_cost_layers layer
       on layer.company_id=allocation.company_id and layer.id=allocation.cost_layer_id
     where allocation.company_id=$1 and allocation.usage_id=$2 and allocation.status='consumed'
     order by layer.received_at desc,layer.id desc for update of allocation,layer`,
    [scope.companyId, scope.usageId],
  )).rows;
  for (const allocation of allocations) {
    const giveBack = Math.min(number(allocation.quantity), restore);
    await client.query(
      `update inventory_aggregate_cost_layers
       set quantity_on_hand=quantity_on_hand+$3,version=version+1,updated_at=now()
       where company_id=$1 and id=$2`,
      [scope.companyId, allocation.cost_layer_id, giveBack],
    );
    if (allocation.position_id) await client.query(
      `insert into inventory_aggregate_cost_layer_positions(
         company_id,cost_layer_id,location_id,position_id,quantity_on_hand
       ) select $1,$2,position.location_id,$3,$4
         from inventory_positions position where position.company_id=$1 and position.id=$3
       on conflict(company_id,cost_layer_id,position_id) do update set
         quantity_on_hand=inventory_aggregate_cost_layer_positions.quantity_on_hand+excluded.quantity_on_hand,
         version=inventory_aggregate_cost_layer_positions.version+1,updated_at=now()`,
      [scope.companyId, allocation.cost_layer_id, allocation.position_id, giveBack],
    );
    if (giveBack === number(allocation.quantity)) {
      await client.query(
        `update inventory_aggregate_usage_cost_allocations set status='reversed',updated_at=now()
         where company_id=$1 and usage_id=$2 and cost_layer_id=$3`,
        [scope.companyId, scope.usageId, allocation.cost_layer_id],
      );
    } else {
      await client.query(
        `update inventory_aggregate_usage_cost_allocations set quantity=quantity-$4,updated_at=now()
         where company_id=$1 and usage_id=$2 and cost_layer_id=$3`,
        [scope.companyId, scope.usageId, allocation.cost_layer_id, giveBack],
      );
    }
    restore = Number((restore - giveBack).toFixed(3));
    if (restore <= 0) break;
  }
  if (restore > 0) throw new Error("Consumed FCFS allocations are lower than the requested correction.");
}

export async function listAggregateUsageCostAllocations(client, { companyId, usageId, statuses = ["reserved", "picked", "consumed"] }) {
  const result = await client.query(
    `select allocation.cost_layer_id,allocation.quantity,allocation.status,allocation.position_id,
            layer.receipt_line_id,layer.source_kind,layer.uom_code,layer.received_at,
            coalesce(revision.unit_cost,line.unit_cost,layer.unit_cost) current_unit_cost,
            coalesce(revision.currency,line.currency,layer.currency) current_currency,
            case when revision.id is not null then 'manual_correction'
              else coalesce(line.cost_source,layer.cost_source) end current_cost_source,
            coalesce(nullif(coalesce(run.reviewed_draft,run.extracted_draft) #>> '{invoiceNumber,value}',''),
              receipt.provider_picking_name,receipt.provider_marker,'') receipt_reference
     from inventory_aggregate_usage_cost_allocations allocation
     join inventory_aggregate_cost_layers layer
       on layer.company_id=allocation.company_id and layer.id=allocation.cost_layer_id
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
     where allocation.company_id=$1 and allocation.usage_id=$2 and allocation.status=any($3::varchar[])
     order by layer.received_at,layer.id`,
    [companyId, usageId, statuses],
  );
  return result.rows.map(publicAllocation);
}
