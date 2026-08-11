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

When proofreading code, dictionaries, provider configuration, or shared
narrative fields changed, also run:

```bash
npm run test:proofreading
npm run test:proofreading:benchmark
# benchmark entry point: node --env-file=.env scripts/proofreading/benchmark.js
```

The live benchmark sends its synthetic corpus to the configured providers. Run
it only with an approved test/provider account and retain aggregate recall,
unexpected results, p95 latency, provider/model, mode, corpus revision, and
date as release evidence. Do not retain credentials or real workorder text.

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

### Proofreading provider and privacy gate

Complete this additional gate before enabling or changing remote proofreading:

- the shared `NarrativeField` remains the only workorder narrative presentation
  owner and no browser bundle contains a provider credential;
- fast checks preserve spelling, accept only range-safe grammar, and perform at
  most one bounded lexical recovery pass;
- deep/context checks run only after blur, never auto-replace, and fail without
  blocking workorder edit, autosave, or submit;
- stale responses, IME composition, provider timeout/outage, direct editing,
  Ignore once, personal dictionary, company dictionary, keyboard use, mobile viewport
  containment, and native-spellcheck fallback pass the
  [proofreading runbook](proofreading-runbook.md);
- dictionary migration 040, tenant isolation, personal self-service, admin-only
  company mutations, soft removal, and audit events pass focused tests;
- vendor DPA, subprocessors, regions/transfers, operational and backup
  retention, deletion, training/use restrictions, incident notification,
  quotas, and escalation contacts are reviewed and recorded;
- `store: false` is set for optional OpenAI Responses requests, while provider
  logging/abuse-monitoring retention is assessed separately;
- application, proxy, APM, and error logs do not contain narrative bodies,
  provider prompts/responses, dictionary terms, cookies, service IDs, or keys;
- the release remains single-replica while proofreading cache, coalescing,
  concurrency, backoff, and rate limiting are process-local.

Unknown retention, residency, or contract terms fail this gate. Keep the
affected layer disabled; a configured credential is not production approval.
See [proofreading data processing](proofreading-data-processing.md).

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

Run the disposable or approved-staging role workflow before the manual
walkthrough:

```bash
npm run test:role-workflow
```

That workflow creates application workorders and stops after canonical Odoo
readiness. It does not create a provider draft. When Odoo outbound code or
configuration changes, separately create one explicitly approved draft in the
intended Odoo staging database, then verify its vehicle, mileage, warehouse,
marker, service-order link, and application tracking record before production
cutover.

Verify desktop and phone widths with real sessions:

- **Admin:** Operations, Drafts, Locations, Settings, user administration,
  integration status, workorder detail, and creation.
- **Office:** queues, owned drafts, creation, assignment, chat, part decisions,
  review, print, and close.
- **Mechanic:** My jobs, New jobs, Waiting, Finished, assignment acceptance,
  progress autosave, chat/part request, completion, and direct workorder
  creation. Mechanic-created workorders are self-assigned operational records;
  mechanics must not see office/admin creation drafts.
- **Surveillance:** completed queue, read-only workorder detail, canonical Odoo
  readiness/blockers, explicit draft creation in an approved Odoo staging run,
  and persisted service-order number/link after creation.

At each width, require:

- no page-level horizontal overflow;
- no clipped controls or overlapping text;
- keyboard-visible focus;
- readable loading, empty, validation, and failure states;
- no unexpected browser console errors.

For shared narrative fields, also require exact-offset underlines, keyboard
suggestions, safe replacement without correction-history UI, autosave
persistence, and fail-open behavior. Check that password, name, search,
identifier, part number, and
quantity controls never call the remote proofreading endpoint.

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
- proofreading provider timeout/error rate, p95 latency, usage/cost anomalies,
  and operator reports of false corrections.

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
