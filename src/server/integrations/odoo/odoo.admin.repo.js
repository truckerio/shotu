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
