import { query } from "../pool.js";
import { configuredLaborProduct, localLaborProductSnapshot } from "../../../../shared/labor-product.js";

function sourceUomCode(row) {
  if (/^hours?$/i.test(String(row?.uom_name || "").trim())
    && /time/i.test(String(row?.uom_category_name || ""))) return "hr";
  if (/^each$/i.test(String(row?.uom_name || "").trim())
    && /(unit|number|count)/i.test(String(row?.uom_category_name || ""))) return "ea";
  return null;
}

// Historical workorders store the Odoo identity. A source link is the only
// reliable bridge to the company-owned labor catalog; names and codes can drift.
export async function resolveLegacyLocalLaborProduct({ companyId, legacyProduct }, execute = query) {
  const externalId = String(legacyProduct?.externalId || "").trim();
  const uomCode = legacyProduct?.uomCode || "hr";
  if (!companyId || !externalId || !["hr", "ea"].includes(uomCode)) return null;
  const result = await execute(
    `select local.id, local.name, local.code, local.description, local.uom_code,
            source.uom_name, source.uom_category_name
       from local_labor_products local
       join odoo_service_products source
         on source.company_id=local.company_id
        and source.external_id=local.source_external_id
      where local.company_id=$1 and local.source_provider='odoo'
        and local.source_external_id=$2 and local.active=true
        and local.uom_code=$3 and source.active=true and source.product_type='service'
      limit 2`,
    [companyId, externalId, uomCode],
  );
  if (result.rows.length !== 1 || sourceUomCode(result.rows[0]) !== uomCode) return null;
  return localLaborProductSnapshot(result.rows[0]);
}

export async function getConfiguredLaborProduct(companyId, execute = query) {
  if (!companyId) return null;
  const result = await execute(
    `select product.external_id, product.default_code, product.display_name, product.product_type,
            product.uom_name, product.uom_category_name,
            local.id, local.name, local.code, local.description, local.uom_code
       from odoo_service_order_settings settings
       join odoo_service_products product
         on product.company_id = settings.company_id
        and product.external_id = settings.labor_product_external_id
       left join local_labor_products local
         on local.company_id=product.company_id
        and local.source_provider='odoo'
        and local.source_external_id=product.external_id
        and local.active=true
      where settings.company_id = $1
        and settings.active = true
        and product.active = true
      limit 1`,
    [companyId],
  );
  const row = result.rows[0];
  if (!row) return null;
  const uomCode = sourceUomCode(row);
  const local = localLaborProductSnapshot(row);
  if (local && row.product_type === "service" && local.uomCode === uomCode) return local;
  // Keep the configured provider identity for Odoo flows until imported.
  return { ...configuredLaborProduct(row), uomCode: uomCode || "hr" };
}
