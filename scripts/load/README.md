# Production-gate load harness

This folder contains a dependency-free Node 22 load and concurrency harness for
the workorder application. It does not alter runtime code or seed permanent
records.

## What it covers

- Authenticates one cookie session for each selected `admin`, `office`,
  `mechanic`, and `surveillance` account.
- Exercises only safe role-scoped reads during the sustained load phase:
  `/api/me`, role dashboards, admin operations, and admin locations.
- Exercises admin pagination, lifecycle/attention filters, search, and deep-page
  reads in addition to every role dashboard.
- Reports total and per-route throughput, p50, p95, p99, maximum latency, and
  unexpected error rate to `.tmp/performance/http-baseline.json` by default.
- Enforces a separate p95 latency budget for every route in
  `route-catalog.js`, not only one aggregate budget.
- Exits non-zero when a configured production threshold fails.
- Optionally verifies disposable draft writes, independent concurrent updates,
  and optimistic locking. The probe expects exactly one update winner and
  `DRAFT_VERSION_CONFLICT` for the other contenders.
- Marks every fixture with `payload.loadHarness.schema = 1`, discards all active
  drafts created by the current run in `finally`, and discards only stale
  harness drafts owned by the authenticated probe user. Discarded rows remain
  as intentional audit history and never reappear in active draft queues.

The sustained phase uses a closed-loop model: each worker sends its next request
after the previous one completes. This is suitable for a release gate and
contention check, but it is not a capacity forecast or an internet traffic
simulation.

## Configure safely

Credentials are supplied only through environment variables. The runner stores
session cookies in memory and never prints identifiers, passwords, cookies, or
response bodies.

```sh
export LOAD_BASE_URL='http://localhost:4173'
export LOAD_ROLES='admin,office,mechanic'

export LOAD_ADMIN_IDENTIFIER='admin'
export LOAD_ADMIN_PASSWORD='...'
export LOAD_OFFICE_IDENTIFIER='office'
export LOAD_OFFICE_PASSWORD='...'
export LOAD_MECHANIC_IDENTIFIER='mechanic1'
export LOAD_MECHANIC_PASSWORD='...'
export LOAD_SURVEILLANCE_IDENTIFIER='surveillance'
export LOAD_SURVEILLANCE_PASSWORD='...'
```

Optional read-load settings:

| Variable | Default | Meaning |
| --- | ---: | --- |
| `LOAD_DURATION_SECONDS` | `30` | Measured phase duration |
| `LOAD_WARMUP_SECONDS` | `5` | Unreported warmup duration |
| `LOAD_CONCURRENCY_PER_ROLE` | `2` | Closed-loop workers per selected role |
| `LOAD_REQUEST_TIMEOUT_MS` | `5000` | Per-request timeout |
| `LOAD_MAX_P95_MS` | `750` | Maximum aggregate p95 |
| `LOAD_MAX_P99_MS` | `1500` | Maximum aggregate p99 |
| `LOAD_MAX_ERROR_RATE` | `0.01` | Maximum unexpected error fraction |
| `LOAD_MIN_REQUESTS_PER_SECOND` | `1` | Minimum aggregate throughput |
| `LOAD_ENDPOINT_BUDGET_SCALE` | `1` | Multiplier for every committed endpoint p95 budget |
| `LOAD_REPORT_PATH` | `.tmp/performance/http-baseline.json` | Ignored sanitized JSON report |

## Validate without network traffic

This validates role selection, credentials, URLs, bounds, and thresholds. Its
output is deliberately secret-free.

```sh
node scripts/load/run.js --validate
node --test scripts/load/*.test.js
```

## Run safe role reads

```sh
node scripts/load/run.js
```

The complete Chino-scale procedure, PostgreSQL plan capture, and mobile browser
probe are documented in `docs/PERFORMANCE_BASELINE.md`.

Start conservatively against production, then increase
`LOAD_CONCURRENCY_PER_ROLE` in deliberate steps while watching application and
PostgreSQL telemetry. Do not use this runner as an unbounded stress tool.

## Opt in to disposable draft concurrency

Writes are disabled by default. Local execution requires:

```sh
export LOAD_ENABLE_DRAFT_WRITES=true
export LOAD_DRAFT_SCENARIO=true
export LOAD_DRAFT_ROLE=office
export LOAD_DRAFT_CONCURRENCY=5
node scripts/load/run.js
```

`--drafts` can replace `LOAD_DRAFT_SCENARIO=true`.

Remote execution requires an additional exact acknowledgement:

```sh
export LOAD_CONFIRM_REMOTE_WRITES=DISPOSABLE_DRAFTS
```

The selected role must be `office` or `admin` and must also be present in
`LOAD_ROLES`. Concurrency is capped at 10 to remain below the per-owner active
draft limit. `LOAD_DRAFT_STALE_MINUTES` defaults to 30 and controls when an
abandoned, owned harness fixture can be cleaned by a later run.

An abrupt process kill, host loss, or `SIGKILL` cannot run cleanup. A later run
removes stale harness-marked fixtures owned by the same user; it never removes
normal drafts or another user's drafts.

## Reading the result

The release gate passes only when:

1. Every configured role authenticates and `/api/me` returns the expected role.
2. Sustained safe reads meet all aggregate latency, error, and throughput
   thresholds.
3. When enabled, all independent draft writes succeed, the collision probe has
   exactly one winner, all other contenders return the expected conflict, and
   fixture cleanup completes.

Authentication is intentionally outside measured throughput so sign-in rate
limits and password hashing do not distort application-read latency.
