# Production Release Gate

Run this gate before deploying a release that changes authentication,
authorization, workorder workflow, database structure, printing, or external
integrations. A release is not approved when a required check is skipped.

## 1. Automated Verification

```bash
npm ci
npm run verify
npm run db:check
npm audit --audit-level=high
git diff --check
```

The gate requires:

- all unit and structure tests pass;
- the production frontend build succeeds;
- repository migrations and live database checks agree;
- no high or critical dependency vulnerabilities;
- no whitespace errors.

Run the PostgreSQL workflow integrations when their domains changed:

```bash
npm run test:parts-workflow
npm run test:used-parts
npm run test:mechanic-chat:integration
```

## 2. Database Safety

1. Take a provider snapshot before applying production migrations.
2. Run `npm run db:migrate` once as the Railway pre-deploy command.
3. Deploy the matching application runtime immediately after a breaking
   migration. Do not leave an older runtime serving a contracted schema.
4. Run `npm run db:check` after deployment.
5. Complete the disposable restore drill in
   [backup-restore.md](./backup-restore.md) after material schema changes and at
   least monthly.

Stop the release if migration checksums differ, assignment drift is detected,
or the restored database does not match the source manifest.

## 3. Health And Security Smoke Tests

```bash
curl --fail --silent https://<host>/health/live
curl --fail --silent https://<host>/health/ready
```

`/health/live` proves the process is running. `/health/ready` also verifies
PostgreSQL availability and is the Railway deployment health check.

Confirm:

- unauthenticated protected APIs return `401`;
- a signed-in user cannot open another role's routes;
- a mechanic cannot open or mutate another mechanic's assigned work;
- an office user is limited to assigned company locations;
- admin-only user and integration actions return `403` to other roles;
- a forged cross-origin mutation returns `403 invalid_request_origin`;
- oversized or unsupported request bodies return bounded `413` or `415`
  responses;
- repeated sensitive requests return `429 rate_limit_exceeded`;
- responses include CSP, frame, content-type, referrer, permissions, and
  request-ID headers.

The current rate limiter is process-local and is sufficient only while the
Railway application runs one replica. Move limiter state to a shared
PostgreSQL or Redis store before horizontal application scaling.

## 4. Load And Concurrency

Use the safe role-read procedure in
[`scripts/load/README.md`](../../scripts/load/README.md).

Default release thresholds:

- unexpected error rate at or below 1%;
- aggregate p95 at or below 750 ms;
- aggregate p99 at or below 1500 ms;
- at least 1 request per second.

Local release validation should also run the disposable draft contention probe.
It must produce exactly one optimistic-lock winner and expected version
conflicts for all other simultaneous writers. Never enable remote write probes
without the documented explicit acknowledgement.

This closed-loop harness is a release regression test, not a production
capacity forecast. Increase load gradually and watch application CPU, memory,
event-loop delay, PostgreSQL connections, query latency, and error rate.

## 5. Role Walkthrough

Verify desktop and phone widths with real sessions:

- **Admin:** Operations, Drafts, Locations, Settings, user administration,
  integration status, workorder detail, and creation.
- **Office:** queues, owned drafts, creation, assignment, chat, part decisions,
  review, print, and close.
- **Mechanic:** My jobs, New jobs, Waiting, Finished, assignment acceptance,
  progress autosave, chat/part request, and completion. Mechanics must not see
  workorder creation or office/admin drafts.
- **Surveillance:** completed queue, read-only workorder detail, and Odoo
  service-order entry.

At each width, require:

- no page-level horizontal overflow;
- no clipped controls or overlapping text;
- keyboard-visible focus;
- readable loading, empty, validation, and failure states;
- no unexpected browser console errors.

## 6. Post-Deploy Observation

For the first 15 minutes after deployment, monitor:

- readiness failures and restarts;
- HTTP 5xx and 429 rates by route family;
- p95 and p99 request duration;
- PostgreSQL pool saturation and slow queries;
- failed authentication and authorization events;
- Samsara sync failures;
- print preparation failures;
- workorder draft conflicts and progress-save failures.

Every request log includes a request ID. Use it to correlate the client failure,
server log, and downstream integration error without logging passwords,
cookies, tokens, or request bodies.

## 7. Rollback

Rollback the application when readiness repeatedly fails, error rate rises
materially, a role can cross an authorization boundary, or workorder writes
lose data.

Do not roll an old application binary back onto a database after a breaking
contract migration. Restore the compatible snapshot or deploy a forward fix.
Record the failed gate, request IDs, migration version, and operator actions.
