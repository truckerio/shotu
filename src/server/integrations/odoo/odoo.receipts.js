import { InventoryError } from "../../modules/inventory/inventory.errors.js";

function relationId(value) {
  return Number(Array.isArray(value) ? value[0] : value || 0);
}

function relationName(value) {
  return String(Array.isArray(value) ? value[1] || "" : "").trim();
}

function providerError(code, message, statusCode = 422) {
  return new InventoryError(message, { code, statusCode });
}

function chunks(values, size = 100) {
  const result = [];
  for (let index = 0; index < values.length; index += size) result.push(values.slice(index, index + size));
  return result;
}

async function createInBatches(client, model, values) {
  const ids = [];
  for (const batch of chunks(values)) {
    const created = await client.execute(model, "create", [batch]);
    ids.push(...(Array.isArray(created) ? created : [created]).map(Number));
  }
  return ids;
}

async function readPicking(client, pickingId) {
  const rows = await client.execute("stock.picking", "read", [[Number(pickingId)]], {
    fields: ["id", "name", "origin", "state", "picking_type_id", "location_id", "location_dest_id", "move_ids_without_package"],
  });
  return rows[0] || null;
}

async function findExistingPicking(client, marker) {
  const rows = await client.execute("stock.picking", "search_read", [[[
    "origin", "=", marker,
  ]]], {
    fields: ["id", "name", "origin", "state", "picking_type_id", "location_id", "location_dest_id", "move_ids_without_package"],
    limit: 2,
    order: "id asc",
  });
  if (rows.length > 1) throw providerError("ODOO_RECEIPT_DUPLICATE", "Odoo has more than one receipt for this request.", 409);
  return rows[0] || null;
}

function assertPickingRoute(picking, context) {
  const actual = {
    pickingTypeId: relationId(picking.picking_type_id),
    sourceLocationId: relationId(picking.location_id),
    destinationLocationId: relationId(picking.location_dest_id),
  };
  if (actual.pickingTypeId !== Number(context.pickingTypeId)
      || actual.sourceLocationId !== Number(context.sourceLocationId)
      || actual.destinationLocationId !== Number(context.destinationLocationId)) {
    throw providerError(
      "ODOO_RECEIPT_ROUTE_MISMATCH",
      "The existing Odoo receipt route does not match the staged provider command.",
      409,
    );
  }
}

export async function inspectOdooReceipt(client, { locationExternalIds, lines }) {
  const productIds = [...new Set(lines.map((line) => Number(line.productExternalId)))];
  if (productIds.some((id) => !Number.isInteger(id) || id <= 0)) {
    throw providerError("ODOO_PRODUCT_MAPPING_INVALID", "An invoice line does not have a valid Odoo product mapping.");
  }
  const products = await client.execute("product.product", "read", [productIds], {
    fields: ["id", "default_code", "display_name", "tracking", "uom_id", "active"],
  });
  const productById = new Map(products.map((product) => [Number(product.id), product]));
  for (const line of lines) {
    const product = productById.get(Number(line.productExternalId));
    if (!product || product.active === false) {
      throw providerError("ODOO_PRODUCT_UNAVAILABLE", `Part ${line.partNumber} is not an active Odoo product.`);
    }
    if (product.tracking !== "serial") {
      throw providerError(
        "ODOO_PRODUCT_NOT_SERIAL_TRACKED",
        `Part ${line.partNumber} must use serial-number tracking in Odoo before it can be received and labeled.`,
      );
    }
  }
  const destinationIds = new Set(locationExternalIds.map(Number).filter((id) => Number.isInteger(id) && id > 0));
  const types = await client.execute("stock.picking.type", "search_read", [[[
    "code", "=", "incoming",
  ]]], {
    fields: ["id", "name", "code", "warehouse_id", "default_location_src_id", "default_location_dest_id", "active"],
    limit: 100,
    order: "id asc",
  });
  const matches = types.filter((type) => type.active !== false && destinationIds.has(relationId(type.default_location_dest_id)));
  if (matches.length !== 1) {
    throw providerError(
      "ODOO_RECEIPT_ROUTE_UNMAPPED",
      matches.length ? "More than one Odoo receipt route matches this app location." : "Map the app location to an Odoo receipt destination.",
    );
  }
  const pickingType = matches[0];
  return {
    pickingTypeId: Number(pickingType.id),
    sourceLocationId: relationId(pickingType.default_location_src_id),
    destinationLocationId: relationId(pickingType.default_location_dest_id),
    products: lines.map((line) => {
      const product = productById.get(Number(line.productExternalId));
      return {
        ...line,
        productExternalId: Number(product.id),
        productName: String(product.display_name || line.description || line.partNumber),
        uomExternalId: relationId(product.uom_id),
      };
    }),
  };
}

async function ensureMoves(client, picking, context) {
  const existingIds = Array.isArray(picking.move_ids_without_package) ? picking.move_ids_without_package.map(Number) : [];
  const moveByProduct = new Map();
  if (existingIds.length) {
    const existing = await client.execute("stock.move", "read", [existingIds], {
      fields: ["id", "product_id", "product_uom_qty", "product_uom", "move_line_ids", "state"],
    });
    const expectedByProduct = new Map(context.products.map((line) => [line.productExternalId, line]));
    for (const move of existing) {
      const productId = relationId(move.product_id);
      const expected = expectedByProduct.get(productId);
      if (!expected || moveByProduct.has(productId) || Number(move.product_uom_qty) !== Number(expected.quantity)) {
        throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt lines do not match this reviewed invoice.", 409);
      }
      moveByProduct.set(productId, move);
    }
  }
  const missing = context.products.filter((line) => !moveByProduct.has(line.productExternalId));
  const createdIds = await createInBatches(client, "stock.move", missing.map((line) => ({
      name: line.productName,
      product_id: line.productExternalId,
      product_uom_qty: line.quantity,
      product_uom: line.uomExternalId,
      location_id: context.sourceLocationId,
      location_dest_id: context.destinationLocationId,
      picking_id: Number(picking.id),
  })));
  if (createdIds.length !== missing.length) {
    throw providerError("ODOO_RECEIPT_CREATE_FAILED", "Odoo did not return every created receipt line.", 502);
  }
  missing.forEach((line, index) => {
    moveByProduct.set(line.productExternalId, { id: createdIds[index], product_id: [line.productExternalId, line.productName], move_line_ids: [] });
  });
  return moveByProduct;
}

async function ensureMoveLines(client, picking, context, moveByProduct) {
  const expectedBySerial = new Map(context.products.flatMap((line) => line.serials.map((serial) => [serial, {
    productId: line.productExternalId,
    moveId: Number(moveByProduct.get(line.productExternalId)?.id || 0),
  }])));
  const expectedSerials = new Set(expectedBySerial.keys());
  const existing = await client.execute("stock.move.line", "search_read", [[[
    "picking_id", "=", Number(picking.id),
  ]]], {
    fields: ["id", "move_id", "product_id", "lot_id", "lot_name", "quantity"],
    limit: 5000,
    order: "id asc",
  });
  const existingNames = new Map();
  const blankByProduct = new Map();
  for (const row of existing) {
    const name = String(row.lot_name || relationName(row.lot_id)).trim();
    if (!name) {
      const productId = relationId(row.product_id);
      if (!context.products.some((line) => line.productExternalId === productId)) {
        throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt contains an unexpected product allocation.", 409);
      }
      const blanks = blankByProduct.get(productId) || [];
      blanks.push(row);
      blankByProduct.set(productId, blanks);
      continue;
    }
    if (!expectedSerials.has(name)) {
      throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt contains an unexpected serial identity.", 409);
    }
    const expected = expectedBySerial.get(name);
    if (relationId(row.product_id) !== expected.productId || relationId(row.move_id) !== expected.moveId) {
      throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt contains a serial assigned to the wrong product.", 409);
    }
    if (existingNames.has(name)) {
      throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt contains a duplicate serial identity.", 409);
    }
    existingNames.set(name, row);
  }
  const quantityFixIds = [];
  const blankAssignments = [];
  const missingValues = [];
  for (const line of context.products) {
    const move = moveByProduct.get(line.productExternalId);
    if (!move) throw providerError("ODOO_RECEIPT_MISMATCH", `Odoo receipt line for ${line.partNumber} is missing.`, 409);
    for (const serial of line.serials) {
      const row = existingNames.get(serial);
      if (row) {
        if (Number(row.quantity || 0) !== 1) quantityFixIds.push(Number(row.id));
        continue;
      }
      const blank = blankByProduct.get(line.productExternalId)?.shift();
      if (blank) {
        blankAssignments.push({ id: Number(blank.id), serial });
        continue;
      }
      missingValues.push({
        move_id: Number(move.id),
        picking_id: Number(picking.id),
        product_id: line.productExternalId,
        product_uom_id: line.uomExternalId,
        location_id: context.sourceLocationId,
        location_dest_id: context.destinationLocationId,
        lot_name: serial,
        quantity: 1,
      });
    }
  }
  if ([...blankByProduct.values()].some((rows) => rows.some((row) => Number(row.quantity || 0) > 0))) {
    throw providerError("ODOO_RECEIPT_MISMATCH", "The existing Odoo receipt contains an extra blank allocation.", 409);
  }
  if (quantityFixIds.length) await client.execute("stock.move.line", "write", [quantityFixIds, { quantity: 1 }]);
  for (const batch of chunks(blankAssignments, 10)) {
    await Promise.all(batch.map((assignment) => client.execute(
      "stock.move.line",
      "write",
      [[assignment.id], { lot_name: assignment.serial, quantity: 1 }],
    )));
  }
  await createInBatches(client, "stock.move.line", missingValues);
}

async function readLots(client, context) {
  const serials = context.products.flatMap((line) => line.serials);
  const expectedProductBySerial = new Map(context.products.flatMap((line) => (
    line.serials.map((serial) => [serial, line.productExternalId])
  )));
  const lots = await client.execute("stock.lot", "search_read", [[[
    "name", "in", serials,
  ]]], {
    fields: ["id", "name", "product_id"],
    limit: Math.max(1, serials.length + 5),
    order: "id asc",
  });
  if (lots.length !== serials.length) {
    throw providerError("ODOO_SERIAL_RECONCILIATION_REQUIRED", "Odoo confirmed the receipt but not every expected serial could be reconciled.", 502);
  }
  const seen = new Set();
  for (const lot of lots) {
    const name = String(lot.name || "");
    if (seen.has(name) || relationId(lot.product_id) !== expectedProductBySerial.get(name)) {
      throw providerError("ODOO_SERIAL_RECONCILIATION_REQUIRED", "Odoo confirmed a serial against the wrong product.", 502);
    }
    seen.add(name);
  }
  return lots.map((lot) => ({
    externalId: String(lot.id),
    serialNumber: String(lot.name),
    productExternalId: String(relationId(lot.product_id)),
  }));
}

export async function ensureOdooSerializedReceipt(client, { marker, context }) {
  let picking = await findExistingPicking(client, marker);
  if (!picking) {
    const pickingId = await client.execute("stock.picking", "create", [{
      picking_type_id: context.pickingTypeId,
      location_id: context.sourceLocationId,
      location_dest_id: context.destinationLocationId,
      origin: marker,
      move_type: "direct",
    }]);
    picking = await readPicking(client, pickingId);
  }
  if (!picking) throw providerError("ODOO_RECEIPT_CREATE_FAILED", "Odoo did not return the created receipt.", 502);
  assertPickingRoute(picking, context);
  if (picking.state !== "done") {
    const moveByProduct = await ensureMoves(client, picking, context);
    if (picking.state === "draft") await client.execute("stock.picking", "action_confirm", [[Number(picking.id)]]);
    picking = await readPicking(client, picking.id);
    assertPickingRoute(picking, context);
    await ensureMoveLines(client, picking, context, moveByProduct);
    await client.execute("stock.picking", "button_validate", [[Number(picking.id)]]);
    picking = await readPicking(client, picking.id);
    assertPickingRoute(picking, context);
  }
  if (picking?.state !== "done") {
    throw providerError("ODOO_RECEIPT_RECONCILIATION_REQUIRED", "Odoo did not finish the receipt; reconcile it before retrying.", 502);
  }
  return {
    pickingExternalId: String(picking.id),
    pickingName: String(picking.name || ""),
    state: picking.state,
    lots: await readLots(client, context),
  };
}
