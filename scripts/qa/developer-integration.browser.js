// Real authenticated APIs and rendered screens; only run against the disposable merge database.
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mkdir, writeFile } from 'node:fs/promises';
import { chromium } from 'playwright';
import { RoleApiClient } from './e2e/api-client.js';
const baseUrl = new URL(process.env.QA_BASE_URL || 'http://localhost:4173');
const database = new URL(process.env.DATABASE_URL);
assert.ok(['localhost', '127.0.0.1'].includes(baseUrl.hostname));
assert.ok(['localhost', '127.0.0.1'].includes(database.hostname) && database.pathname.startsWith('/inventory_developer_'));
const output = process.env.QA_OUTPUT; assert.ok(output);
await mkdir(output, { recursive: true });
const client = await RoleApiClient.create({ role: 'admin', baseUrl, timeoutMs: 20000 });
let browser;
try {
  await client.authenticate({ username: process.env.ADMIN_USERNAME, password: process.env.ADMIN_PASSWORD });
  const template = (await client.request('/api/office/template')).body;
  const location = template.locations[0].location;
  const settingsPath = '/api/office/inventory/purchasing/approval-settings';
  const approval = (await client.request(`${settingsPath}?locationId=${location.id}`)).body;
  if (!approval.policy?.version) await client.request(settingsPath, { method: 'PUT', body: { locationId: location.id, expectedVersion: 0, approvalLimit: '10', currency: 'USD', approverUserIds: [], approverRoles: ['admin'] } });
  const suffix = randomUUID().slice(0, 8), partNumber = `MERGE-${suffix}`;
  const part = (await client.request('/api/office/inventory/parts', { method: 'POST', expectedStatuses: [201], body: { locationId: location.id, partNumber, description: 'Developer integration QA', uomCode: 'ea', trackingMode: 'quantity' } })).body.part;
  const purchase = async body => (await client.request('/api/office/inventory/purchasing', { method: 'POST', body: { locationId: location.id, idempotencyKey: randomUUID(), ...body } })).body;
  const { supplier } = await purchase({ action: 'supplier', name: `QA supplier ${suffix}` });
  let { order } = await purchase({ action: 'create', supplierId: supplier.id, currency: 'USD', expectedDeliveryDate: '2026-12-20', lines: [{ catalogPartId: part.id || part.catalogPartId, quantity: 2, unitPrice: '12.50' }] });
  order = (await purchase({ action: 'submit', orderId: order.id, expectedVersion: order.version })).order;
  if (order.status === 'awaiting_approval') order = (await purchase({ action: 'approve', orderId: order.id, expectedVersion: order.version })).order;
  assert.equal(order.status, 'ordered');
  order = (await purchase({ action: 'receive', orderId: order.id, expectedVersion: order.version, confirmation: 'all_ordered_goods_received', deliveryCondition: 'undamaged' })).order;
  assert.equal(order.status, 'received');
  const receiptBody = { locationId: location.id, catalogPartId: part.id || part.catalogPartId, expectedPartVersion: part.version || 1, trackingMode: 'quantity', uomCode: 'ea', quantity: 2, purchaseLineId: order.lines[0].id, idempotencyKey: randomUUID(), confirmation: 'new_company_stock_received' };
  const receive = async () => (await client.request('/api/office/inventory/direct-receipts', { method: 'POST', expectedStatuses: [200, 201], body: receiptBody })).body;
  const received = await receive(), replay = await receive();
  assert.equal(received.receipt.id, replay.receipt.id); assert.equal(replay.replayed, true);
  await client.request('/api/office/inventory/direct-receipts', { method: 'POST', expectedStatuses: [409], body: { ...receiptBody, quantity: 3 } });
  await client.request('/api/office/inventory/direct-receipts', { method: 'POST', expectedStatuses: [409], body: { ...receiptBody, idempotencyKey: randomUUID() } });
  await client.request(`/api/office/inventory/purchasing?locationId=${randomUUID()}`, { expectedStatuses: [404] });
  const bytes = Buffer.from('%PDF-1.4\nDeveloper integration invoice\n%%EOF');
  const billPath = `/api/office/inventory/purchasing/${order.id}/bills`;
  assert.equal((await fetch(new URL(billPath, baseUrl))).status, 401);
  const billBody = { idempotencyKey: randomUUID(), fileName: 'qa-invoice.pdf', mimeType: 'application/pdf', dataUrl: `data:application/pdf;base64,${bytes.toString('base64')}`, reference: `QA-${suffix}` };
  const uploaded = (await client.request(billPath, { method: 'POST', body: billBody })).body;
  assert.equal((await client.request(billPath, { method: 'POST', body: billBody })).body.document.id, uploaded.document.id);
  assert.equal((await client.request(billPath)).body.items.length, 1);
  const downloaded = await client.requestBytes(`${billPath}/${uploaded.document.id}`);
  assert.deepEqual(downloaded.bytes, bytes);
  browser = await chromium.launch();
  const errors = [], failures = [], layouts = [];
  const context = await browser.newContext({ storageState: await client.storageState() });
  const page = await context.newPage();
  page.on('pageerror', e => errors.push(e.message));
  page.on('response', r => { if (r.url().includes('/api/office/inventory/') && r.status() >= 400) failures.push(`${r.status()} ${r.url()}`); });
  for (const width of [1440, 820, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    await page.goto(`${baseUrl.origin}/?view=inventory&adminView=inventory`);
    const nav = page.getByRole('group', { name: 'Inventory sections', exact: true });
    await nav.waitFor();
    for (const section of ['Purchases', 'Tasks', 'Reports', 'Storage locations', 'Stock']) {
      await nav.getByRole('button', { name: section, exact: true }).click();
      if (section === 'Purchases') {
        await page.getByRole('button', { name: 'Purchase orders', exact: true }).click();
        await page.getByRole('button', { name: 'New purchase order', exact: true }).waitFor();
        await page.getByText(order.number, { exact: true }).first().waitFor();
        await page.getByRole('button', { name: 'New purchase order', exact: true }).click();
        await page.getByRole('dialog', { name: 'New purchase order', exact: true }).waitFor();
        await page.screenshot({ path: `${output}/purchase-editor-${width}.png` });
        await page.getByRole('button', { name: 'Close purchase order', exact: true }).click();
      }
      await page.screenshot({ path: `${output}/${section.replaceAll(' ', '-')}-${width}.png` });
      assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth + 1), `${section} overflow at ${width}`);
      layouts.push({ section, width });
    }
    await page.getByRole('textbox', { name: 'Search inventory' }).fill(partNumber);
    await page.getByText(partNumber, { exact: true }).click();
    await page.locator('.inventory-detail-location-row > button').filter({ hasText: location.name }).click();
    await page.getByRole('button', { name: 'Shelves & bins', exact: true }).click();
    await page.getByRole('button', { name: 'Back to location', exact: true }).waitFor();
    await page.screenshot({ path: `${output}/shelves-${width}.png` });
  }
  assert.deepEqual(errors, []); assert.deepEqual(failures, []);
  await writeFile(`${output}/result.json`, JSON.stringify({ orderId: order.id, receiptId: received.receipt.id, billDocumentId: uploaded.document.id, layouts, errors, failures }, null, 2));
  console.log('PASS: authenticated PO, receiving, replay, invoice document roundtrip; desktop/tablet/phone screens.');
} finally { await browser?.close(); await client.dispose(); }
