# Performance baseline

This is the repeatable release baseline for the Workorder Generator at one
busy location: 500 workorders per month at Chino Yard. It measures before any
optimization and keeps generated evidence out of Git.

## Scope and safety

The baseline has three independent gates:

1. **HTTP role baseline**: authenticated, safe reads for admin, office,
   mechanic, and surveillance. Admin coverage includes first/deep pagination,
   active/review/attention filters, and substring search.
2. **PostgreSQL plans**: read-only `EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON)` for
   location queues, deep pagination, search, mechanic assignment, and the Odoo
   backlog read shape.
3. **Mobile rendering**: optional Playwright measurement of a 390 x 844 role
   list, including list-ready time, long tasks, frame time, and horizontal
   overflow.

No runner prints passwords, cookies, connection strings, response bodies, or
tenant/user UUIDs. JSON reports are written with owner-only permissions below
`.tmp/performance/`, which is ignored by Git. The HTTP sustained phase uses GET
requests only unless the existing disposable-draft probe is explicitly enabled.

Do not run an unbounded stress test against production. Use staging or local
PostgreSQL for concurrency increases and database plan work.

## Prepare Chino-scale data

The deterministic local fixture owns exactly the requested monthly volume.
It replaces only rows marked with its fixture key.

```sh
npm run db:seed-demo-users
CHINO_WORKORDER_COUNT=500 npm run db:seed-chino-volume
npm run db:check
```

The database baseline fails when fewer than `PERF_MIN_WORKORDERS` (default 500)
exist at `PERF_LOCATION_NAME` (default `Chino Yard`). This prevents an easy
10-row development database from producing a misleading pass.

## Configure credentials locally

Create an ignored `.env.performance`. Never commit it.

```sh
LOAD_BASE_URL=http://localhost:4173
LOAD_ADMIN_IDENTIFIER=qa.admin
LOAD_ADMIN_PASSWORD=...
LOAD_OFFICE_IDENTIFIER=qa.office
LOAD_OFFICE_PASSWORD=...
LOAD_MECHANIC_IDENTIFIER=qa.mechanic
LOAD_MECHANIC_PASSWORD=...
LOAD_SURVEILLANCE_IDENTIFIER=qa.surveillance
LOAD_SURVEILLANCE_PASSWORD=...

PERF_BROWSER_BASE_URL=http://localhost:4173
PERF_BROWSER_ROLE=admin
PERF_BROWSER_IDENTIFIER=qa.admin
PERF_BROWSER_PASSWORD=...
```

The standard `.env` continues to own `DATABASE_URL`. All performance-specific
overrides belong in `.env.performance`.

## Run the gates

```sh
npm run test:performance-tooling
npm run performance:baseline:db
npm run performance:baseline:http
npm run performance:baseline:mobile
```

Run the HTTP validation path without network traffic first:

```sh
node --env-file=.env --env-file-if-exists=.env.performance scripts/load/run.js --validate
```

Default reports:

| Gate | Generated report |
| --- | --- |
| PostgreSQL | `.tmp/performance/postgres-baseline.json` |
| HTTP | `.tmp/performance/http-baseline.json` |
| Mobile | `.tmp/performance/mobile-render-baseline.json` |

## Budgets

Aggregate HTTP defaults remain p95 <= 750 ms, p99 <= 1500 ms, errors <= 1%,
and throughput >= 1 request/second. Each route also has a committed p95 budget
in `scripts/load/route-catalog.js`; dashboard reads have more headroom than
identity or one-page reads because they execute several authorized projections.

PostgreSQL query budgets are in
`scripts/database/performance/query-manifest.js`. The runner fails on an
execution-time breach or temporary-file writes. `PERF_DB_BUDGET_SCALE` and
`LOAD_ENDPOINT_BUDGET_SCALE` may be used to characterize slower development
hardware, but release evidence should always state any non-default scale.

Mobile defaults:

- list visible <= 2500 ms
- maximum long task <= 200 ms
- maximum sampled scroll frame <= 50 ms
- horizontal overflow = 0 px

## Index policy

The database report distinguishes two classes:

- **Required**: existing named indexes that current queue/detail contracts
  depend on. Set `PERF_STRICT_INDEXES=true` to make a missing required index a
  hard failure.
- **Recommended**: candidate composite or trigram indexes. They are reported,
  not created. Add one through a normal migration only after the captured plan
  demonstrates enough sequential scans, reads, temporary blocks, or latency to
  justify its write/storage cost.

The primary candidate for multi-location growth is
`(company_id, location_id, status, updated_at desc)`. Substring search may later
justify `pg_trgm` indexes on serial and concern. At 500 rows, a sequential scan
can still be cheaper and is not automatically a defect.

## Reading and comparing results

Keep a baseline artifact in the release system, not the repository. Compare:

- p50/p95/p99 and throughput per endpoint
- database execution time, shared reads, temporary blocks, and plan root
- mobile list-ready time, long tasks, max sampled frame, and overflow

Investigate the slowest route or query first. Change one index/query/rendering
variable, rerun all three gates, and record before/after values. A local pass is
not a production capacity guarantee; production telemetry still owns real
latency, connection-pool saturation, CPU, memory, and cache behavior.

## Latest verified local baseline

The combined checkout was last measured on **2026-08-02** with 517 Chino Yard
workorders. Default budget scales were used.

| Gate | Result |
| --- | --- |
| PostgreSQL first page | 0.044 ms |
| PostgreSQL deep page | 0.228 ms |
| PostgreSQL substring search | 0.526 ms |
| PostgreSQL mechanic queue | 0.121 ms |
| PostgreSQL Odoo backlog | 0.144 ms |
| Required indexes | No required index missing |
| HTTP safe-read run | 6,888 requests in 30 seconds; 229.44 req/s; 0 errors |
| HTTP latency | p95 61.66 ms; p99 74.00 ms; max 150.18 ms |
| Mobile Admin list, 390 x 844 | ready 950.5 ms; 20 rows; FCP 516 ms |
| Mobile rendering | max long task 50 ms; max frame 17.1 ms; overflow 0 px |

These values are local release evidence, not production capacity claims. Keep
the generated JSON artifacts out of Git and attach them to the relevant release
or CI run when historical comparison is needed.
