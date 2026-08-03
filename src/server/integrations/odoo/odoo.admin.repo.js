import { getPool, query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";
import {
  readIntegrationCredential,
  saveIntegrationCredential,
} from "../core/integration-credentials.repo.js";

const PROVIDER = "odoo";

export async function saveOdooConfiguration(companyId, configuration) {
  const tenantId = requireCompanyId(companyId);
  const accountResult = await query(
    `insert into integration_accounts (company_id, provider, status, token_env_key, updated_at)
     values ($1, $2, 'configured', 'ENCRYPTED_DATABASE_CREDENTIAL', now())
     on conflict (company_id, provider) do update
     set status = 'configured', token_env_key = excluded.token_env_key, updated_at = now()
     returning id`,
    [tenantId, PROVIDER],
  );
  const accountId = accountResult.rows[0].id;
  await saveIntegrationCredential({
    companyId: tenantId,
    integrationAccountId: accountId,
    provider: PROVIDER,
    credentialKind: "api",
    secret: configuration,
    metadata: {
      baseUrl: configuration.baseUrl,
      database: configuration.database,
      username: configuration.username,
    },
  });
  return accountId;
}

export async function readOdooConfiguration(companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select id from integration_accounts where company_id = $1 and provider = $2 limit 1`,
    [tenantId, PROVIDER],
  );
  if (!result.rows[0]) return null;
  return readIntegrationCredential({
    companyId: tenantId,
    integrationAccountId: result.rows[0].id,
    provider: PROVIDER,
    credentialKind: "api",
  });
}

export async function odooAdminStatus(companyId) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select account.status, account.last_full_sync_at, account.updated_at,
            credential.metadata,
            count(location.id)::int as location_count,
            count(location.id) filter (where location.mapping_status = 'mapped')::int as mapped_count,
            count(location.id) filter (where location.mapping_status = 'unmatched')::int as unmatched_count
     from integration_accounts account
     left join integration_credentials credential
       on credential.integration_account_id = account.id and credential.credential_kind = 'api'
     left join odoo_inventory_locations location
       on location.company_id = account.company_id
     where account.company_id = $1 and account.provider = $2
     group by account.id, credential.metadata`,
    [tenantId, PROVIDER],
  );
  const row = result.rows[0];
  return row ? {
    configured: true,
    status: row.status,
    baseUrl: row.metadata?.baseUrl || "",
    database: row.metadata?.database || "",
    username: row.metadata?.username || "",
    locationCount: row.location_count,
    mappedCount: row.mapped_count,
    unmatchedCount: row.unmatched_count,
    lastSyncAt: row.last_full_sync_at,
  } : { configured: false, status: "disconnected", locationCount: 0, mappedCount: 0, unmatchedCount: 0 };
}

export async function upsertDiscoveredOdooLocations(companyId, records) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    for (const record of records) {
      await client.query(
        `insert into odoo_inventory_locations (
           company_id, external_id, display_name, complete_name, active,
           provider_updated_at, last_seen_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (company_id, external_id) do update
         set display_name = excluded.display_name,
             complete_name = excluded.complete_name,
             active = excluded.active,
             provider_updated_at = excluded.provider_updated_at,
             last_seen_at = now(),
             updated_at = now()`,
        [tenantId, String(record.id), record.name, record.complete_name || record.display_name || record.name, record.active !== false, record.write_date || null],
      );
    }
    await client.query("commit");
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listOdooLocationMappings(companyId) {
  const tenantId = requireCompanyId(companyId);
  const [odoo, locations] = await Promise.all([
    query(
      `select external_id, display_name, complete_name, active, app_location_id,
              mapping_status, last_seen_at
       from odoo_inventory_locations
       where company_id = $1
       order by (mapping_status = 'unmatched') desc, complete_name, external_id`,
      [tenantId],
    ),
    query(
      `select id, name, type, address from locations
       where company_id = $1 and active = true order by name, id`,
      [tenantId],
    ),
  ]);
  return {
    items: odoo.rows.map((row) => ({
      externalId: row.external_id,
      displayName: row.display_name,
      completeName: row.complete_name,
      active: row.active,
      locationId: row.app_location_id,
      status: row.mapping_status,
      lastSeenAt: row.last_seen_at,
    })),
    appLocations: locations.rows,
  };
}

export async function setOdooLocationMapping(companyId, externalId, input) {
  const tenantId = requireCompanyId(companyId);
  const locationId = input.status === "mapped" ? input.locationId : null;
  const result = await query(
    `update odoo_inventory_locations source
     set app_location_id = $3, mapping_status = $4, updated_at = now()
     where source.company_id = $1 and source.external_id = $2
       and ($3::uuid is null or exists (
         select 1 from locations target
         where target.id = $3 and target.company_id = $1 and target.active = true
       ))
     returning external_id`,
    [tenantId, externalId, locationId, input.status],
  );
  if (!result.rows[0]) throw new Error("Odoo location or selected app location was not found.");
  return listOdooLocationMappings(tenantId);
}

function relationId(value) {
  return Array.isArray(value) ? String(value[0]) : String(value || "");
}

function relationName(value) {
  return Array.isArray(value) ? String(value[1] || "") : "";
}

function odooLineKind(line, product, mapping) {
  if (line.display_type === "line_section") return "section";
  if (line.display_type === "line_note") return "note";
  const type = String(product?.detailed_type || product?.type || "").toLowerCase();
  if (type === "service") return "service";
  if (["product", "consu", "consumable", "goods"].includes(type)) return "goods";
  const productName = String(product?.name || relationName(line.product_id) || "");
  if (/\b(?:labor|labour|service)(?:\s+hours?)?\b/i.test(productName)) return "service";
  if (mapping?.catalog_part_id) return "goods";
  return product ? "other" : "other";
}

export function repairTextFromOdooLine(line, product = {}) {
  const description = String(line?.name || "").replace(/\r/g, "").trim();
  if (!description) return "";
  const segments = description.split("\n").map((value) => value.trim()).filter(Boolean);
  const productName = String(product.name || relationName(line.product_id) || "").trim();
  const first = segments[0].replace(/^\[[^\]]+\]\s*/, "").trim();
  const bareProductName = productName.replace(/^\[[^\]]+\]\s*/, "").trim();
  const productHeader = /^(labor(?: hours?)?|service)$/i.test(first)
    || (bareProductName && first.localeCompare(bareProductName, undefined, { sensitivity: "accent" }) === 0);
  if (segments.length > 1) {
    const repairSegments = productHeader ? segments.slice(1) : segments;
    return repairSegments.join(" ").replace(/\s+/g, " ").trim();
  }
  const generic = first;
  if (!generic || /^(labor(?: hours?)?|service)$/i.test(generic)) return "";
  return generic;
}

export async function importOdooServiceHistory(companyId, {
  orders,
  lines,
  products = [],
  activeOrderIds = null,
}) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  const productById = new Map(products.map((product) => [String(product.id), product]));
  let importedLineCount = 0;
  let contextCount = 0;
  try {
    await client.query("begin");
    const mappingResult = await client.query(
      `select mapping.external_id, mapping.catalog_part_id,
              catalog.part_number, catalog.normalized_part_number
       from odoo_product_mappings mapping
       join parts_catalog catalog
         on catalog.company_id = mapping.company_id and catalog.id = mapping.catalog_part_id
       where mapping.company_id = $1`,
      [tenantId],
    );
    const mappings = new Map(mappingResult.rows.map((row) => [row.external_id, row]));
    const historyOrderIds = new Map();
    let removedCount = 0;
    if (Array.isArray(activeOrderIds)) {
      const removed = await client.query(
        `delete from service_history_orders
         where company_id = $1 and source_provider = 'odoo'
           and not (external_id = any($2::text[]))`,
        [tenantId, activeOrderIds.map(String)],
      );
      removedCount = removed.rowCount;
    }
    if (!orders.length) {
      await client.query("commit");
      return {
        historyOrderCount: 0,
        historyLineCount: 0,
        historyContextCount: 0,
        historyRemovedCount: removedCount,
      };
    }
    const orderRows = orders.map((order) => ({
      external_id: String(order.id),
      reference: order.name || `Odoo ${order.id}`,
      status: order.state || "",
      ordered_at: order.date_order || null,
      completed_at: order.effective_date || order.commitment_date || null,
      source_updated_at: order.write_date || null,
      raw_metadata: order,
    }));
    const savedOrders = await client.query(
      `insert into service_history_orders (
         company_id, source_provider, external_id, reference, status,
         ordered_at, completed_at, source_updated_at, raw_metadata,
         last_seen_at, updated_at
       )
       select $1, 'odoo', source.external_id, source.reference, source.status,
              source.ordered_at, source.completed_at, source.source_updated_at,
              source.raw_metadata, now(), now()
       from jsonb_to_recordset($2::jsonb) as source(
         external_id text, reference text, status text, ordered_at timestamptz,
         completed_at timestamptz, source_updated_at timestamptz, raw_metadata jsonb
       )
       on conflict (company_id, source_provider, external_id) do update
       set reference = excluded.reference,
           status = excluded.status,
           ordered_at = excluded.ordered_at,
           completed_at = excluded.completed_at,
           source_updated_at = excluded.source_updated_at,
           raw_metadata = excluded.raw_metadata,
           last_seen_at = now(),
           updated_at = now()
       returning external_id, id`,
      [tenantId, JSON.stringify(orderRows)],
    );
    for (const row of savedOrders.rows) historyOrderIds.set(row.external_id, row.id);

    const groupedLines = new Map();
    for (const line of lines) {
      const orderExternalId = relationId(line.order_id);
      if (!historyOrderIds.has(orderExternalId)) continue;
      const current = groupedLines.get(orderExternalId) || [];
      current.push(line);
      groupedLines.set(orderExternalId, current);
    }

    for (const order of orders) {
      const orderExternalId = String(order.id);
      const serviceOrderId = historyOrderIds.get(orderExternalId);
      const orderLines = (groupedLines.get(orderExternalId) || [])
        .sort((left, right) => Number(left.sequence || 0) - Number(right.sequence || 0) || Number(left.id) - Number(right.id));
      await client.query(
        `delete from service_history_lines where company_id = $1 and service_order_id = $2`,
        [tenantId, serviceOrderId],
      );
      await client.query(
        `delete from part_repair_history
         where company_id = $1 and service_order_id = $2 and source_provider = 'odoo'`,
        [tenantId, serviceOrderId],
      );

      const imported = [];
      const lineRows = [];
      for (let index = 0; index < orderLines.length; index += 1) {
        const line = orderLines[index];
        const productExternalId = relationId(line.product_id);
        const product = productById.get(productExternalId);
        const mapping = mappings.get(productExternalId);
        const kind = odooLineKind(line, product, mapping);
        const partNumber = mapping?.part_number || product?.default_code || product?.barcode || "";
        lineRows.push({
          external_id: String(line.id),
          sequence: Number(line.sequence || 0),
          line_index: index,
          line_kind: kind,
          product_external_id: productExternalId,
          catalog_part_id: mapping?.catalog_part_id || null,
          part_number: partNumber,
          normalized_part_number: mapping?.normalized_part_number || normalizePartNumber(partNumber),
          product_name: product?.name || relationName(line.product_id),
          description: line.name || "",
          quantity: line.product_uom_qty ?? null,
          uom: relationName(line.product_uom),
          source_updated_at: line.write_date || null,
          raw_payload: line,
        });
        imported.push({ line, index, kind, product, mapping, partNumber });
        importedLineCount += 1;
      }
      if (lineRows.length) {
        await client.query(
          `insert into service_history_lines (
             company_id, service_order_id, external_id, sequence, line_index,
             line_kind, product_external_id, catalog_part_id, part_number,
             normalized_part_number, product_name, description, quantity, uom,
             source_updated_at, raw_payload
           )
           select $1, $2, source.external_id, source.sequence, source.line_index,
                  source.line_kind, source.product_external_id, source.catalog_part_id,
                  source.part_number, source.normalized_part_number, source.product_name,
                  source.description, source.quantity, source.uom,
                  source.source_updated_at, source.raw_payload
           from jsonb_to_recordset($3::jsonb) as source(
             external_id text, sequence numeric, line_index integer, line_kind text,
             product_external_id text, catalog_part_id uuid, part_number text,
             normalized_part_number text, product_name text, description text,
             quantity numeric, uom text, source_updated_at timestamptz, raw_payload jsonb
           )`,
          [tenantId, serviceOrderId, JSON.stringify(lineRows)],
        );
      }

      const repairCandidates = imported
        .filter((entry) => entry.kind === "service")
        .map((entry) => ({ ...entry, repairText: repairTextFromOdooLine(entry.line, entry.product) }))
        .filter((entry) => entry.repairText);
      const partLines = imported.filter((entry) => entry.kind === "goods"
        && (entry.mapping?.catalog_part_id || normalizePartNumber(entry.partNumber)));
      const contextRows = [];
      for (const partLine of partLines) {
        const nearestRepairCandidates = [...repairCandidates]
          .sort((left, right) => Math.abs(partLine.index - left.index) - Math.abs(partLine.index - right.index))
          .slice(0, 25);
        for (const repairLine of nearestRepairCandidates) {
          const distance = Math.abs(partLine.index - repairLine.index);
          const proximityScore = 1 / (1 + distance);
          const occurrenceKey = `${orderExternalId}:${partLine.line.id}:${repairLine.line.id}`;
          contextRows.push({
            occurrence_key: occurrenceKey,
            catalog_part_id: partLine.mapping?.catalog_part_id || null,
            normalized_part_number: partLine.mapping?.normalized_part_number || normalizePartNumber(partLine.partNumber),
            repair_text: repairLine.repairText,
            used_at: order.effective_date || order.commitment_date || order.date_order || order.write_date || null,
            evidence: {
              partLineExternalId: String(partLine.line.id),
              repairLineExternalId: String(repairLine.line.id),
              lineDistance: distance,
              proximityScore,
              relationship: "same_order_context",
            },
          });
          contextCount += 1;
        }
      }
      if (contextRows.length) {
        await client.query(
          `insert into part_repair_history (
             company_id, service_order_id, source_provider, occurrence_key,
             catalog_part_id, normalized_part_number, repair_text, confidence,
             used_at, evidence
           )
           select $1, $2, 'odoo', source.occurrence_key, source.catalog_part_id,
                  source.normalized_part_number, source.repair_text, 'context',
                  source.used_at, source.evidence
           from jsonb_to_recordset($3::jsonb) as source(
             occurrence_key text, catalog_part_id uuid, normalized_part_number text,
             repair_text text, used_at timestamptz, evidence jsonb
           )`,
          [tenantId, serviceOrderId, JSON.stringify(contextRows)],
        );
      }
    }

    await client.query("commit");
    return {
      historyOrderCount: orders.length,
      historyLineCount: importedLineCount,
      historyContextCount: contextCount,
      historyRemovedCount: removedCount,
    };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function importOdooInventory(companyId, { products, quants }) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  let changed = 0;
  try {
    await client.query("begin");
    const mappedResult = await client.query(
      `select external_id, app_location_id from odoo_inventory_locations
       where company_id = $1 and mapping_status = 'mapped' and app_location_id is not null`,
      [tenantId],
    );
    const mappedLocations = new Map(mappedResult.rows.map((row) => [row.external_id, row.app_location_id]));
    const unitsResult = await client.query(
      `select code, odoo_name, decimal_scale from units_of_measure where active = true`,
    );
    const unitCodes = new Map();
    for (const unit of unitsResult.rows) {
      const definition = { code: unit.code, decimalScale: Number(unit.decimal_scale) || 0 };
      unitCodes.set(String(unit.code).toLowerCase(), definition);
      if (unit.odoo_name) unitCodes.set(String(unit.odoo_name).toLowerCase(), definition);
    }
    const catalogIds = new Map();
    for (const product of products) {
      const partNumber = String(product.default_code || product.barcode || `ODOO-${product.id}`).trim();
      const normalized = normalizePartNumber(partNumber);
      const unit = unitCodes.get(relationName(product.uom_id).toLowerCase()) || { code: "ea", decimalScale: 0 };
      const catalog = await client.query(
        `insert into parts_catalog (
           company_id, normalized_part_number, part_number, description, category,
           uom_code, updated_at
         ) values ($1, $2, $3, $4, $5, $6, now())
         on conflict (company_id, normalized_part_number) do update
         set description = excluded.description,
             category = excluded.category,
             uom_code = excluded.uom_code,
             updated_at = now()
         returning id`,
        [tenantId, normalized, partNumber, product.name || partNumber, relationName(product.categ_id), unit.code],
      );
      await client.query(
        `insert into odoo_product_mappings (
           company_id, external_id, catalog_part_id, barcode, active,
           provider_updated_at, last_seen_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, now(), now())
         on conflict (company_id, external_id) do update
         set catalog_part_id = excluded.catalog_part_id,
             barcode = excluded.barcode,
             active = excluded.active,
             provider_updated_at = excluded.provider_updated_at,
             last_seen_at = now(),
             updated_at = now()`,
        [tenantId, String(product.id), catalog.rows[0].id, product.barcode || "", product.active !== false, product.write_date || null],
      );
      catalogIds.set(String(product.id), { id: catalog.rows[0].id, partNumber, normalized, description: product.name || partNumber, uomCode: unit.code, decimalScale: unit.decimalScale });
      changed += 1;
    }
    const balances = new Map();
    for (const quant of quants) {
      const key = `${relationId(quant.product_id)}:${relationId(quant.location_id)}`;
      const available = Math.max(0, Number(quant.available_quantity ?? (Number(quant.quantity || 0) - Number(quant.reserved_quantity || 0))));
      const current = balances.get(key) || { ...quant, available_quantity: 0 };
      current.available_quantity += available;
      if (quant.write_date && (!current.write_date || quant.write_date > current.write_date)) current.write_date = quant.write_date;
      balances.set(key, current);
    }
    for (const [externalId, quant] of balances) {
      const locationId = mappedLocations.get(relationId(quant.location_id));
      const product = catalogIds.get(relationId(quant.product_id));
      if (!locationId || !product) continue;
      const factor = 10 ** product.decimalScale;
      const available = Math.round(quant.available_quantity * factor) / factor;
      await client.query(
        `insert into inventory_items (
           company_id, location_id, catalog_part_id, normalized_part_number, part_number,
           description, quantity_on_hand, quantity_reserved, uom_code,
           source_provider, external_id, provider_updated_at, last_seen_at, updated_at
         ) values ($1, $2, $3, $4, $5, $6, $7, 0, $8, 'odoo', $9, $10, now(), now())
         on conflict (
           company_id,
           (coalesce(location_id, '00000000-0000-0000-0000-000000000000'::uuid)),
           normalized_part_number,
           uom_code
         )
         do update set
           location_id = excluded.location_id,
           catalog_part_id = excluded.catalog_part_id,
           normalized_part_number = excluded.normalized_part_number,
           part_number = excluded.part_number,
           description = excluded.description,
           uom_code = excluded.uom_code,
           quantity_on_hand = greatest(excluded.quantity_on_hand, inventory_items.quantity_reserved),
           provider_updated_at = excluded.provider_updated_at,
           last_seen_at = now(),
           updated_at = now()`,
        [tenantId, locationId, product.id, product.normalized, product.partNumber, product.description, available, product.uomCode, externalId, quant.write_date || null],
      );
      changed += 1;
    }
    await client.query(
      `update integration_accounts set status = 'connected', last_full_sync_at = now(), updated_at = now()
       where company_id = $1 and provider = 'odoo'`,
      [tenantId],
    );
    await client.query("commit");
    return { fetchedCount: products.length + quants.length, changedCount: changed, skippedUnmappedCount: quants.filter((quant) => !mappedLocations.has(relationId(quant.location_id))).length };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}
