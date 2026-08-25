import test from "node:test";
import assert from "node:assert/strict";
import { ensureOdooSerializedReceipt, inspectOdooReceipt } from "./odoo.receipts.js";

test("Odoo receipt readiness requires serial tracking and one mapped incoming route", async () => {
  const client = {
    execute: async (model, method) => {
      if (model === "product.product" && method === "read") return [{ id: 99, active: true, tracking: "none", display_name: "QA", uom_id: [1, "Each"] }];
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  await assert.rejects(
    inspectOdooReceipt(client, { locationExternalIds: ["471"], lines: [{ productExternalId: "99", partNumber: "QA-1" }] }),
    (error) => error.code === "ODOO_PRODUCT_NOT_SERIAL_TRACKED",
  );
});

test("Odoo receipt creation writes one move line per serial and validates to done", async () => {
  const calls = [];
  let pickingReads = 0;
  const serials = ["WG-QA-1", "WG-QA-2"];
  const client = {
    execute: async (model, method, args, kwargs) => {
      calls.push({ model, method, args, kwargs });
      if (model === "stock.picking" && method === "search_read") return [];
      if (model === "stock.picking" && method === "create") return 55;
      if (model === "stock.picking" && method === "read") {
        pickingReads += 1;
        if (pickingReads === 1) return [{ id: 55, name: "CHI/IN/QA", state: "draft", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [] }];
        if (pickingReads === 2) return [{ id: 55, name: "CHI/IN/QA", state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
        return [{ id: 55, name: "CHI/IN/QA", state: "done", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      }
      if (model === "stock.move" && method === "create") return [77];
      if (model === "stock.picking" && ["action_confirm", "button_validate"].includes(method)) return true;
      if (model === "stock.move.line" && method === "search_read") return [];
      if (model === "stock.move.line" && method === "create") return args[0].map((_, index) => 88 + index);
      if (model === "stock.lot" && method === "search_read") return serials.map((name, index) => ({ id: 900 + index, name, product_id: [99, "QA"] }));
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  const result = await ensureOdooSerializedReceipt(client, {
    marker: "WG-REC-1",
    context: {
      pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471,
      products: [{ lineIndex: 0, productExternalId: 99, productName: "QA", partNumber: "QA-1", quantity: 2, uomExternalId: 1, serials }],
    },
  });
  assert.equal(result.state, "done");
  assert.equal(result.lots.length, 2);
  const moveLines = calls.filter((call) => call.model === "stock.move.line" && call.method === "create");
  assert.equal(moveLines.length, 1);
  assert.deepEqual(moveLines.flatMap((call) => call.args[0].map((value) => value.lot_name)), serials);
  assert.ok(moveLines.flatMap((call) => call.args[0]).every((value) => value.quantity === 1));
  assert.equal(calls.filter((call) => call.model === "stock.picking" && call.method === "button_validate").length, 1);
});

test("Odoo receipt reuses provider-created blank serial allocations", async () => {
  const calls = [];
  let pickingReads = 0;
  const serials = ["WG-QA-BLANK-1", "WG-QA-BLANK-2"];
  const client = {
    execute: async (model, method, args, kwargs) => {
      calls.push({ model, method, args, kwargs });
      if (model === "stock.picking" && method === "search_read") {
        return [{ id: 55, name: "CHI/IN/QA", origin: "WG-REC-BLANK", state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      }
      if (model === "stock.move" && method === "read") {
        return [{ id: 77, product_id: [99, "QA"], product_uom_qty: 2, product_uom: [1, "Each"], move_line_ids: [88, 89], state: "assigned" }];
      }
      if (model === "stock.move.line" && method === "search_read") {
        return [
          { id: 88, move_id: [77, "QA"], product_id: [99, "QA"], lot_id: false, lot_name: false, quantity: 1 },
          { id: 89, move_id: [77, "QA"], product_id: [99, "QA"], lot_id: false, lot_name: false, quantity: 1 },
        ];
      }
      if (model === "stock.move.line" && method === "write") return true;
      if (model === "stock.picking" && method === "button_validate") return true;
      if (model === "stock.picking" && method === "read") {
        pickingReads += 1;
        return [{ id: 55, name: "CHI/IN/QA", state: pickingReads ? "done" : "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      }
      if (model === "stock.lot" && method === "search_read") return serials.map((name, index) => ({ id: 900 + index, name, product_id: [99, "QA"] }));
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  const result = await ensureOdooSerializedReceipt(client, {
    marker: "WG-REC-BLANK",
    context: {
      pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471,
      products: [{ productExternalId: 99, productName: "QA", partNumber: "QA-1", quantity: 2, uomExternalId: 1, serials }],
    },
  });
  assert.equal(result.state, "done");
  const writes = calls.filter((call) => call.model === "stock.move.line" && call.method === "write");
  assert.deepEqual(writes.map((call) => call.args), [
    [[88], { lot_name: serials[0], quantity: 1 }],
    [[89], { lot_name: serials[1], quantity: 1 }],
  ]);
  assert.equal(calls.some((call) => call.model === "stock.move.line" && call.method === "create"), false);
});

test("Odoo receipt rejects expected serials attached to the wrong product move", async () => {
  let wrote = false;
  const client = {
    execute: async (model, method) => {
      if (model === "stock.picking" && method === "search_read") return [{ id: 55, state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77, 78] }];
      if (model === "stock.move" && method === "read") return [
        { id: 77, product_id: [99, "A"], product_uom_qty: 1, move_line_ids: [88] },
        { id: 78, product_id: [100, "B"], product_uom_qty: 1, move_line_ids: [89] },
      ];
      if (model === "stock.picking" && method === "read") return [{ id: 55, state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77, 78] }];
      if (model === "stock.move.line" && method === "search_read") return [
        { id: 88, move_id: [77, "A"], product_id: [99, "A"], lot_id: false, lot_name: "WG-B-1", quantity: 1 },
        { id: 89, move_id: [78, "B"], product_id: [100, "B"], lot_id: false, lot_name: "WG-A-1", quantity: 1 },
      ];
      if (["create", "write", "button_validate"].includes(method)) wrote = true;
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  await assert.rejects(
    ensureOdooSerializedReceipt(client, {
      marker: "WG-REC-SWAP",
      context: {
        pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471,
        products: [
          { productExternalId: 99, quantity: 1, serials: ["WG-A-1"] },
          { productExternalId: 100, quantity: 1, serials: ["WG-B-1"] },
        ],
      },
    }),
    (error) => error.code === "ODOO_RECEIPT_MISMATCH",
  );
  assert.equal(wrote, false);
});

test("Odoo receipt rejects a returned lot linked to the wrong product", async () => {
  const client = {
    execute: async (model, method) => {
      if (model === "stock.picking" && method === "search_read") return [{ id: 55, state: "done", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      if (model === "stock.lot" && method === "search_read") return [{ id: 900, name: "WG-A-1", product_id: [100, "B"] }];
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  await assert.rejects(
    ensureOdooSerializedReceipt(client, {
      marker: "WG-REC-LOT-SWAP",
      context: { pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471, products: [{ productExternalId: 99, serials: ["WG-A-1"] }] },
    }),
    (error) => error.code === "ODOO_SERIAL_RECONCILIATION_REQUIRED",
  );
});

test("Odoo receipt replay reads an existing done marker without another create", async () => {
  const calls = [];
  const client = {
    execute: async (model, method) => {
      calls.push(`${model}.${method}`);
      if (model === "stock.picking" && method === "search_read") return [{ id: 55, name: "CHI/IN/QA", origin: "WG-REC-1", state: "done", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      if (model === "stock.lot" && method === "search_read") return [{ id: 900, name: "WG-QA-1", product_id: [99, "QA"] }];
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  const result = await ensureOdooSerializedReceipt(client, {
    marker: "WG-REC-1",
    context: { pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471, products: [{ productExternalId: 99, serials: ["WG-QA-1"] }] },
  });
  assert.equal(result.state, "done");
  assert.equal(calls.includes("stock.picking.create"), false);
  assert.equal(calls.includes("stock.picking.button_validate"), false);
});

test("Odoo serial creation is bounded to batches of 100", async () => {
  const serials = Array.from({ length: 205 }, (_, index) => `WG-BATCH-${index + 1}`);
  const batchSizes = [];
  let pickingReads = 0;
  const client = {
    execute: async (model, method, args) => {
      if (model === "stock.picking" && method === "search_read") return [];
      if (model === "stock.picking" && method === "create") return 55;
      if (model === "stock.picking" && method === "read") {
        pickingReads += 1;
        if (pickingReads === 1) return [{ id: 55, name: "CHI/IN/BATCH", state: "draft", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [] }];
        if (pickingReads === 2) return [{ id: 55, name: "CHI/IN/BATCH", state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
        return [{ id: 55, name: "CHI/IN/BATCH", state: "done", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [471, "CHI/Stock"], move_ids_without_package: [77] }];
      }
      if (model === "stock.move" && method === "create") return [77];
      if (model === "stock.picking" && ["action_confirm", "button_validate"].includes(method)) return true;
      if (model === "stock.move.line" && method === "search_read") return [];
      if (model === "stock.move.line" && method === "create") {
        batchSizes.push(args[0].length);
        return args[0].map((_, index) => 1000 + batchSizes.length * 100 + index);
      }
      if (model === "stock.lot" && method === "search_read") {
        return serials.map((name, index) => ({ id: 2000 + index, name, product_id: [99, "QA"] }));
      }
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  const result = await ensureOdooSerializedReceipt(client, {
    marker: "WG-REC-BATCH",
    context: {
      pickingTypeId: 245,
      sourceLocationId: 4,
      destinationLocationId: 471,
      products: [{ productExternalId: 99, productName: "QA", partNumber: "QA-1", quantity: 205, uomExternalId: 1, serials }],
    },
  });
  assert.equal(result.lots.length, 205);
  assert.deepEqual(batchSizes, [100, 100, 5]);
});

test("Odoo replay rejects a picking whose frozen route no longer matches", async () => {
  let wrote = false;
  const client = {
    execute: async (model, method) => {
      if (model === "stock.picking" && method === "search_read") {
        return [{ id: 55, name: "CHI/IN/QA", origin: "WG-REC-1", state: "assigned", picking_type_id: [245, "Receipts"], location_id: [4, "Vendors"], location_dest_id: [500, "Other/Stock"], move_ids_without_package: [] }];
      }
      if (["create", "write", "button_validate"].includes(method)) wrote = true;
      throw new Error(`unexpected ${model}.${method}`);
    },
  };
  await assert.rejects(
    ensureOdooSerializedReceipt(client, {
      marker: "WG-REC-1",
      context: { pickingTypeId: 245, sourceLocationId: 4, destinationLocationId: 471, products: [] },
    }),
    (error) => error.code === "ODOO_RECEIPT_ROUTE_MISMATCH" && error.statusCode === 409,
  );
  assert.equal(wrote, false);
});
