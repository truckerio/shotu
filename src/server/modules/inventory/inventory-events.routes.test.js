import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { setImmediate } from 'node:timers/promises';
import { test } from 'node:test';
import { handleInventoryEventsApi } from './inventory-events.routes.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

function context(role = 'office', companyIds = [A]) {
  return { actor: { id: 'actor-1', role }, session: { session: { id: 'session-1' } },
    sessionMode: 'standard', companyIds: new Set(companyIds),
    companyRoles: new Map(companyIds.map((id) => [id, role])) };
}

class Response extends EventEmitter {
  constructor(backpressure = false) { super(); this.frames = []; this.backpressure = backpressure; this.destroyed = false; this.writableEnded = false; this.headersSent = false; }
  setHeader(name, value) { this[name] = value; }
  writeHead(status, headers) { this.status = status; this.headers = headers; this.headersSent = true; }
  write(frame) { this.frames.push(frame); return !this.backpressure; }
  end() { this.writableEnded = true; this.emit('close'); }
}

function harness(initial = context(), options = {}) {
  const req = { method: 'GET' };
  const res = new Response(options.backpressure);
  const sent = [];
  let onChange;
  let onFailure;
  let subscribed;
  let unsubscribed = 0;
  let current = initial;
  const helpers = { requestContext: initial, sendJson(_res, status, body) { sent.push({ status, body }); res.end(); } };
  const dependencies = { heartbeatMs: 100_000, resolveRequestContext: async () => current,
    feed: { async subscribe(ids, change, failure) { subscribed = ids; onChange = change; onFailure = failure; return () => { unsubscribed++; }; } } };
  return { req, res, sent, helpers, dependencies, get subscribed() { return subscribed; },
    change: () => onChange(), fail: () => onFailure(), setContext: (next) => { current = next; },
    get unsubscribed() { return unsubscribed; } };
}

test('stream subscribes only to authorized company IDs and sends empty events', async () => {
  const h = harness(context('office', [A, B]));
  const handled = await handleInventoryEventsApi(h.req, h.res,
    new URL(`http://local/api/office/inventory/events?companyId=${B}&companyIds=forged`), h.helpers, h.dependencies);
  assert.equal(handled, true);
  assert.equal(h.res.status, 200);
  assert.deepEqual(h.subscribed, [A, B]);
  assert.equal(h.res.frames[0], 'event: ready\ndata: {}\n\n');
  h.change();
  await setImmediate();
  assert.equal(h.res.frames[1], 'event: inventory-change\ndata: {}\n\n');
  h.res.end();
  assert.equal(h.unsubscribed, 1);
});

test('mechanic and surveillance memberships cannot open the stream', async () => {
  for (const role of ['mechanic', 'surveillance']) {
    const h = harness(context(role));
    await assert.rejects(handleInventoryEventsApi(h.req, h.res,
      new URL('http://local/api/office/inventory/events'), h.helpers, h.dependencies),
    { code: 'INVENTORY_READ_FORBIDDEN' });
    assert.equal(h.subscribed, undefined);
  }
});

test('revoked session or company membership ends stream before another event', async () => {
  for (const next of [null, context('mechanic')]) {
    const h = harness();
    await handleInventoryEventsApi(h.req, h.res, new URL('http://local/api/office/inventory/events'), h.helpers, h.dependencies);
    h.setContext(next || { actor: null });
    h.change();
    await setImmediate();
    assert.equal(h.res.writableEnded, true);
    assert.equal(h.res.frames.length, 1);
    assert.equal(h.unsubscribed, 1);
  }
});

test('method, listener failure, and backpressure close cleanly', async () => {
  const method = harness(); method.req.method = 'POST';
  await handleInventoryEventsApi(method.req, method.res, new URL('http://local/api/office/inventory/events'), method.helpers, method.dependencies);
  assert.equal(method.sent[0].status, 405);
  const failed = harness();
  await handleInventoryEventsApi(failed.req, failed.res, new URL('http://local/api/office/inventory/events'), failed.helpers, failed.dependencies);
  failed.fail();
  assert.equal(failed.res.writableEnded, true);
  assert.equal(failed.unsubscribed, 1);
  const slow = harness(context(), { backpressure: true });
  await handleInventoryEventsApi(slow.req, slow.res, new URL('http://local/api/office/inventory/events'), slow.helpers, slow.dependencies);
  assert.equal(slow.res.writableEnded, true);
  assert.equal(slow.unsubscribed, 1);
});

test('stream limit is per actor and a closed stream frees its slot', async () => {
  const opened = [];
  for (let index = 0; index < 8; index++) {
    const h = harness();
    await handleInventoryEventsApi(h.req, h.res, new URL('http://local/api/office/inventory/events'), h.helpers, h.dependencies);
    assert.equal(h.res.status, 200);
    opened.push(h);
  }
  const refused = harness();
  await handleInventoryEventsApi(refused.req, refused.res, new URL('http://local/api/office/inventory/events'), refused.helpers, refused.dependencies);
  assert.equal(refused.sent[0].status, 429);
  opened[0].res.end();
  const replacement = harness();
  await handleInventoryEventsApi(replacement.req, replacement.res, new URL('http://local/api/office/inventory/events'), replacement.helpers, replacement.dependencies);
  assert.equal(replacement.res.status, 200);
  replacement.res.end();
  for (const h of opened.slice(1)) h.res.end();
});
