# Engineering Risk Register

This register measures completion of the structural controls agreed for the
current modular-monolith cleanup. It does not claim that software can have zero
bugs or operational risk. A control earns its weight only when its owner is
documented and its focused tests or verification command pass.

## Score

| Control | Weight | Current credit | Evidence or remaining work |
| --- | ---: | ---: | --- |
| Role capability registry | 5 | 5 | `role-capabilities.js` and focused tests |
| Route navigation/state owner | 5 | 5 | `useRoleRouteNavigation.js` and `route-state.js` |
| Draft lifecycle controller | 7 | 7 | `useWorkorderDraftLifecycle.js` |
| Vehicle lookup controller | 6 | 6 | `useVehicleLookupController.js` and map contract tests |
| Shared detail loader | 3 | 3 | `workorder-detail-loader.js` and focused tests |
| Office detail action controller | 8 | 8 | `useOfficeWorkorderActions.js` and focused action/autosave tests |
| Mechanic detail action controller | 8 | 8 | `useMechanicWorkorderActions.js` and focused action/progress tests |
| Create location/template controller | 3 | 3 | `useCreateLocationController.js` and focused model/contract tests |
| Print controller | 2 | 2 | `useWorkorderPrintController.js` and focused print lifecycle tests |
| Route coordinator below 500 lines | 3 | 3 | `RoleRouter.jsx` is below 500 lines; route, form, command, lifecycle, view-model, and outlet owners have focused tests |
| Feature-owned CSS | 15 | 15 | Legacy bundles are import-only facades; component and feature owners plus four-viewport checks enforce the cascade |
| Full role lifecycle and authorization workflow | 15 | 15 | `npm run test:role-workflow` |
| Chino-scale performance baselines | 10 | 10 | HTTP, PostgreSQL, and mobile baseline commands |
| Structure, ownership, build, and verification gates | 10 | 10 | `npm run verify` and ownership documentation |
| **Total** | **100** | **100** | **Current verified completion: 100%** |

All controls in this cleanup plan are implemented. This score measures the
defined structural controls; it does not mean the software has zero bugs or
operational risk. New risks belong in this register with an owner, weight, and
verification command.

## Last verified evidence

The combined checkout was verified on **2026-08-02**:

- `npm run verify`: 609 focused tests plus structure, syntax, and production
  build passed.
- `node scripts/visual/css-ownership-viewport.js`: 390 x 844, 768 x 1024,
  1080 x 1080, and 1920 x 1080 passed.
- `npm run test:role-workflow`: Admin create, Office assign, Mechanic accept,
  chat/parts, Work done, Office close, Surveillance Odoo, and authorization
  boundaries passed.
- PostgreSQL, HTTP, and mobile Chino-scale baselines passed; measured values are
  recorded in [`PERFORMANCE_BASELINE.md`](./PERFORMANCE_BASELINE.md).

This evidence is local/staging release evidence. Production health remains an
operational concern and must be evaluated from deployment logs and telemetry.

## Release rule

Do not increase the score for file movement alone. The focused tests, full
verification suite, build, and relevant viewport or workflow checks must pass.
Regressions reduce the affected control to zero until corrected.
