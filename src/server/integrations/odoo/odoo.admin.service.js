import { createOdooClient } from "./odoo.client.js";
import {
  importOdooInventory,
  listOdooLocationMappings,
  odooAdminStatus,
  readOdooConfiguration,
  saveOdooConfiguration,
  setOdooLocationMapping,
  upsertDiscoveredOdooLocations,
} from "./odoo.admin.repo.js";

async function configuredClient(companyId) {
  const configuration = await readOdooConfiguration(companyId);
  if (!configuration) throw new Error("Configure the Odoo.sh connection first.");
  return createOdooClient(configuration);
}

export async function configureOdoo(companyId, configuration) {
  const client = createOdooClient(configuration);
  await client.authenticate();
  await saveOdooConfiguration(companyId, configuration);
  return odooAdminStatus(companyId);
}

export async function testOdoo(companyId) {
  const client = await configuredClient(companyId);
  const uid = await client.authenticate();
  return { ok: true, uid };
}

export async function discoverOdooLocations(companyId) {
  const client = await configuredClient(companyId);
  const records = await client.searchReadAll("stock.location", [["usage", "=", "internal"]], [
    "id", "name", "complete_name", "display_name", "active", "write_date",
  ]);
  await upsertDiscoveredOdooLocations(companyId, records);
  return listOdooLocationMappings(companyId);
}

export async function syncOdooPartsAndInventory(companyId) {
  const client = await configuredClient(companyId);
  await discoverOdooLocations(companyId);
  const [products, quants] = await Promise.all([
    client.searchReadAll("product.product", [["active", "=", true]], [
      "id", "default_code", "barcode", "name", "categ_id", "uom_id", "write_date",
    ]),
    client.searchReadAll("stock.quant", [["location_id.usage", "=", "internal"]], [
      "id", "product_id", "location_id", "quantity", "reserved_quantity", "write_date",
    ]),
  ]);
  return importOdooInventory(companyId, { products, quants });
}

export { listOdooLocationMappings, odooAdminStatus, setOdooLocationMapping };
