import { getPool, query } from "../../db/pool.js";
import { requireCompanyId } from "../../db/company.js";
import { normalizePartNumber } from "../../modules/parts/part.constants.js";
import {
  readIntegrationCredentialForProvider,
  saveIntegrationCredential,
} from "../core/integration-credentials.repo.js";
import { appendIntegrationAudit } from "../core/integration-platform.repo.js";
import { IntegrationHttpError } from "../core/integration-errors.js";

const PROVIDER = "odoo";

function outboundAdminError(code, message, statusCode = 400) {
  return new IntegrationHttpError(statusCode, code, message);
}

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
  return readIntegrationCredentialForProvider({
    companyId,
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

function relationExternalId(value) {
  return Array.isArray(value) ? String(value[0] || "") : String(value || "");
}

function relationDisplayName(value) {
  return Array.isArray(value) ? String(value[1] || "") : "";
}

export async function upsertOdooOutboundDiscovery(companyId, discovery) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  const vehicles = (discovery.vehicles || []).map((vehicle) => ({
    external_id: String(vehicle.id),
    display_name: String(vehicle.display_name || vehicle.name || ""),
    unit_number: String(vehicle.unit_number || ""),
    vin: String(vehicle.vin || vehicle.vin_sn || ""),
    license_plate: String(vehicle.license_plate || ""),
    customer_external_id: relationExternalId(vehicle.partner_id),
    customer_display_name: relationDisplayName(vehicle.partner_id),
    active: vehicle.active !== false,
    provider_updated_at: vehicle.write_date || null,
  }));
  const warehouses = (discovery.warehouses || []).map((warehouse) => ({
    external_id: String(warehouse.id),
    display_name: String(warehouse.name || warehouse.display_name || ""),
    code: String(warehouse.code || ""),
    stock_location_external_id: relationExternalId(warehouse.lot_stock_id),
    active: warehouse.active !== false,
    provider_updated_at: warehouse.write_date || null,
  }));
  const uoms = new Map((discovery.uoms || []).map((uom) => [String(uom.id), uom]));
  const serviceProducts = (discovery.serviceProducts || []).map((product) => {
    const uomExternalId = relationExternalId(product.uom_id);
    const uom = uoms.get(uomExternalId) || {};
    return {
      external_id: String(product.id),
      default_code: String(product.default_code || ""),
      display_name: String(product.name || product.display_name || ""),
      product_type: String(product.detailed_type || product.type || "service"),
      uom_external_id: uomExternalId,
      uom_name: String(uom.name || relationDisplayName(product.uom_id)),
      uom_category_external_id: relationExternalId(uom.category_id),
      uom_category_name: relationDisplayName(uom.category_id),
      active: product.active !== false,
      provider_updated_at: product.write_date || null,
    };
  });
  try {
    await client.query("begin");
    if (vehicles.length) {
      await client.query(
        `insert into odoo_vehicles (
           company_id, external_id, display_name, unit_number, vin, license_plate,
           customer_external_id, customer_display_name, active, provider_updated_at,
           last_seen_at, updated_at
         )
         select $1, source.external_id, source.display_name, source.unit_number,
                source.vin, source.license_plate, source.customer_external_id,
                source.customer_display_name, source.active, source.provider_updated_at,
                now(), now()
         from jsonb_to_recordset($2::jsonb) as source(
           external_id text, display_name text, unit_number text, vin text,
           license_plate text, customer_external_id text, customer_display_name text,
           active boolean, provider_updated_at timestamptz
         )
         on conflict (company_id, external_id) do update
         set display_name = excluded.display_name,
             unit_number = excluded.unit_number,
             vin = excluded.vin,
             license_plate = excluded.license_plate,
             customer_external_id = excluded.customer_external_id,
             customer_display_name = excluded.customer_display_name,
             active = excluded.active,
             provider_updated_at = excluded.provider_updated_at,
             last_seen_at = now(), updated_at = now()`,
        [tenantId, JSON.stringify(vehicles)],
      );
    }
    await client.query(
      `update odoo_vehicles set active = false, updated_at = now()
       where company_id = $1 and not (external_id = any($2::text[]))`,
      [tenantId, vehicles.map((item) => item.external_id)],
    );
    if (warehouses.length) {
      await client.query(
        `insert into odoo_warehouses (
           company_id, external_id, display_name, code, stock_location_external_id,
           active, provider_updated_at, last_seen_at, updated_at
         )
         select $1, source.external_id, source.display_name, source.code,
                source.stock_location_external_id, source.active,
                source.provider_updated_at, now(), now()
         from jsonb_to_recordset($2::jsonb) as source(
           external_id text, display_name text, code text, stock_location_external_id text,
           active boolean, provider_updated_at timestamptz
         )
         on conflict (company_id, external_id) do update
         set display_name = excluded.display_name, code = excluded.code,
             stock_location_external_id = excluded.stock_location_external_id,
             active = excluded.active, provider_updated_at = excluded.provider_updated_at,
             last_seen_at = now(), updated_at = now()`,
        [tenantId, JSON.stringify(warehouses)],
      );
    }
    await client.query(
      `update odoo_warehouses set active = false, updated_at = now()
       where company_id = $1 and not (external_id = any($2::text[]))`,
      [tenantId, warehouses.map((item) => item.external_id)],
    );
    if (serviceProducts.length) {
      await client.query(
        `insert into odoo_service_products (
           company_id, external_id, default_code, display_name, product_type,
           uom_external_id, uom_name, uom_category_external_id, uom_category_name,
           active, provider_updated_at, last_seen_at, updated_at
         )
         select $1, source.external_id, source.default_code, source.display_name,
                source.product_type, source.uom_external_id, source.uom_name,
                source.uom_category_external_id, source.uom_category_name,
                source.active, source.provider_updated_at, now(), now()
         from jsonb_to_recordset($2::jsonb) as source(
           external_id text, default_code text, display_name text, product_type text,
           uom_external_id text, uom_name text, uom_category_external_id text,
           uom_category_name text, active boolean, provider_updated_at timestamptz
         )
         on conflict (company_id, external_id) do update
         set default_code = excluded.default_code, display_name = excluded.display_name,
             product_type = excluded.product_type, uom_external_id = excluded.uom_external_id,
             uom_name = excluded.uom_name,
             uom_category_external_id = excluded.uom_category_external_id,
             uom_category_name = excluded.uom_category_name, active = excluded.active,
             provider_updated_at = excluded.provider_updated_at,
             last_seen_at = now(), updated_at = now()`,
        [tenantId, JSON.stringify(serviceProducts)],
      );
    }
    await client.query(
      `update odoo_service_products set active = false, updated_at = now()
       where company_id = $1 and not (external_id = any($2::text[]))`,
      [tenantId, serviceProducts.map((item) => item.external_id)],
    );
    await appendIntegrationAudit({
      client,
      companyId: tenantId,
      provider: "odoo",
      action: "outbound.discovery_refreshed",
      actorType: "system",
      targetType: "integration",
      targetId: "odoo",
      details: {
        vehicleCount: vehicles.length,
        warehouseCount: warehouses.length,
        serviceProductCount: serviceProducts.length,
      },
    });
    await client.query("commit");
    return { vehicleCount: vehicles.length, warehouseCount: warehouses.length, serviceProductCount: serviceProducts.length };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function listOdooOutboundAdminReadiness(companyId) {
  const tenantId = requireCompanyId(companyId);
  const [summary, mappingData, products] = await Promise.all([
    query(
      `select
         (select count(*)::int from odoo_vehicles vehicle
          where vehicle.company_id = $1 and vehicle.mapping_status = 'mapped' and vehicle.active) confirmed_vehicles,
         (select count(*)::int from assets asset where asset.company_id = $1) total_assets,
         (select count(*)::int from assets asset
          where asset.company_id = $1 and exists (
            select 1 from integration_mappings mapping
            where mapping.company_id = asset.company_id and mapping.provider = 'odoo'
              and mapping.entity_type = 'vehicle_exclusion'
              and mapping.internal_id = asset.id::text and mapping.status = 'disabled'
          )) ignored_assets,
         setting.labor_product_external_id, setting.labor_uom_external_id,
         setting.active, product.default_code, product.display_name,
         product.product_type, product.uom_external_id, product.uom_name,
         product.uom_category_name, product.active product_active
       from (select 1) seed
       left join odoo_service_order_settings setting on setting.company_id = $1
       left join odoo_service_products product
         on product.company_id = setting.company_id
        and product.external_id = setting.labor_product_external_id`,
      [tenantId],
    ),
    query(
      `select
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'external_id', warehouse.external_id,
             'display_name', warehouse.display_name,
             'code', warehouse.code,
             'active', warehouse.active,
             'assigned', exists(
               select 1 from odoo_location_warehouse_mappings mapping
               where mapping.company_id = warehouse.company_id
                 and mapping.warehouse_external_id = warehouse.external_id
             )
           ) order by warehouse.active desc, warehouse.display_name, warehouse.external_id)
           from odoo_warehouses warehouse where warehouse.company_id = $1
         ), '[]'::jsonb) warehouses,
         coalesce((
           select jsonb_agg(jsonb_build_object(
             'id', location.id, 'name', location.name, 'type', location.type,
             'address', coalesce(location.address, ''),
             'warehouse_external_id', mapping.warehouse_external_id,
             'warehouse_name', warehouse.display_name,
             'warehouse_code', warehouse.code,
             'warehouse_active', warehouse.active
           ) order by location.name, location.id)
           from locations location
           left join odoo_location_warehouse_mappings mapping
             on mapping.company_id = location.company_id and mapping.location_id = location.id
           left join odoo_warehouses warehouse
             on warehouse.company_id = mapping.company_id
            and warehouse.external_id = mapping.warehouse_external_id
           where location.company_id = $1 and location.active = true
         ), '[]'::jsonb) locations`,
      [tenantId],
    ),
    query(
      `select external_id, default_code, display_name, product_type, uom_external_id,
              uom_name, uom_category_name, active
       from odoo_service_products where company_id = $1 and active = true
       order by (upper(default_code) = 'PTR001') desc, default_code, display_name, external_id
       limit 200`,
      [tenantId],
    ),
  ]);
  const locationRows = mappingData.rows[0]?.locations || [];
  const warehouseRows = mappingData.rows[0]?.warehouses || [];
  const labor = summary.rows[0]?.labor_product_external_id ? summary.rows[0] : null;
  const laborReady = Boolean(
    labor?.active
    && labor?.product_active
    && String(labor.product_type).toLowerCase() === "service"
    && String(labor.labor_uom_external_id) === String(labor.uom_external_id)
    && /^hours?$/i.test(String(labor.uom_name || ""))
    && /time/i.test(String(labor.uom_category_name || "")),
  );
  const confirmedVehicles = Number(summary.rows[0]?.confirmed_vehicles || 0);
  const totalAssets = Number(summary.rows[0]?.total_assets || 0);
  const ignoredAssets = Number(summary.rows[0]?.ignored_assets || 0);
  const confirmedWarehouses = locationRows.filter((row) => row.warehouse_external_id && row.warehouse_active).length;
  const readiness = {
    state: confirmedVehicles + ignoredAssets === totalAssets
      && confirmedWarehouses === locationRows.length
      && laborReady ? "ready" : "needs_setup",
    vehicles: {
      confirmedCount: confirmedVehicles,
      ignoredCount: ignoredAssets,
      unresolvedCount: Math.max(0, totalAssets - confirmedVehicles - ignoredAssets),
    },
    warehouses: {
      confirmedCount: confirmedWarehouses,
      unresolvedCount: Math.max(0, locationRows.length - confirmedWarehouses),
      available: warehouseRows.map((row) => ({
        externalId: row.external_id,
        name: row.display_name,
        code: row.code,
        active: row.active,
        assigned: row.assigned,
      })),
      items: locationRows.map((row) => ({
        location: { id: row.id, name: row.name, type: row.type, address: row.address || "" },
        status: row.warehouse_external_id && row.warehouse_active ? "mapped" : "unmatched",
        mapping: row.warehouse_external_id ? {
          externalId: row.warehouse_external_id,
          displayName: row.warehouse_name || "",
        } : null,
        candidates: warehouseRows.filter((warehouse) => warehouse.active).map((warehouse) => ({
          externalId: warehouse.external_id,
          name: warehouse.display_name,
          code: warehouse.code,
          assigned: warehouse.assigned,
        })),
      })),
    },
    labor: {
      status: laborReady ? "ready" : labor ? "uom_warning" : "unresolved",
      productExternalId: labor?.labor_product_external_id || "",
      code: labor?.default_code || "",
      name: labor?.display_name || "",
      uomExternalId: labor?.labor_uom_external_id || "",
      uomName: labor?.uom_name || "",
      warning: labor && !laborReady ? "The labor product must be an active service product using a verified time UoM." : "",
      products: products.rows.map((product) => ({
        externalId: product.external_id,
        code: product.default_code,
        name: product.display_name,
        type: product.product_type,
        uomExternalId: product.uom_external_id,
        uomName: product.uom_name,
        uomCategoryName: product.uom_category_name,
        active: product.active,
      })),
    },
  };
  return readiness;
}

export async function listOdooOutboundVehicleMappings(companyId, input) {
  const tenantId = requireCompanyId(companyId);
  const values = [tenantId, input.q || "", input.status, input.limit + 1, input.cursor];
  const result = await query(
    `with page as (
       select asset.id, asset.unit_no, asset.name, asset.unit_type, asset.vin, asset.license_plate
       from assets asset
       left join odoo_vehicles mapped
         on mapped.company_id = asset.company_id and mapped.app_asset_id = asset.id
        and mapped.mapping_status = 'mapped'
       left join integration_mappings exclusion
         on exclusion.company_id = asset.company_id and exclusion.provider = 'odoo'
        and exclusion.entity_type = 'vehicle_exclusion'
        and exclusion.internal_id = asset.id::text and exclusion.status = 'disabled'
       where asset.company_id = $1
         and ($2 = '' or concat_ws(' ', asset.unit_no, asset.name, asset.vin, asset.license_plate) ilike '%' || $2 || '%')
         and ($3 = 'all'
           or ($3 = 'mapped' and mapped.id is not null)
           or ($3 = 'ignored' and exclusion.id is not null)
           or ($3 = 'unmatched' and mapped.id is null and exclusion.id is null))
       order by coalesce(asset.unit_no, asset.name, ''), asset.id
       limit $4 offset $5
     )
     select page.*,
            mapped.external_id mapped_external_id, mapped.display_name mapped_display_name,
            exclusion.id exclusion_id,
            coalesce(candidates.items, '[]'::jsonb) candidates
     from page
     left join odoo_vehicles mapped
       on mapped.company_id = $1 and mapped.app_asset_id = page.id and mapped.mapping_status = 'mapped'
     left join integration_mappings exclusion
       on exclusion.company_id = $1 and exclusion.provider = 'odoo'
      and exclusion.entity_type = 'vehicle_exclusion'
      and exclusion.internal_id = page.id::text and exclusion.status = 'disabled'
     left join lateral (
       select jsonb_agg(candidate.item order by candidate.display_name, candidate.external_id) items
       from (
         select vehicle.display_name, vehicle.external_id, jsonb_build_object(
           'externalId', vehicle.external_id, 'name', vehicle.display_name,
           'unitNumber', vehicle.unit_number, 'vin', vehicle.vin,
           'licensePlate', vehicle.license_plate, 'suggestionBasis',
           case
             when btrim(page.vin) <> '' and upper(regexp_replace(vehicle.vin, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(page.vin, '[^A-Za-z0-9]', '', 'g')) then 'vin'
             when btrim(page.license_plate) <> '' and upper(regexp_replace(vehicle.license_plate, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(page.license_plate, '[^A-Za-z0-9]', '', 'g')) then 'license_plate'
             else 'unit_number'
           end
         ) item
         from odoo_vehicles vehicle
         where vehicle.company_id = $1 and vehicle.active
           and vehicle.mapping_status <> 'ignored'
           and (
             (btrim(page.vin) <> '' and upper(regexp_replace(vehicle.vin, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(page.vin, '[^A-Za-z0-9]', '', 'g')))
             or (btrim(page.license_plate) <> '' and upper(regexp_replace(vehicle.license_plate, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(page.license_plate, '[^A-Za-z0-9]', '', 'g')))
             or (btrim(page.unit_no) <> '' and upper(regexp_replace(vehicle.unit_number, '[^A-Za-z0-9]', '', 'g')) = upper(regexp_replace(page.unit_no, '[^A-Za-z0-9]', '', 'g')))
           )
         order by vehicle.display_name, vehicle.external_id
         limit 10
       ) candidate
     ) candidates on true
     order by coalesce(page.unit_no, page.name, ''), page.id`,
    values,
  );
  const hasMore = result.rows.length > input.limit;
  const rows = result.rows.slice(0, input.limit);
  return {
    items: rows.map((row) => ({
      asset: {
        id: row.id,
        unitNo: row.unit_no || "",
        name: row.name || "",
        unitType: row.unit_type || "",
        vin: row.vin || "",
        licensePlate: row.license_plate || "",
      },
      status: row.mapped_external_id ? "mapped" : row.exclusion_id ? "ignored" : "unmatched",
      mapping: row.mapped_external_id ? {
        externalId: row.mapped_external_id,
        displayName: row.mapped_display_name || "",
      } : null,
      candidates: row.candidates || [],
    })),
    nextCursor: hasMore ? input.cursor + input.limit : null,
  };
}

export async function listOdooOutboundProviderVehicles(companyId, input) {
  const tenantId = requireCompanyId(companyId);
  const result = await query(
    `select vehicle.external_id, vehicle.display_name, vehicle.unit_number,
            vehicle.vin, vehicle.license_plate,
            vehicle.mapping_status = 'mapped' as assigned
     from odoo_vehicles vehicle
     where vehicle.company_id = $1 and vehicle.active
       and vehicle.mapping_status <> 'ignored'
       and ($2 = '' or concat_ws(
         ' ', vehicle.external_id, vehicle.display_name, vehicle.unit_number,
         vehicle.vin, vehicle.license_plate
       ) ilike '%' || $2 || '%')
     order by vehicle.mapping_status = 'mapped', vehicle.display_name, vehicle.external_id
     limit $3`,
    [tenantId, input.q || "", input.limit],
  );
  return {
    items: result.rows.map((vehicle) => ({
      externalId: vehicle.external_id,
      name: vehicle.display_name || "",
      unitNumber: vehicle.unit_number || "",
      vin: vehicle.vin || "",
      licensePlate: vehicle.license_plate || "",
      assigned: vehicle.assigned,
    })),
  };
}

export async function setOdooOutboundVehicleMapping(companyId, assetId, input, actor) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const asset = await client.query(
      `select id from assets where company_id = $1 and id = $2 for update`,
      [tenantId, assetId],
    );
    if (!asset.rows[0]) throw new Error("Asset was not found for this company.");
    const current = await client.query(
      `select external_id from odoo_vehicles
       where company_id = $1 and app_asset_id = $2 and mapping_status = 'mapped' for update`,
      [tenantId, assetId],
    );
    await client.query(
      `update odoo_vehicles
       set app_asset_id = null, mapping_status = 'unmatched', confirmed_by_user_id = null,
           confirmed_at = null, updated_at = now()
       where company_id = $1 and app_asset_id = $2 and mapping_status = 'mapped'`,
      [tenantId, assetId],
    );
    await client.query(
      `delete from integration_mappings
       where company_id = $1 and provider = 'odoo' and entity_type = 'vehicle_exclusion'
         and internal_id = $2::text`,
      [tenantId, assetId],
    );
    if (input.status === "ignored") {
      await client.query(
        `insert into integration_mappings (
           company_id, provider, entity_type, internal_id, external_id, status, metadata, updated_at
         ) values ($1, 'odoo', 'vehicle_exclusion', $2::text, $2::text, 'disabled', '{}'::jsonb, now())`,
        [tenantId, assetId],
      );
    }
    if (input.status === "mapped") {
      const mapped = await client.query(
        `update odoo_vehicles
         set app_asset_id = $3, suggested_asset_id = null, suggestion_basis = '',
             mapping_status = 'mapped', confirmed_by_user_id = $4,
             confirmed_at = now(), updated_at = now()
         where company_id = $1 and external_id = $2 and active = true
           and (mapping_status <> 'mapped' or app_asset_id = $3)
         returning external_id, display_name`,
        [tenantId, input.externalId, assetId, actor.userId],
      );
      if (!mapped.rows[0]) {
        throw outboundAdminError(
          "ODOO_VEHICLE_MAPPING_CONFLICT",
          "The Odoo vehicle is inactive, missing, or already confirmed for another unit.",
          409,
        );
      }
    }
    await appendIntegrationAudit({
      client, companyId: tenantId, provider: "odoo", action: "outbound.vehicle_mapping_changed",
      actorType: "user", actorId: actor.userId, targetType: "asset", targetId: assetId,
      requestId: actor.requestId || null,
      details: { previousExternalId: current.rows[0]?.external_id || "", status: input.status, externalId: input.externalId || "" },
    });
    await client.query("commit");
    return { assetId, status: input.status, externalId: input.externalId || "" };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      throw outboundAdminError("ODOO_VEHICLE_MAPPING_CONFLICT", "That unit or Odoo vehicle is already mapped.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function setOdooOutboundWarehouseMapping(companyId, locationId, input, actor) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const location = await client.query(
      `select id from locations where company_id = $1 and id = $2 and active = true for update`,
      [tenantId, locationId],
    );
    if (!location.rows[0]) throw new Error("Location was not found for this company.");
    const previous = await client.query(
      `select warehouse_external_id from odoo_location_warehouse_mappings
       where company_id = $1 and location_id = $2 for update`,
      [tenantId, locationId],
    );
    await client.query(
      `delete from odoo_location_warehouse_mappings where company_id = $1 and location_id = $2`,
      [tenantId, locationId],
    );
    if (input.status === "mapped") {
      const warehouse = await client.query(
        `select external_id from odoo_warehouses
         where company_id = $1 and external_id = $2 and active = true for update`,
        [tenantId, input.externalId],
      );
      if (!warehouse.rows[0]) throw new Error("Active Odoo warehouse was not found.");
      await client.query(
        `insert into odoo_location_warehouse_mappings (
           company_id, location_id, warehouse_external_id, confirmed_by_user_id
         ) values ($1, $2, $3, $4)`,
        [tenantId, locationId, input.externalId, actor.userId],
      );
    }
    await appendIntegrationAudit({
      client, companyId: tenantId, provider: "odoo", action: "outbound.warehouse_mapping_changed",
      actorType: "user", actorId: actor.userId, targetType: "location", targetId: locationId,
      requestId: actor.requestId || null,
      details: { previousExternalId: previous.rows[0]?.warehouse_external_id || "", status: input.status, externalId: input.externalId || "" },
    });
    await client.query("commit");
    return { locationId, status: input.status, externalId: input.externalId || "" };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") {
      throw outboundAdminError("ODOO_WAREHOUSE_MAPPING_CONFLICT", "That Odoo warehouse is already mapped.", 409);
    }
    throw error;
  } finally {
    client.release();
  }
}

export async function setOdooOutboundLaborProduct(companyId, productExternalId, actor) {
  const tenantId = requireCompanyId(companyId);
  const client = await getPool().connect();
  try {
    await client.query("begin");
    const product = await client.query(
      `select external_id, uom_external_id, display_name, uom_name, uom_category_name
       from odoo_service_products
       where company_id = $1 and external_id = $2 and active = true for update`,
      [tenantId, productExternalId],
    );
    if (!product.rows[0]) throw new Error("Active Odoo service product was not found.");
    const account = await client.query(
      `select id from integration_accounts where company_id = $1 and provider = 'odoo' limit 1`,
      [tenantId],
    );
    if (!account.rows[0]) throw new Error("Configure the Odoo connection first.");
    await client.query(
      `insert into odoo_service_order_settings (
         company_id, integration_account_id, labor_product_external_id,
         labor_uom_external_id, updated_at
       ) values ($1, $2, $3, $4, now())
       on conflict (company_id) do update
       set integration_account_id = excluded.integration_account_id,
           labor_product_external_id = excluded.labor_product_external_id,
           labor_uom_external_id = excluded.labor_uom_external_id,
           active = true, updated_at = now()`,
      [tenantId, account.rows[0].id, product.rows[0].external_id, product.rows[0].uom_external_id],
    );
    await appendIntegrationAudit({
      client, companyId: tenantId, provider: "odoo", action: "outbound.labor_product_changed",
      actorType: "user", actorId: actor.userId, targetType: "integration", targetId: "odoo",
      requestId: actor.requestId || null,
      details: {
        productExternalId: product.rows[0].external_id,
        productName: product.rows[0].display_name,
        uomName: product.rows[0].uom_name,
        uomCategoryName: product.rows[0].uom_category_name,
      },
    });
    await client.query("commit");
    return { productExternalId: product.rows[0].external_id };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
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
