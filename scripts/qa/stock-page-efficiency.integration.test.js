import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { performance } from 'node:perf_hooks';
import { closePool, getPool } from '../../src/server/db/pool.js';
import { listLocalInventoryStock } from '../../src/server/db/repositories/local-inventory.repo.js';

if (process.env.RUN_INSPECTION_MAINTENANCE_INTEGRATION === '1') {
const url = new URL(process.env.DATABASE_URL || '');
assert.ok(['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname));
assert.match(url.pathname, /^\/inspection_maintenance_test_[a-f0-9]{32}$/);
const pool = getPool();
const originalQuery = pool.query.bind(pool);
const company = randomUUID(), otherCompany = randomUUID(), locations = [randomUUID(), randomUUID()];
try {
  await originalQuery("insert into companies(id,slug,name) values($1,$2,'Stock QA'),($3,$4,'Other')", [company, `stock-${company}`, otherCompany, `stock-${otherCompany}`]);
  await originalQuery("insert into locations(id,company_id,name) values($1,$3,'A'),($2,$3,'B')", [...locations, company]);
  await originalQuery(`insert into parts_catalog(company_id,normalized_part_number,part_number,description)
    select $1, 'QA' || lpad(n::text,4,'0'), 'QA' || lpad(n::text,4,'0'), 'Fixture ' || n from generate_series(1,120) n`, [company]);
  await originalQuery(`insert into inventory_stocking_policies(company_id,location_id,catalog_part_id,minimum_available,target_quantity)
    select p.company_id,l.id,p.id,2,5 from parts_catalog p cross join locations l where p.company_id=$1 and l.company_id=$1 and p.part_number <> 'QA0003'`, [company]);
  let captured;
  pool.query = async (sql, params) => { captured = [sql, params]; return originalQuery(sql, params); };
  const options = { companyIds:[company], locationIds:locations, isAdmin:false, limit:5, offset:0 };
  const started = performance.now();
  const result = await listLocalInventoryStock(options);
  const elapsed = performance.now() - started;
  assert.equal(result.length, 5);
  assert.equal(result.total, 120);
  assert.deepEqual(result.counts, { all:120, available:0, reserved:0, out:120 });
  assert.deepEqual(result.map(x => x.partNumber), ['QA0001','QA0002','QA0003','QA0004','QA0005']);
  assert.equal(result[0].locations.length, 2);
  assert.equal(Number(result[0].locations[0].minimumAvailable), 2);
  const planResult = await originalQuery(`explain (analyze, format json) ${captured[0]}`, captured[1]);
  const plan = planResult.rows[0]['QUERY PLAN'][0];
  const policyScans = [];
  function walk(node) {
    if (node['Relation Name'] === 'inventory_stocking_policies') policyScans.push(node['Actual Loops']);
    for (const child of node.Plans || []) walk(child);
  }
  walk(plan.Plan);
  assert.ok(policyScans.length > 0, 'Expected stocking policy access in execution plan');
  assert.ok(Math.max(...policyScans) <= options.limit * locations.length, `Policy enrichment exceeded page size: ${policyScans}`);
  const actor = randomUUID();
  await originalQuery("insert into user_profiles(id,display_name) values($1,'Stock QA')", [actor]);
  await originalQuery(`insert into inventory_items(company_id,location_id,catalog_part_id,normalized_part_number,part_number,source_provider,quantity_on_hand,quantity_reserved)
    select p.company_id,$2,p.id,p.normalized_part_number,p.part_number,'local',
           case p.part_number when 'QA0001' then 8 when 'QA0002' then 4 else 1 end,
           case p.part_number when 'QA0002' then 4 else 0 end
    from parts_catalog p where p.company_id=$1 and p.part_number in ('QA0001','QA0002')`, [company, locations[0]]);
  await originalQuery("update parts_catalog set tracking_mode='no_stock' where company_id=$1 and part_number='QA0003'", [company]);
  await originalQuery(`insert into inventory_part_price_versions(company_id,catalog_part_id,price_kind,version,amount,currency,reason,created_by,idempotency_key,request_hash,location_id,tax_treatment)
    select $1,p.id,'internal',1,10,'USD','Fixture', $3::uuid,'default-price',repeat('a',64),null::uuid,'legacy_unknown' from parts_catalog p where p.company_id=$1 and p.part_number='QA0001'
    union all select $1,p.id,'internal',1,null,null,'Fixture',$3::uuid,'cleared-price',repeat('b',64),$2::uuid,'not_configured' from parts_catalog p where p.company_id=$1 and p.part_number='QA0001'`, [company,locations[0],actor]);
  await originalQuery(`insert into inventory_part_selling_policy_versions(company_id,catalog_part_id,version,method,value,currency,reason,created_by,idempotency_key,request_hash)
    select $1,p.id,1,'markup_percent',10,null,'Fixture',$2,'selling-policy-'||p.part_number,repeat('c',64)
    from parts_catalog p where p.company_id=$1 and p.part_number in ('QA0001','QA0003')`, [company,actor]);
  const cleared = await listLocalInventoryStock({ ...options, queryText:'QA0001' });
  assert.ok(cleared[0].locations.find(x => x.locationId === locations[0]).issues.includes('missing_internal_price'));
  assert.ok(!cleared[0].locations.find(x => x.locationId === locations[1]).issues.includes('missing_internal_price'));
  const available = await listLocalInventoryStock({ ...options, availability:'available' });
  assert.deepEqual(available.map(x => x.partNumber), ['QA0001']);
  assert.deepEqual(available.counts, { all:120, available:1, reserved:1, out:118 });
  const reserved = await listLocalInventoryStock({ ...options, availability:'reserved' });
  assert.deepEqual(reserved.map(x => x.partNumber), ['QA0002']);
  const out = await listLocalInventoryStock({ ...options, availability:'out', sort:'part_asc' });
  assert.equal(out.total, 118);
  assert.deepEqual(out.map(x => x.partNumber), ['QA0003','QA0004','QA0005','QA0006','QA0007']);
  const master = await listLocalInventoryStock({ ...options, scope:'master' });
  assert.equal(master.length, 0);
  const noStock = await listLocalInventoryStock({ ...options, queryText:'QA0003' });
  assert.ok(noStock[0].issues.includes('missing_selling_price'));
  if (process.env.STOCK_BASELINE_SQL) {
    const baselineSql = Buffer.from(process.env.STOCK_BASELINE_SQL, 'base64').toString();
    let compared = 0;
    for (const sort of ['available_desc','low_stock_first','reserved_desc','locations_desc','part_asc']) {
      for (const availability of ['all','available','reserved','out']) {
        for (const scope of ['all','master']) {
          for (const offset of [0, 2]) {
            await listLocalInventoryStock({ ...options, sort, availability, scope, offset });
            const [sql, params] = captured;
            const oldRows = (await originalQuery(baselineSql, params)).rows;
            const newRows = (await originalQuery(sql, params)).rows;
            assert.deepEqual(newRows, oldRows, `Mismatch ${sort}/${availability}/${scope}/${offset}`);
            compared++;
          }
        }
      }
    }
    console.log(`Old/new raw row comparisons: ${compared}`);
  }
  const scoped = await listLocalInventoryStock({ ...options, locationIds:[locations[0]], queryText:'QA0002' });
  assert.equal(scoped.total, 1);
  assert.equal(scoped[0].locations.length, 1);
  assert.equal(scoped[0].locations[0].locationId, locations[0]);
  const denied = await listLocalInventoryStock({ ...options, companyIds:[otherCompany] });
  assert.equal(denied.length, 0);
  if (process.env.STOCK_BENCHMARK === '1' && process.env.STOCK_BASELINE_SQL) {
    const additionalLocations = Array.from({length:5}, () => randomUUID());
    for (const [i, id] of additionalLocations.entries()) {
      await originalQuery('insert into locations(id,company_id,name) values($1,$2,$3)', [id,company,`Extra ${i}`]);
    }
    await originalQuery(`insert into parts_catalog(company_id,normalized_part_number,part_number,description)
      select $1, 'BENCH' || lpad(n::text,5,'0'), 'BENCH' || lpad(n::text,5,'0'), 'Benchmark' from generate_series(1,6511) n`, [company]);
    const benchmarkOptions = { ...options, locationIds:[...locations,...additionalLocations], limit:20 };
    await listLocalInventoryStock(benchmarkOptions);
    const [sql,params] = captured;
    const baselineSql = Buffer.from(process.env.STOCK_BASELINE_SQL, 'base64').toString();
    const oldPlan = (await originalQuery(`explain (analyze, format json) ${baselineSql}`, params)).rows[0]['QUERY PLAN'][0];
    const newPlan = (await originalQuery(`explain (analyze, format json) ${sql}`, params)).rows[0]['QUERY PLAN'][0];
    function loops(plan) {
      const found = [];
      function visit(node) {
        if (node['Relation Name'] === 'inventory_stocking_policies') found.push(node['Actual Loops']);
        for (const child of node.Plans || []) visit(child);
      }
      visit(plan.Plan);
      return found;
    }
    console.log(JSON.stringify({ benchmarkParts:6631, locations:7, pageSize:20, oldMs:oldPlan['Execution Time'], newMs:newPlan['Execution Time'], oldPolicyLoops:loops(oldPlan), newPolicyLoops:loops(newPlan) }));
  }
  console.log(JSON.stringify({ catalogParts:120, pageSize:5, locations:2, policyLoops:policyScans, elapsedMs:elapsed, explainMs:plan['Execution Time'] }));
} finally {
  pool.query = originalQuery;
  await closePool();
}

} else {
  console.log("Stock efficiency integration skipped: use disposable database runner.");
}
