import assert from 'node:assert/strict';
import { EventEmitter } from 'node:events';
import { test } from 'node:test';
import { createInventoryChangeFeed } from './inventory-change-feed.js';

const A = '11111111-1111-4111-8111-111111111111';
const B = '22222222-2222-4222-8222-222222222222';

test('one LISTEN connection filters company notifications and releases on last subscriber', async () => {
  const client = Object.assign(new EventEmitter(), { queries: [], released: 0,
    async query(sql) { this.queries.push(sql); }, release() { this.released++; } });
  let connects = 0;
  const feed = createInventoryChangeFeed({ pool: { async connect() { connects++; return client; } } });
  const seen = [];
  const unsubscribeA = await feed.subscribe([A], () => seen.push('A'), () => {});
  const unsubscribeB = await feed.subscribe([B], () => seen.push('B'), () => {});
  assert.equal(connects, 1);
  assert.deepEqual(client.queries, ['LISTEN inventory_stock_changed']);
  client.emit('notification', { channel: 'inventory_stock_changed', payload: A });
  client.emit('notification', { channel: 'inventory_stock_changed', payload: B });
  client.emit('notification', { channel: 'other', payload: A });
  client.emit('notification', { channel: 'inventory_stock_changed', payload: 'secret' });
  assert.deepEqual(seen, ['A', 'B']);
  unsubscribeA();
  assert.equal(client.released, 0);
  unsubscribeB();
  assert.equal(client.released, 1);
});

test('listener failure ends subscribers and permits a new connection', async () => {
  const clients = [];
  const feed = createInventoryChangeFeed({ pool: { async connect() {
    const client = Object.assign(new EventEmitter(), { async query() {}, release() { this.released = true; } });
    clients.push(client);
    return client;
  } } });
  let failures = 0;
  await feed.subscribe([A], () => {}, () => { failures++; });
  clients[0].emit('error', new Error('connection lost'));
  assert.equal(failures, 1);
  assert.equal(clients[0].released, true);
  const unsubscribe = await feed.subscribe([A], () => {}, () => {});
  assert.equal(clients.length, 2);
  unsubscribe();
});

test('failure during LISTEN cannot activate a dead connection or release it twice', async () => {
  let finishListen;
  const clients = [];
  const feed = createInventoryChangeFeed({ pool: { async connect() {
    const index = clients.length;
    const client = Object.assign(new EventEmitter(), {
      released: 0,
      query: () => index === 0 ? new Promise((resolve) => { finishListen = resolve; }) : Promise.resolve(),
      release() { this.released++; },
    });
    clients.push(client);
    return client;
  } } });
  const opening = feed.subscribe([A], () => {}, () => {});
  while (!finishListen) await Promise.resolve();
  clients[0].emit('error', new Error('connection lost while opening'));
  finishListen();
  await assert.rejects(opening, /connection was closed/);
  assert.equal(clients[0].released, 1);
  assert.equal(clients[0].listenerCount('notification'), 0);
  const unsubscribe = await feed.subscribe([A], () => {}, () => {});
  assert.equal(clients.length, 2);
  assert.equal(clients[1].released, 0);
  unsubscribe();
  assert.equal(clients[1].released, 1);
});
