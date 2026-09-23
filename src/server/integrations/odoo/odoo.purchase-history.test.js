import assert from "node:assert/strict";
import test from "node:test";
import { readFile } from "node:fs/promises";
import { randomUUID } from "node:crypto";
import { after } from "node:test";
import { closePool, query } from "../../db/pool.js";
import { getInventoryPartCommercial, getInventoryPartPricingSource } from "../../db/repositories/inventory-part-prices.repo.js";
import { importOdooPurchaseHistory } from "./odoo.purchase-history.repo.js";
import { importOdooInventory } from "./odoo.admin.repo.js";

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === "1";
after(async () => { if (runPostgres) await closePool(); });

test("Odoo purchase snapshots are company-scoped, idempotent, and quantity read-only", async () => {
  const [migration, repository] = await Promise.all([
    readFile(new URL("../../db/migrations/170_odoo_purchase_history.sql", import.meta.url), "utf8"),
    readFile(new URL("./odoo.purchase-history.repo.js", import.meta.url), "utf8"),
  ]);
  assert.match(migration, /unique \(company_id, external_id\)/i);
  assert.match(migration, /references parts_catalog\(company_id, id\)/i);
  assert.match(migration, /never inventory quantity authority/i);
  assert.match(repository, /from odoo_product_mappings where company_id=\$1/i);
  assert.match(repository, /on conflict \(company_id,external_id\) do update/i);
  assert.match(repository, /delete from odoo_purchase_history_orders[\s\S]*company_id=\$1/i);
  assert.doesNotMatch(repository, /insert into inventory_items|update inventory_items|inventory_stock_movements/i);
});

test("real PostgreSQL refreshes Odoo purchase history idempotently and exposes mapped part prices", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = randomUUID();
  const partId = randomUUID();
  const payload = (price) => ({
    orders: [{ id: 71, name: "P00071", state: "purchase", partner_id: [9, "Fleet Supplier"], currency_id: [1, "USD"], date_order: "2026-09-01", date_approve: "2026-09-02", amount_total: 25, write_date: "2026-09-03" }],
    lines: [{ id: 711, order_id: [71, "P00071"], sequence: 10, product_id: [501, "Filter"], name: "Filter", product_qty: 2, qty_received: 1, qty_invoiced: 0, product_uom: [1, "ea"], price_unit: price, price_subtotal: price * 2, price_total: price * 2, write_date: "2026-09-03" }],
    activeOrderIds: ["71"],
  });
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Odoo purchase integration')", [companyId, `odoo-purchase-${suffix}`]);
    await query("insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code) values($1,$2,$3,$4,'Filter','ea')", [partId, companyId, `FILTER${suffix}`, `FILTER-${suffix}`]);
    await query("insert into odoo_product_mappings(company_id,external_id,catalog_part_id,default_code,display_name,internal_price,internal_currency,selling_price,selling_currency,commercial_updated_at) values($1,'501',$2,$3,'Filter',7.25,'USD',19.5,'USD','2026-09-03')", [companyId, partId, `FILTER-${suffix}`]);
    assert.equal((await importOdooPurchaseHistory(companyId, payload(12.5))).mappedLineCount, 1);
    assert.equal((await importOdooPurchaseHistory(companyId, payload(13.25))).purchaseLineCount, 1);
    const counts = await query("select (select count(*) from odoo_purchase_history_orders where company_id=$1)::int orders,(select count(*) from odoo_purchase_history_lines where company_id=$1)::int lines", [companyId]);
    assert.deepEqual(counts.rows[0], { orders: 1, lines: 1 });
    const commercial = await getInventoryPartCommercial({ catalogPartId: partId, companyIds: [companyId], isAdmin: true });
    assert.equal(commercial.purchaseOrders.latest.orderNumber, "P00071");
    assert.equal(commercial.purchaseOrders.latest.vendorName, "Fleet Supplier");
    assert.equal(commercial.purchaseOrders.latest.unitCost, "13.2500");
    assert.equal(commercial.odooPrices.internal.amount, "7.2500");
    assert.equal(commercial.odooPrices.selling.amount, "19.5000");
    const pricingSource = await getInventoryPartPricingSource({ catalogPartId: partId, companyIds: [companyId], isAdmin: true, kind: "selling" });
    assert.equal(pricingSource.price.source, "odoo_catalog");
    assert.equal(pricingSource.price.amount, "19.5000");
  } finally {
    await query("delete from odoo_purchase_history_orders where company_id=$1", [companyId]).catch(() => {});
    await query("delete from odoo_product_mappings where company_id=$1", [companyId]).catch(() => {});
    await query("delete from parts_catalog where company_id=$1", [companyId]).catch(() => {});
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
  }
});

test("real PostgreSQL catalog sync persists Odoo commercial snapshots idempotently", { skip: !runPostgres }, async () => {
  const suffix = randomUUID().replaceAll("-", "");
  const companyId = randomUUID();
  const productId = Math.floor(Math.random() * 1_000_000) + 1_000_000;
  const product = (standardPrice, sellingPrice) => ({
    id: productId, default_code: `PRICE-${suffix}`, name: "Commercial filter", active: true,
    uom_id: [1, "Units"], categ_id: [1, "Parts"], detailed_type: "product",
    standard_price: standardPrice, lst_price: sellingPrice,
    cost_currency_id: [1, "USD"], currency_id: [1, "USD"], write_date: "2026-09-22 12:00:00",
  });
  try {
    await query("insert into companies(id,slug,name) values($1,$2,'Odoo commercial integration')", [companyId, `odoo-commercial-${suffix}`]);
    assert.equal((await importOdooInventory(companyId, { products: [product(8.5, 21.25)] })).changedCount, 1);
    assert.equal((await importOdooInventory(companyId, { products: [product(9, 22)] })).changedCount, 1);
    const mapping = await query("select catalog_part_id,internal_price,internal_currency,selling_price,selling_currency from odoo_product_mappings where company_id=$1 and external_id=$2", [companyId, String(productId)]);
    assert.equal(mapping.rows.length, 1);
    assert.deepEqual(mapping.rows[0], { catalog_part_id: mapping.rows[0].catalog_part_id, internal_price: "9.0000", internal_currency: "USD", selling_price: "22.0000", selling_currency: "USD" });
  } finally {
    await query("delete from companies where id=$1", [companyId]).catch(() => {});
  }
});
