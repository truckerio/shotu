import { getPool, query } from "../pool.js";
import { localLaborProductSnapshot } from "../../../../shared/labor-product.js";

function publicProduct(row) {
  const product = localLaborProductSnapshot(row);
  if (!product) return null;
  return {
    id: product.productId,
    name: product.name,
    code: product.code,
    uomCode: product.uomCode,
    ...(product.description ? { description: product.description } : {}),
    pinned: row.pinned === true,
    ...(row.source_external_id ? {
      source: { provider: row.source_provider, externalId: row.source_external_id },
      odooPricing: {
        internal: providerPrice(row.odoo_internal_price, row.odoo_internal_currency),
        selling: providerPrice(row.odoo_selling_price, row.odoo_selling_currency),
        updatedAt: row.odoo_commercial_updated_at || null,
      },
    } : {}),
  };
}

function providerPrice(amount, currency) {
  const normalizedCurrency = String(currency || "").trim().toUpperCase();
  const known = amount !== null && amount !== undefined && /^[A-Z]{3}$/.test(normalizedCurrency);
  return { status: known ? "known" : "unknown", amount: known ? String(amount) : null, currency: known ? normalizedCurrency : null };
}

export async function listLocalLaborProducts({ companyId, locationId, q = "", limit = 50 }, execute = query) {
  const normalizedQuery = String(q || "").trim().toLowerCase();
  const result = await execute(
    `select product.id, product.name, product.code, product.description, product.uom_code,
            product.source_provider, product.source_external_id,
            source.internal_price odoo_internal_price, source.internal_currency odoo_internal_currency,
            source.selling_price odoo_selling_price, source.selling_currency odoo_selling_currency,
            source.commercial_updated_at odoo_commercial_updated_at,
            coalesce(pin.pinned, false) as pinned
       from local_labor_products product
       left join odoo_service_products source
         on source.company_id=product.company_id and source.external_id=product.source_external_id
       left join local_labor_product_location_pins pin
         on pin.company_id = product.company_id
        and pin.location_id = $2
        and pin.labor_product_id = product.id
      where product.company_id = $1 and product.active = true
        and ($3 = '' or product.normalized_name like '%' || $3 || '%'
          or product.normalized_code like '%' || $3 || '%')
      order by coalesce(pin.pinned, false) desc, lower(product.name), lower(product.code), product.id
      limit $4`,
    [companyId, locationId, normalizedQuery, limit],
  );
  return result.rows.map(publicProduct).filter(Boolean);
}

export async function findActiveLocalLaborProduct({ companyId, locationId, productId }, execute = query) {
  const result = await execute(
    `select product.id, product.name, product.code, product.description, product.uom_code,
            product.source_provider, product.source_external_id,
            source.internal_price odoo_internal_price, source.internal_currency odoo_internal_currency,
            source.selling_price odoo_selling_price, source.selling_currency odoo_selling_currency,
            source.commercial_updated_at odoo_commercial_updated_at,
            coalesce(pin.pinned, false) as pinned
       from local_labor_products product
       join locations location
         on location.company_id = product.company_id and location.id = $2 and location.active = true
       left join odoo_service_products source
         on source.company_id=product.company_id and source.external_id=product.source_external_id
       left join local_labor_product_location_pins pin
         on pin.company_id = product.company_id
        and pin.location_id = location.id
        and pin.labor_product_id = product.id
      where product.company_id = $1 and product.id = $3 and product.active = true
      limit 1`,
    [companyId, locationId, productId],
  );
  return publicProduct(result.rows[0]);
}

export async function createLocalLaborProduct({ companyId, name, code = "", description = "", actorId }) {
  const client = await getPool().connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`local-labor-products:${companyId}`]);
    const normalizedName = name.trim().toLowerCase().replace(/\s+/g, " ");
    const normalizedCode = code.trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
    const normalizedDescription = description.trim();
    const conflict = await client.query(
      `select 1 from local_labor_products
        where company_id = $1 and active = true
          and (normalized_name = $2 or ($3 <> '' and normalized_code = $3))
        limit 1`,
      [companyId, normalizedName, normalizedCode],
    );
    if (conflict.rows[0]) {
      await client.query("rollback");
      return { kind: "duplicate" };
    }
    const inserted = await client.query(
      `insert into local_labor_products (
         company_id, name, normalized_name, code, normalized_code, description, created_by_user_id
       ) values ($1, $2, $3, $4, $5, $6, $7)
       returning id, name, code, description, uom_code, false as pinned`,
      [companyId, name, normalizedName, code, normalizedCode, normalizedDescription, actorId],
    );
    await client.query("commit");
    return { kind: "created", product: publicProduct(inserted.rows[0]) };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    if (error?.code === "23505") return { kind: "duplicate" };
    throw error;
  } finally {
    client.release();
  }
}

function normalizeLaborName(value) {
  return String(value || "").trim().toLowerCase().replace(/\s+/g, " ");
}

function normalizeLaborCode(value) {
  return String(value || "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "");
}

function hourlyOdooLaborSql() {
  return `product.product_type = 'service'
          and product.active = true
          and product.uom_name ~* '^hours?$'
          and product.uom_category_name ~* 'time'`;
}

/**
 * Copies explicitly chosen cached Odoo labor products into the application-owned
 * catalog and retains stable source linkage for commercial snapshot refreshes.
 * Existing local names/descriptions/pins remain application-owned.
 */
export async function importOdooLaborProducts({ companyId, externalIds, actorId = null }, connect = () => getPool().connect()) {
  const requestedIds = [...new Set((externalIds || []).map((id) => String(id || "").trim()).filter(Boolean))];
  if (!companyId) throw new Error("Company is required.");
  if (!requestedIds.length) throw new Error("Choose at least one Odoo labor product.");
  const client = await connect();
  try {
    await client.query("begin");
    await client.query("select pg_advisory_xact_lock(hashtext($1))", [`local-labor-products:${companyId}`]);
    const source = await client.query(
      `select product.external_id, product.display_name, product.default_code,
              product.internal_price, product.internal_currency,
              product.selling_price, product.selling_currency, product.commercial_updated_at
         from odoo_service_products product
        where product.company_id = $1
          and product.external_id = any($2::text[])
          and ${hourlyOdooLaborSql()}
        order by product.external_id`,
      [companyId, requestedIds],
    );
    if (source.rows.length !== requestedIds.length) {
      throw new Error("One or more selected Odoo labor products are not active hourly services for this company.");
    }
    const products = [];
    for (const sourceProduct of source.rows) {
      const name = String(sourceProduct.display_name || "").trim();
      const code = String(sourceProduct.default_code || "").trim();
      if (!name) throw new Error("An Odoo labor product is missing a name.");
      const normalizedName = normalizeLaborName(name);
      const normalizedCode = normalizeLaborCode(code);
      const inserted = await client.query(
        `insert into local_labor_products (
           company_id, name, normalized_name, code, normalized_code, created_by_user_id,
           source_provider, source_external_id
         ) values ($1, $2, $3, $4, $5, $6, 'odoo', $7)
         on conflict do nothing
         returning id, name, code, source_provider, source_external_id`,
        [companyId, name, normalizedName, code, normalizedCode, actorId, sourceProduct.external_id],
      );
      let existing = inserted.rows[0] || (await client.query(
        `select id, name, code, active, source_provider, source_external_id from local_labor_products
          where company_id = $1
            and ((source_provider='odoo' and source_external_id=$4)
              or normalized_name = $2 or ($3 <> '' and normalized_code = $3))
          order by case when source_provider='odoo' and source_external_id=$4 then 0 else 1 end, id
          limit 1`,
        [companyId, normalizedName, normalizedCode, sourceProduct.external_id],
      )).rows[0];
      if (!existing?.active && !inserted.rows[0]) {
        throw new Error(`Odoo labor product ${sourceProduct.external_id} conflicts with an inactive local labor product.`);
      }
      if (existing.source_external_id && existing.source_external_id !== sourceProduct.external_id) {
        throw new Error(`Odoo labor product ${sourceProduct.external_id} conflicts with a different linked local labor product.`);
      }
      if (!inserted.rows[0] && !existing.source_external_id) {
        existing = (await client.query(
          `update local_labor_products
           set source_provider='odoo', source_external_id=$3, updated_at=now()
           where company_id=$1 and id=$2 and source_provider is null and source_external_id is null
           returning id,name,code,active,source_provider,source_external_id`,
          [companyId, existing.id, sourceProduct.external_id],
        )).rows[0] || existing;
      }
      products.push({
        externalId: sourceProduct.external_id,
        productId: existing.id,
        created: Boolean(inserted.rows[0]),
      });
    }
    await client.query("commit");
    return { products };
  } catch (error) {
    await client.query("rollback").catch(() => {});
    throw error;
  } finally {
    client.release();
  }
}

export async function setLocalLaborProductPinned({ companyId, locationId, productId, pinned, actorId }, execute = query) {
  const result = await execute(
    `with selected as (
       select product.company_id, product.id, product.name, product.code, product.description, product.uom_code,
              product.source_provider, product.source_external_id
       from local_labor_products product
       join locations location
         on location.company_id = product.company_id and location.id = $2 and location.active = true
       where product.company_id = $1 and product.id = $3 and product.active = true
     ), changed as (
       insert into local_labor_product_location_pins (
         company_id, location_id, labor_product_id, pinned, updated_by_user_id, updated_at
       ) select company_id, $2, id, $4, $5, now() from selected
       on conflict (company_id, location_id, labor_product_id) do update
       set pinned = excluded.pinned, updated_by_user_id = excluded.updated_by_user_id, updated_at = now()
       returning labor_product_id, pinned
     )
     select selected.id, selected.name, selected.code, selected.description, selected.uom_code,
            selected.source_provider, selected.source_external_id,
            source.internal_price odoo_internal_price, source.internal_currency odoo_internal_currency,
            source.selling_price odoo_selling_price, source.selling_currency odoo_selling_currency,
            source.commercial_updated_at odoo_commercial_updated_at, changed.pinned
     from selected join changed on changed.labor_product_id = selected.id
     left join odoo_service_products source
       on source.company_id=selected.company_id and source.external_id=selected.source_external_id`,
    [companyId, locationId, productId, pinned, actorId],
  );
  return publicProduct(result.rows[0]);
}
