import { DEFAULT_UOM_CODE, formatQuantity, normalizeUomCode } from "./units-of-measure.js";
import { laborProductLabel } from "./labor-product.js";

export const emptyPart = () => ({ partNo: "", qty: "", uomCode: DEFAULT_UOM_CODE, repairOrder: "" });
export const DEFAULT_PART_ENTRY_ROWS = 3;
export const emptyPartRows = (count = DEFAULT_PART_ENTRY_ROWS) => (
  Array.from({ length: Math.max(0, Number(count) || 0) }, emptyPart)
);

function trimmedText(value) {
  return typeof value === "string" ? value.trim() : "";
}

/**
 * Resolve the customer/unit-owner snapshot without consulting tenant or location data.
 *
 * `customerCompanyName` is the canonical workorder snapshot. An explicitly present
 * canonical key, including an empty string, is authoritative so legacy adapters
 * cannot replace it with a repair location. `companyName` remains a read-only
 * compatibility source for workorders created before the canonical key existed.
 */
export function resolveCustomerCompanyName(formData = {}, assetOwnerName = "") {
  const source = formData && typeof formData === "object" ? formData : {};
  if (Object.prototype.hasOwnProperty.call(source, "customerCompanyName")) {
    return trimmedText(source.customerCompanyName);
  }
  return trimmedText(source.companyName) || trimmedText(assetOwnerName);
}

/**
 * Return printable workorder form data with an explicit customer snapshot.
 *
 * Asset owner is master data and is used only to initialize/read a missing snapshot.
 * Once present, the workorder snapshot wins so later asset-owner changes do not
 * rewrite historical workorders.
 */
export function normalizeWorkorderFormData(formData = {}, { assetOwnerName = "" } = {}) {
  const source = formData && typeof formData === "object" && !Array.isArray(formData)
    ? formData
    : {};
  return {
    ...source,
    customerCompanyName: resolveCustomerCompanyName(source, assetOwnerName),
  };
}

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

export const WORKORDER_PART_ROWS_PER_PAGE = 6;

function normalizedRepairOrderLine(value) {
  return String(value || "").trim().replace(/\s+/g, " ").toLocaleLowerCase();
}

export function printableLaborRepairOrder(workPerformed, parts = []) {
  const partRepairOrders = new Set(
    (Array.isArray(parts) ? parts : [])
      .map((part) => normalizedRepairOrderLine(part?.repairOrder))
      .filter(Boolean),
  );

  return String(workPerformed || "")
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter((line) => line && !partRepairOrders.has(normalizedRepairOrderLine(line)))
    .join("\n");
}

function inputPartRows(form) {
  const inputParts = (Array.isArray(form.parts) ? form.parts : []).map((part) => {
    const selectedSerials = [...new Set((Array.isArray(part?.serializedSerialNumbers) ? part.serializedSerialNumbers : [])
      .map((serial) => String(serial || "").trim())
      .filter(Boolean))];
    return selectedSerials.length && !String(part?.serialNumber || "").trim()
      ? { ...part, serialNumber: selectedSerials.join(", ") }
      : part;
  });
  const laborHours = String(form.laborHours || "").trim();
  const workPerformed = printableLaborRepairOrder(form.workPerformed, inputParts);
  const rows = laborHours || workPerformed ? [{
    partNo: laborProductLabel(form.laborProduct),
    qty: laborHours,
    uomCode: "hr",
    repairOrder: workPerformed,
  }, ...inputParts] : inputParts;
  return rows.length ? rows : emptyPartRows();
}

function positiveQuantity(value) {
  const quantity = Number(value);
  return Number.isFinite(quantity) && quantity > 0 ? quantity : 0;
}

export function workorderQuantityTotals(form = {}) {
  const parts = Array.isArray(form.parts) ? form.parts : [];
  const partsQuantity = parts.reduce((total, part) => (
    String(part?.partNo || "").trim()
      ? total + positiveQuantity(part?.qty)
      : total
  ), 0);

  return {
    labor: formatQuantity(positiveQuantity(form.laborHours), "hr"),
    parts: partsQuantity > 0 ? String(Number(partsQuantity.toFixed(3))) : "",
  };
}

export function paginateWorkorderParts(form) {
  const rows = inputPartRows(form);
  const pages = [];
  for (let index = 0; index < rows.length; index += WORKORDER_PART_ROWS_PER_PAGE) {
    const pageRows = rows.slice(index, index + WORKORDER_PART_ROWS_PER_PAGE);
    while (pageRows.length < WORKORDER_PART_ROWS_PER_PAGE) pageRows.push(emptyPart());
    pages.push(pageRows);
  }
  return pages;
}

export function workorderPhysicalPageCount(form) {
  return paginateWorkorderParts(form).length;
}

function unitDisplay(form) {
  const unit = String(form.unitNo || "").trim();
  const type = String(form.unitType || "").trim();
  if (unit && type) return `${unit} (${type})`;
  return unit || type;
}

export function workDateRangeLabel(form) {
  const start = String(form.workStartDate || form.workDate || "").trim();
  const end = String(form.workEndDate || "").trim();
  if (start && end && start !== end) return `${start} - ${end}`;
  return start || end;
}

function workDateFieldLabel(form) {
  const start = String(form.workStartDate || form.workDate || "").trim();
  const end = String(form.workEndDate || "").trim();
  return start && end && start !== end ? "Date Range:" : "Date:";
}

export const workorderTemplateStyles = `
@page {
  size: 11in 8.5in;
  margin: 0;
}

.workorder-print-root {
  background: #fff;
  color: #111;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
}

.workorder-page {
  aspect-ratio: 11 / 8.5;
  background: #fff;
  color: #111;
  display: grid;
  font-family: system-ui, -apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif;
  grid-template-rows:
    3%
    22%
    5%
    34%
    16%
    20%;
  height: 8.5in;
  overflow: hidden;
  page-break-after: always;
  width: 11in;
}

.workorder-page.is-document-final-page {
  page-break-after: auto;
}

.wo-title {
  align-items: center;
  border-bottom: 1px solid #111;
  display: flex;
  font-size: 13px;
  font-weight: 800;
  justify-content: center;
  line-height: 1.2;
  overflow: hidden;
  padding: 0 92px;
  position: relative;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wo-page-marker {
  font-size: 10px;
  font-weight: 700;
  line-height: 1.2;
  position: absolute;
  right: 10px;
  top: 50%;
  transform: translateY(-50%);
}

.wo-top {
  display: grid;
  grid-template-columns: 34% 25% 41%;
}

.wo-concern,
.wo-brand,
.wo-details {
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
}

.wo-concern {
  display: grid;
  grid-template-rows: auto 1fr;
  padding: 6px;
}

.wo-label {
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

.wo-value {
  font-size: 12px;
  font-weight: 600;
  line-height: 1.2;
  min-width: 0;
  overflow-wrap: anywhere;
}

.wo-brand {
  align-content: center;
  display: grid;
  gap: 10px;
  justify-items: center;
}

.wo-brand strong {
  font-size: 22px;
  font-weight: 800;
  line-height: 1.2;
  max-width: 100%;
  text-align: center;
  overflow-wrap: anywhere;
}

.wo-details {
  border-right: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.wo-detail {
  align-items: center;
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
  display: grid;
  gap: 6px;
  grid-template-columns: max-content minmax(0, 1fr);
  min-height: 0;
  padding: 3px 8px;
}

.wo-detail:nth-child(even),
.wo-detail-wide {
  border-right: 0;
}

.wo-detail-wide {
  grid-column: 1 / -1;
}

.wo-detail .wo-value {
  min-height: 14px;
}

.wo-mechanic {
  display: grid;
  grid-template-columns: 58% 21% 21%;
}

.wo-mechanic > div {
  align-items: center;
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
  display: grid;
  gap: 5px;
  grid-template-columns: max-content minmax(0, 1fr);
  padding: 3px 8px;
}

.wo-mechanic > div:last-child {
  border-right: 0;
}

.wo-mechanic .wo-value {
  min-height: 14px;
}

.wo-parts {
  display: grid;
  grid-template-rows: 30px repeat(var(--wo-part-rows), minmax(0, 1fr));
  min-height: 0;
}

.wo-part-row {
  display: grid;
  grid-template-columns: 54px 25% 68px minmax(0, 1fr);
  min-height: 0;
}

.wo-part-row > div {
  align-items: center;
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
  display: flex;
  font-size: 12px;
  line-height: 1.2;
  overflow: hidden;
  overflow-wrap: anywhere;
  padding: 4px 8px;
  white-space: normal;
}

.wo-part-row > div:first-child,
.wo-part-row > div:nth-child(3) {
  justify-content: center;
}

.wo-part-row > div:last-child {
  border-right: 0;
}

.wo-part-identity {
  align-items: flex-start !important;
  flex-direction: column;
  justify-content: center;
}

.wo-part-serial {
  display: block;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.15;
  overflow-wrap: anywhere;
}
.wo-part-pending { display: block; color: #b54708; font-size: 9px; font-weight: 700; }

.wo-part-head > div {
  font-weight: 800;
}

.wo-footer {
  display: grid;
  grid-template-columns: 34% 25% 23% 18%;
}

.wo-footer > div {
  border-right: 1px solid #111;
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
  padding: 6px 10px;
}

.wo-footer > div:last-child {
  border-right: 0;
}

.wo-footer-line {
  display: grid;
  align-content: start;
  gap: 7px;
  grid-template-columns: max-content minmax(0, 1fr);
}

.wo-footer-line .wo-value {
  min-height: 14px;
}

.wo-totals {
  display: grid;
  padding: 0 !important;
}

.wo-totals span {
  gap: 6px;
  justify-content: space-between;
  border-bottom: 1px solid #111;
  align-items: center;
  display: flex;
  min-height: 0;
  padding: 3px 10px;
}

.wo-totals span:last-child {
  border-bottom: 0;
}

.wo-disclaimer {
  border-top: 1px solid #111;
  display: grid;
  align-content: center;
  gap: 7px;
  padding: 8px 18px;
  text-align: center;
}

.wo-disclaimer strong {
  font-size: 12px;
  font-weight: 800;
  line-height: 1.2;
}

.wo-disclaimer span {
  display: block;
  font-size: 10px;
  font-weight: 600;
  line-height: 1.25;
  overflow-wrap: anywhere;
}

@media print {
  html,
  body,
  .workorder-print-root {
    background: #fff;
    height: auto;
    margin: 0;
    padding: 0;
    width: auto;
  }

  .workorder-page {
    border: 0;
    box-shadow: none;
  }
}
`;

export function renderWorkorderPageHtml(form, serial, {
  rows = paginateWorkorderParts(form)[0],
  pageIndex = 0,
  pageCount = 1,
  rowOffset = 0,
  isDocumentFinalPage = false,
} = {}) {
  const customerCompanyName = resolveCustomerCompanyName(form, form?.assetOwnerName);
  const quantityTotals = workorderQuantityTotals(form);
  const pageMarker = pageCount > 1 ? `Page ${pageIndex + 1} of ${pageCount}` : "";
  return `
    <article class="workorder-page${isDocumentFinalPage ? " is-document-final-page" : ""}" data-workorder-serial="${escapeHtml(serial)}" data-page-number="${pageIndex + 1}">
      <header class="wo-title">
        ${escapeHtml(form.headerTitle || "CHINO YARD WORKORDER")}
        ${pageMarker ? `<span class="wo-page-marker">${escapeHtml(pageMarker)}</span>` : ""}
      </header>
      <section class="wo-top">
        <div class="wo-concern">
          <span class="wo-label">Mechanic Concern:</span>
          <strong class="wo-value">${escapeHtml(form.mechanicConcern)}</strong>
        </div>
        <div class="wo-brand">
          <strong>${escapeHtml(form.brandTop || "PRO TEC")}</strong>
          <strong>${escapeHtml(form.brandBottom || "REPAIR")}</strong>
        </div>
        <div class="wo-details">
          <div class="wo-detail"><span class="wo-label">Unit No:</span><strong class="wo-value">${escapeHtml(unitDisplay(form))}</strong></div>
          <div class="wo-detail"><span class="wo-label">${workDateFieldLabel(form)}</span><strong class="wo-value">${escapeHtml(workDateRangeLabel(form))}</strong></div>
          <div class="wo-detail"><span class="wo-label">License:</span><strong class="wo-value">${escapeHtml(form.licenseNo)}</strong></div>
          <div class="wo-detail"><span class="wo-label">Mileage:</span><strong class="wo-value">${escapeHtml(form.mileage)}</strong></div>
          <div class="wo-detail"><span class="wo-label">Invoice No:</span><strong class="wo-value">${escapeHtml(serial)}</strong></div>
          <div class="wo-detail"><span class="wo-label">Model:</span><strong class="wo-value">${escapeHtml(form.model)}</strong></div>
          <div class="wo-detail wo-detail-wide"><span class="wo-label">Vin No:</span><strong class="wo-value">${escapeHtml(form.vinNo)}</strong></div>
          <div class="wo-detail wo-detail-wide"><span class="wo-label">Customer Company:</span><strong class="wo-value">${escapeHtml(customerCompanyName)}</strong></div>
        </div>
      </section>
      <section class="wo-mechanic">
        <div><span class="wo-label">Mechanic Name:</span><strong class="wo-value">${escapeHtml(form.mechanicName)}</strong></div>
        <div><span class="wo-label">Start Time:</span><strong class="wo-value">${escapeHtml(form.startTime)}</strong></div>
        <div><span class="wo-label">End Time:</span><strong class="wo-value">${escapeHtml(form.endTime)}</strong></div>
      </section>
      <section class="wo-parts" style="--wo-part-rows: ${rows.length}">
        <div class="wo-part-row wo-part-head">
          <div>S.No</div>
          <div>Part No</div>
          <div>Qty</div>
          <div>Repair Order</div>
        </div>
        ${rows
          .map(
            (row, index) => `
              <div class="wo-part-row">
                <div>${rowOffset + index + 1}</div>
                <div class="wo-part-identity"><span>${escapeHtml(row.partNo)}</span>${row.serialNumber ? `<small class="wo-part-serial">Serial: ${escapeHtml(row.serialNumber)}</small>` : ""}${row.pendingApproval ? '<small class="wo-part-pending">Pending Office approval</small>' : ""}</div>
                <div>${escapeHtml(row.qty ? formatQuantity(row.qty, normalizeUomCode(row.uomCode)) : "")}</div>
                <div>${escapeHtml(row.repairOrder)}</div>
              </div>
            `,
          )
          .join("")}
      </section>
      <footer class="wo-footer">
        <div class="wo-footer-line"><span>Manager:</span><strong class="wo-value">${escapeHtml(form.managerName)}</strong></div>
        <div class="wo-footer-line"><span>Customer Sign:</span><strong class="wo-value">${escapeHtml(form.customerSignature)}</strong></div>
        <div class="wo-totals">
          <span>Total Labor:<strong>${escapeHtml(quantityTotals.labor)}</strong></span>
          <span>Total Parts:<strong>${escapeHtml(quantityTotals.parts)}</strong></span>
          <span>Tax:</span>
          <span>Total:</span>
        </div>
        <div class="wo-footer-line"><span>Authorized By:</span><strong class="wo-value">${escapeHtml(form.authorizedBy)}</strong></div>
      </footer>
      <section class="wo-disclaimer">
        <strong>${escapeHtml(form.warrantyText || "NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER")}</strong>
        <span>${escapeHtml(form.responsibilityText || "Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.")}</span>
        <span>${escapeHtml(form.authorizationText || "I authorize the above repair to be completed along with necessary material(s).")}</span>
      </section>
    </article>
  `;
}

export function renderWorkorderPagesHtml(form, serial) {
  const pages = paginateWorkorderParts(form);
  return pages
    .map((rows, pageIndex) => renderWorkorderPageHtml(form, serial, {
      rows,
      pageIndex,
      pageCount: pages.length,
      rowOffset: pageIndex * WORKORDER_PART_ROWS_PER_PAGE,
    }))
    .join("");
}

export function renderWorkorderBatchPagesHtml(form, serials) {
  const pageGroups = serials.map((serial) => ({
    serial,
    pages: paginateWorkorderParts(form),
  }));
  const totalPages = pageGroups.reduce((total, group) => total + group.pages.length, 0);
  let renderedPages = 0;

  return pageGroups
    .flatMap(({ serial, pages }) => pages.map((rows, pageIndex) => {
      renderedPages += 1;
      return renderWorkorderPageHtml(form, serial, {
        rows,
        pageIndex,
        pageCount: pages.length,
        rowOffset: pageIndex * WORKORDER_PART_ROWS_PER_PAGE,
        isDocumentFinalPage: renderedPages === totalPages,
      });
    }))
    .join("");
}

export function renderWorkorderDocument(form, serials) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Workorders ${escapeHtml(serials[0] || "")}</title>
    <style>${workorderTemplateStyles}</style>
  </head>
  <body class="workorder-print-root">
    ${renderWorkorderBatchPagesHtml(form, serials)}
  </body>
</html>`;
}
