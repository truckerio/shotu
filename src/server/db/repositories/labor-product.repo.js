import { query } from "../pool.js";
import { configuredLaborProduct } from "../../../../shared/labor-product.js";

export async function getConfiguredLaborProduct(companyId, execute = query) {
  if (!companyId) return null;
  const result = await execute(
    `select product.external_id, product.default_code, product.display_name
       from odoo_service_order_settings settings
       join odoo_service_products product
         on product.company_id = settings.company_id
        and product.external_id = settings.labor_product_external_id
      where settings.company_id = $1
        and settings.active = true
        and product.active = true
      limit 1`,
    [companyId],
  );
  return configuredLaborProduct(result.rows[0]);
}
