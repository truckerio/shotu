import QRCode from "qrcode";
import { z } from "zod";
import {
  getInventoryLabelBatch,
  listAllInventoryLabelBatchItems,
  listInventoryLabelBatchItems,
} from "../../db/repositories/inventory-labels.repo.js";
import { getPartLocationSerialization } from "../../db/repositories/inventory-part-serialization.repo.js";
import { getSerializedInventoryUnit } from "../../db/repositories/inventory-receipts.repo.js";
import { inventoryLabelItemsQuerySchema } from "./inventory.schemas.js";
import { inventoryNotFound } from "./inventory.errors.js";
import { createInventoryQrToken, inventoryScanUrl } from "./inventory-qr.js";

function actorScope(requestContext) {
  return {
    companyIds: [...(requestContext.companyIds || [])],
    locationIds: [...(requestContext.locationIds || [])],
    isAdmin: ["admin", "office"].includes(requestContext.actor.role),
  };
}

async function labelMarkup(items, qrOptions) {
  return Promise.all(items.map(async (item) => {
    const token = createInventoryQrToken(item.unitId, qrOptions);
    const svg = await QRCode.toString(inventoryScanUrl(token, qrOptions.origin), {
      type: "svg",
      errorCorrectionLevel: "M",
      margin: 2,
      width: 256,
    });
    return `<article class="label">${svg}<div><strong>${escapeHtml(item.partNumber)}</strong><span>${escapeHtml(item.description || "Inventory part")}</span><code>${escapeHtml(item.serialNumber)}</code><small>${escapeHtml(item.locationName)}</small></div></article>`;
  }));
}

function labelsPage(title, subtitle, labels) {
  return `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width"><title>${escapeHtml(title)}</title><style>body{font-family:system-ui,sans-serif;margin:8mm}.labels{display:grid;grid-template-columns:repeat(2,80mm);gap:8mm}.label{border:1px solid #000;display:grid;grid-template-columns:28mm minmax(0,1fr);gap:3mm;min-height:32mm;padding:3mm;break-inside:avoid}.label svg{height:28mm;width:28mm}.label div{display:grid;align-content:center;gap:1mm;min-width:0}.label strong,.label span,.label code,.label small{overflow-wrap:anywhere}@media(max-width:600px){body{margin:8px}.labels{grid-template-columns:1fr}.label{grid-template-columns:96px minmax(0,1fr)}.label svg{height:96px;width:96px}}@media print{body{margin:8mm}}</style></head><body><main><h1>${escapeHtml(title)}</h1><p>${escapeHtml(subtitle)}</p><section class="labels">${labels.join("")}</section></main></body></html>`;
}

function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

async function authorizedBatch(batchId, requestContext, dependencies) {
  const scope = actorScope(requestContext);
  const batch = await (dependencies.getBatch || getInventoryLabelBatch)({ batchId, ...scope });
  if (!batch || batch.status !== "ready") throw inventoryNotFound();
  return { batch, scope };
}

export async function readInventoryLabelBatchItems(batchId, searchParams, requestContext, dependencies = {}) {
  const parsed = inventoryLabelItemsQuerySchema.parse(Object.fromEntries(searchParams));
  const { batch, scope } = await authorizedBatch(batchId, requestContext, dependencies);
  const items = await (dependencies.listItems || listInventoryLabelBatchItems)({
    batchId,
    ...scope,
    afterOrdinal: parsed.after,
    limit: parsed.limit,
  });
  const last = items.at(-1)?.ordinal || parsed.after;
  return {
    batch,
    items,
    nextCursor: items.length === parsed.limit && last < batch.itemCount ? String(last) : null,
  };
}

export async function renderInventoryLabelBatchPrint(batchId, requestContext, dependencies = {}) {
  const { batch, scope } = await authorizedBatch(batchId, requestContext, dependencies);
  const items = await (dependencies.listAllItems || listAllInventoryLabelBatchItems)({ batchId, ...scope });
  if (items.length !== batch.itemCount) throw inventoryNotFound();
  const qrOptions = dependencies.qrOptions || {};
  const labels = await labelMarkup(items, qrOptions);
  return labelsPage("Receipt labels", `${batch.locationName} · ${batch.itemCount} labels`, labels);
}

export async function renderInventoryUnitLabel(unitId, requestContext, dependencies = {}) {
  const unit = await (dependencies.getUnit || getSerializedInventoryUnit)({ unitId, ...actorScope(requestContext) });
  if (!unit || unit.status === "void") throw inventoryNotFound();
  const labels = await labelMarkup([{
    unitId: unit.id,
    partNumber: unit.partNumber,
    description: unit.description,
    serialNumber: unit.serialNumber,
    locationName: unit.locationName,
  }], dependencies.qrOptions || {});
  return labelsPage("Inventory QR label", `${unit.partNumber} · ${unit.locationName}`, labels);
}

export async function renderPartLocationLabels(catalogPartId, locationId, requestContext, dependencies = {}) {
  const partId = z.string().uuid().parse(catalogPartId);
  const shopId = z.string().uuid().parse(locationId);
  const data = await (dependencies.readPart || getPartLocationSerialization)({
    catalogPartId: partId,
    locationId: shopId,
    companyIds: [...(requestContext.companyIds || [])],
  });
  if (!data) throw inventoryNotFound();
  const units = data.units.filter((unit) => unit.status === "in_stock");
  if (!units.length) throw inventoryNotFound();
  const labels = await labelMarkup(units.map((unit) => ({
    unitId: unit.id,
    partNumber: data.part.partNumber,
    description: data.part.description,
    serialNumber: unit.serialNumber,
    locationName: data.location.locationName,
  })), dependencies.qrOptions || {});
  return labelsPage(
    `${data.part.partNumber} QR labels`,
    `${data.location.locationName} · ${units.length} serialized unit${units.length === 1 ? "" : "s"}`,
    labels,
  );
}
