export const emptyPart = () => ({ partNo: "", qty: "", repairOrder: "" });

function escapeHtml(value) {
  return String(value ?? "")
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#39;");
}

function partRows(form) {
  const inputParts = Array.isArray(form.parts) ? form.parts : [];
  const rows = inputParts.length ? inputParts : [emptyPart(), emptyPart(), emptyPart()];
  const visibleRows = rows.slice(0, 18);
  while (visibleRows.length < 3) visibleRows.push(emptyPart());
  return visibleRows;
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
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Arial, sans-serif;
}

.workorder-page {
  aspect-ratio: 11 / 8.5;
  background: #fff;
  color: #111;
  display: grid;
  font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "SF Pro Display", "Segoe UI", Arial, sans-serif;
  grid-template-rows:
    clamp(16px, 3%, 18px)
    clamp(96px, 16%, 125px)
    clamp(18px, 3%, 22px)
    minmax(0, 1fr)
    clamp(78px, 17%, 96px)
    clamp(42px, 10%, 56px);
  height: 8.5in;
  overflow: hidden;
  page-break-after: always;
  width: 11in;
}

.workorder-page:last-child {
  page-break-after: auto;
}

.wo-title {
  border-bottom: 1px solid #111;
  font-size: 12px;
  font-weight: 800;
  line-height: 18px;
  text-align: center;
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
  font-size: 10px;
  font-weight: 800;
}

.wo-value {
  font-size: 10px;
  font-weight: 600;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wo-brand {
  align-content: center;
  display: grid;
  gap: 10px;
  justify-items: center;
}

.wo-brand strong {
  font-size: 26px;
  font-weight: 800;
  line-height: 1;
  max-width: 100%;
  overflow: hidden;
  text-align: center;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wo-details {
  border-right: 0;
  display: grid;
  grid-template-columns: 1fr 1fr;
}

.wo-detail {
  align-items: end;
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
  display: grid;
  gap: 4px;
  grid-template-columns: auto 1fr;
  min-height: 12px;
  padding: 2px 6px;
}

.wo-detail:nth-child(even),
.wo-detail-wide {
  border-right: 0;
}

.wo-detail-wide {
  grid-column: 1 / -1;
}

.wo-detail .wo-value {
  min-height: 10px;
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
  grid-template-columns: auto 1fr;
  padding: 2px 6px;
}

.wo-mechanic > div:last-child {
  border-right: 0;
}

.wo-mechanic .wo-value {
  min-height: 10px;
}

.wo-parts {
  display: grid;
  grid-template-rows: minmax(14px, 8%) repeat(var(--wo-part-rows), minmax(0, 1fr));
  min-height: 0;
}

.wo-part-row {
  display: grid;
  grid-template-columns: 64px 25% 82px 1fr;
  min-height: 0;
}

.wo-part-row > div {
  align-items: center;
  border-bottom: 1px solid #111;
  border-right: 1px solid #111;
  display: flex;
  font-size: 10px;
  overflow: hidden;
  padding: 2px 8px;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.wo-part-row > div:first-child,
.wo-part-row > div:nth-child(3) {
  justify-content: center;
}

.wo-part-row > div:last-child {
  border-right: 0;
}

.wo-part-head > div {
  font-weight: 800;
}

.wo-footer {
  display: grid;
  grid-template-columns: 34% 25% 23% 18%;
}

.wo-footer > div {
  border-right: 1px solid #111;
  font-size: 10px;
  font-weight: 800;
  padding: 6px 8px;
}

.wo-footer > div:last-child {
  border-right: 0;
}

.wo-footer-line {
  display: grid;
  gap: 5px;
  grid-template-columns: auto 1fr;
}

.wo-footer-line .wo-value {
  min-height: 10px;
}

.wo-totals {
  display: grid;
  padding: 0 !important;
}

.wo-totals span {
  border-bottom: 1px solid #111;
  padding: 4px 8px;
}

.wo-totals span:last-child {
  border-bottom: 0;
}

.wo-disclaimer {
  border-top: 1px solid #111;
  display: grid;
  gap: 4px;
  padding: 4px 12px;
  text-align: center;
}

.wo-disclaimer strong {
  font-size: 9px;
  font-weight: 800;
}

.wo-disclaimer span {
  display: block;
  font-size: 7px;
  font-weight: 600;
  line-height: 1.15;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
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

export function renderWorkorderPageHtml(form, serial) {
  const rows = partRows(form);
  return `
    <article class="workorder-page">
      <header class="wo-title">${escapeHtml(form.headerTitle || "CHINO YARD WORKORDER")}</header>
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
          <div class="wo-detail wo-detail-wide"><span class="wo-label">Company Name:</span><strong class="wo-value">${escapeHtml(form.companyName)}</strong></div>
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
                <div>${index + 1}</div>
                <div>${escapeHtml(row.partNo)}</div>
                <div>${escapeHtml(row.qty)}</div>
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
          <span>Total Labor:</span>
          <span>Total Parts:</span>
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

export function renderWorkorderDocument(form, serials) {
  return `<!doctype html>
<html>
  <head>
    <meta charset="utf-8" />
    <title>Workorders ${escapeHtml(serials[0] || "")}</title>
    <style>${workorderTemplateStyles}</style>
  </head>
  <body class="workorder-print-root">
    ${serials.map((serial) => renderWorkorderPageHtml(form, serial)).join("")}
  </body>
</html>`;
}
