# Complete role workflow test

This test exercises the shared workorder lifecycle through the public HTTP API
and then uses Playwright to verify the critical rendered surfaces for all four
roles.

## Covered workflow

1. Admin creates an unassigned workorder.
2. Office assigns the deterministic mechanic and verifies assigned access.
3. Office returns it to the available queue; the mechanic accepts it and a
   duplicate accept is rejected.
4. Mechanic sends chat and requests a synthetic part.
5. Office rejects that synthetic request so the acceptance run never reserves
   or consumes inventory.
6. Mechanic marks work done.
7. Office closes the workorder.
8. Surveillance verifies the Odoo backlog and reads canonical Odoo readiness.
9. Office, mechanic, and surveillance are denied access to another location's
   workorder, and cross-role API permissions are checked.

This disposable workflow deliberately stops at Odoo readiness. It records
whether the workorder is ready or which stable blocker codes explain missing
setup, but it never creates a provider draft. Draft creation requires a
separate explicitly approved Odoo staging acceptance run; the workflow never
invents a service-order number when no provider is configured.

Office assignment already changes lifecycle from `open` to `accepted`; the API
does not support accepting an already assigned workorder. The assign/unassign
sequence deliberately verifies both assignment access and the separate
available-queue acceptance path.

## Safety and setup

Run only against a disposable local or staging database. Production is always
rejected. A second active location in the same company is required for the
authorization boundary checks.

Credentials are read only from environment variables and never printed:

```sh
export DATABASE_URL='postgresql://...'
export QA_E2E_TARGET_ENVIRONMENT='local'
export QA_E2E_BASE_URL='http://localhost:4173'
export QA_COMPANY_SLUG='default'
export QA_LOCATION_NAME='Chino Yard'
export QA_ACCOUNT_NAMESPACE='qa'
export QA_ACCOUNT_PASSWORD='at-least-12-characters'
npm run test:role-workflow
```

The default command applies and resets deterministic QA accounts before the
test. Use `-- --no-provision` only when the accounts already exist with the
configured password. Use `-- --api-only` when browser binaries are intentionally
unavailable.

Browser assertions sign in one role at a time. Keep this sequence: simultaneous
password sign-ins can trip the real login limiter and produce a test artifact
that operators would not encounter in the workflow being measured.

Remote staging runs also require:

```sh
export QA_E2E_CONFIRM_REMOTE_WRITES='RUN_ROLE_WORKFLOW'
```

`DATABASE_URL` must point to the same isolated database used by
`QA_E2E_BASE_URL`. The test leaves its closed, uniquely tagged workorder in the
Odoo-readiness backlog and cancels the restricted-location fixture.

## Verification

```sh
node --test scripts/qa/e2e/*.test.js
npm run build
```

## Inspection daily-life workflow

`npm run test:inspection-workflow` is a separate, fail-closed acceptance harness for the weekly Inspection flow. It uses the same disposable Admin, Office, Mechanic, and read-only QA accounts, but requires two isolated asset fixtures so no customer unit is ever used.

It refuses production. Remote staging writes additionally require `QA_INSPECTION_CONFIRM_REMOTE_WRITES=RUN_INSPECTION_WORKFLOW`, `QA_INSPECTION_EVIDENCE_RETENTION_ACKNOWLEDGEMENT=RETAIN_QA_INSPECTION_EVIDENCE`, and a dedicated `QA_INSPECTION_EVIDENCE_NAMESPACE`; credentials are read from `QA_ACCOUNT_PASSWORD` and are never printed. Set `QA_INSPECTION_TRUCK_ASSET_ID` and `QA_INSPECTION_TRAILER_ASSET_ID` to disposable staging assets in the dedicated QA location. The completed truck inspection/archive is deliberately retained as immutable staging evidence under that namespace; the runner cancels its reversible repair workorder. The browser pass uses fresh role contexts, semantic locators, keyboard/focus assertions, error capture, and 390/430/640-at-200%-zoom/768/820/1280/1920 viewports.

The API journey verifies follow-up resolution, correction lineage, reinspection start/save/complete, truck start evidence (nonnegative odometer and prior-report acknowledgement only when required), trailer start without truck-only fields, print archive replay idempotency, printable HTML integrity, and the binary PDF download (`%PDF-`, `application/pdf`, SHA-256, and byte size). The browser phase verifies the user-facing print popup and rendered surfaces. Actual OS printer output and physical-device proof remain separate manual gates. If a required endpoint or capability is unavailable, the runner must fail with a named error; it must not report a false pass.
