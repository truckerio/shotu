import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { after, test } from 'node:test';
import { closePool, getPool, query } from '../../db/pool.js';
import { createInventoryChangeFeed } from './inventory-change-feed.js';

const runPostgres = process.env.RUN_POSTGRES_INTEGRATION === '1';
after(async () => { if (runPostgres) await closePool(); });

function waitFor(predicate, timeoutMs = 1000) {
  return new Promise((resolve, reject) => {
    const started = Date.now();
    const timer = setInterval(() => {
      if (predicate()) { clearInterval(timer); resolve(); }
      else if (Date.now() - started > timeoutMs) { clearInterval(timer); reject(new Error('Timed out waiting for notification')); }
    }, 10);
  });
}

test('PostgreSQL notifications cross feed instances only after commit and remain company scoped', { skip: !runPostgres }, async () => {
  const companyA = randomUUID();
  const companyB = randomUUID();
  const partA = randomUUID();
  const partB = randomUUID();
  const suffix = randomUUID().replaceAll('-', '');
  const feeds = [createInventoryChangeFeed(), createInventoryChangeFeed()];
  let unsubscribeA; let unsubscribeB;
  let client;
  const seen = [0, 0];
  try {
    const trigger = await query(`select count(*)::int as count from pg_trigger
      where tgrelid='parts_catalog'::regclass and tgname='inventory_stock_change_notification' and not tgisinternal`);
    assert.equal(trigger.rows[0].count, 1, 'migration 204 must be applied to disposable PostgreSQL');
    await query(`insert into companies(id,slug,name) values($1,$2,'Feed test A'),($3,$4,'Feed test B')`,
      [companyA, `feed-a-${suffix}`, companyB, `feed-b-${suffix}`]);
    await query(`insert into parts_catalog(id,company_id,normalized_part_number,part_number,description,uom_code)
      values($1,$2,$3,$3,'Before','ea'),($4,$5,$6,$6,'Before','ea')`,
    [partA, companyA, `FEEDA${suffix}`, partB, companyB, `FEEDB${suffix}`]);
    unsubscribeA = await feeds[0].subscribe([companyA], () => { seen[0]++; }, () => {});
    unsubscribeB = await feeds[1].subscribe([companyA], () => { seen[1]++; }, () => {});

    client = await getPool().connect();
    await client.query('begin');
    await client.query("update parts_catalog set description='Rolled back' where id=$1", [partA]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(seen, [0, 0], 'uncommitted transaction must not notify');
    await client.query('rollback');
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(seen, [0, 0], 'rolled-back transaction must not notify');

    await query("update parts_catalog set description='Other tenant' where id=$1", [partB]);
    await new Promise((resolve) => setTimeout(resolve, 80));
    assert.deepEqual(seen, [0, 0], 'other company must not reach either subscriber');

    await client.query('begin');
    await client.query("update parts_catalog set description='Committed' where id=$1", [partA]);
    await client.query("update parts_catalog set description='Committed again' where id=$1", [partA]);
    assert.deepEqual(seen, [0, 0]);
    await client.query('commit');
    await waitFor(() => seen[0] === 1 && seen[1] === 1);
    assert.deepEqual(seen, [1, 1], 'same-company writes coalesce per transaction across listeners');
  } finally {
    if (client) { await client.query('rollback').catch(() => {}); client.release(); }
    unsubscribeA?.(); unsubscribeB?.();
    feeds.forEach((feed) => feed.close());
    await query('delete from parts_catalog where id=any($1::uuid[])', [[partA, partB]]).catch(() => {});
    await query('delete from companies where id=any($1::uuid[])', [[companyA, companyB]]).catch(() => {});
  }
});
