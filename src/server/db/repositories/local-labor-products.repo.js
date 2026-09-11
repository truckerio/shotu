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
  };
}

export async function listLocalLaborProducts({ companyId, locationId, q = "", limit = 50 }, execute = query) {
  const normalizedQuery = String(q || "").trim().toLowerCase();
  const result = await execute(
    `select product.id, product.name, product.code, product.description, product.uom_code,
            coalesce(pin.pinned, false) as pinned
       from local_labor_products product
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
            coalesce(pin.pinned, false) as pinned
       from local_labor_products product
       join locations location
         on location.company_id = product.company_id and location.id = $2 and location.active = true
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

export async function setLocalLaborProductPinned({ companyId, locationId, productId, pinned, actorId }, execute = query) {
  const result = await execute(
    `with selected as (
       select product.company_id, product.id, product.name, product.code, product.description, product.uom_code
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
     select selected.id, selected.name, selected.code, selected.description, selected.uom_code, changed.pinned
     from selected join changed on changed.labor_product_id = selected.id`,
    [companyId, locationId, productId, pinned, actorId],
  );
  return publicProduct(result.rows[0]);
}
