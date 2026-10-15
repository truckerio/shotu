# Inspection deferrals and upcoming maintenance

Delivery scope: inspection-driven deferrals and visit/date/mileage reminders within existing screens. Local code authority only; no commit, push, deployment, provider writes, or production migration authorized.

## Outcome and boundaries
Mechanics record an Attention issue once, defer it to a concrete trigger, and see it again when the same unit returns or reaches its target. Office sees unresolved work in existing operational screens. Samsara supplies observed mileage; manual corrections preserve who changed what and why. No separate maintenance page, dashboard, or AI failure prediction. Workorders own repairs, inspections own findings, and unit mileage has source-specific evidence.

## Workflow
1. In existing inspection checklist, select Issue, severity Attention, describe problem, choose Defer issue, and explain why work can wait.
2. Choose one or more review triggers: next shop visit, date, absolute odometer target, or additional miles from a confirmed baseline. Earliest trigger wins. Default early mileage window is 200 miles; allow 100, 150, or another bounded value. Window is advance notice, never grace beyond target.
3. Inspection remains Issues found. Completing it atomically creates one open deferred follow-up linked to original company, unit, inspection and finding. A deferral is neither Pass nor No workorder needed.
4. New inspection creation/detail and start show prior deferred items. Existing workorder and Unit detail show same obligations. Record creation is not proof of physical arrival: evaluate next-visit trigger only on explicit inspection start or review in an active visit.
5. Show planned/due soon/due/overdue/needs mileage verification, source reading, observation time, target and distance remaining, original inspection, and deferral reason.
6. Office/Admin can create/link an existing same-unit workorder, verify resolution with a reason, or defer again with a new assessment and trigger. Mechanics can see reminders and record inspection findings/readings under existing assignment access. No hidden privilege expansion.
7. Linking means repair planned. Workorder completion is shown as repair completed pending verification; cancellation restores attention. Original report remains immutable. Resolution is an auditable follow-up event, not mutation of old inspection results.

## Trigger rules
- Mileage target: due at target, overdue above target, due soon when remaining distance <= configured window. Remaining distance is target minus canonical current miles.
- Date: due on selected date in shop calendar timezone; overdue after that date. Dates stored with explicit calendar semantics.
- Next visit: display immediately as upcoming, mark due only when subsequent shop visit starts. Do not let original inspection count as its own next visit.
- Missing/stale/conflicting mileage: explicitly needs verification; any known due date/visit still applies. Once verified due/overdue, uncertain later data must not silently clear alert.
- Additional miles: resolve to absolute target from current confirmed baseline and retain baseline/source. Changing mileage later never moves saved target.
- Trailer: visit/date only in initial delivery. Current trailer adapter has no mileage; do not estimate from towing truck. Engine-hour trigger deferred until source timestamps and audited manual-hour contract exist; unsupported options must not appear.
- Repair required or Out of service cannot defer. Maintenance prompts never clear independent repair/availability blocks or authorize dispatch.

## Mileage evidence
Retain Samsara OBD/GPS odometer value and odometer-specific observed timestamp independently of GPS/vehicle sync time. Manual correction is append-only with actor, previous/new reading, actual observed time, recorded time, reason, related inspection/workorder, optimistic version and idempotency key. Keep manual and provider values separate; newer contradictory telemetry becomes conflict, not silent overwrite. Backdated workorder edits do not update unit canonical mileage. Reject negative/nonfinite/future readings and explicitly review decreasing or implausible readings. Convert meters to miles once without rounding targets.

## Reminder ownership and actions
One canonical follow-up per finding, referenced by later records. Reminders are in-app and derive from current obligation state; no email/SMS/browser push. Recompute on inspection/workorder/unit context loads and after new readings; background provider updates must be reflected by normal context refresh. Deduplicate repeated reminders by obligation identity/status. Acknowledge is not resolved; repeating postponement keeps original age and records new reason/count. Group due work into existing workorder using current exact-company/unit/location eligibility. Preserve cancellation reopening and correction/reinspection lineage without creating duplicate obligations.

## Existing owner map and work allocation
- Root: scope, plan/task state, API contracts, UI integration, final evidence.
- Inspection backend: inspection schemas/repository/service/routes, shared due-rule evaluator, forward migration 198, lifecycle tests.
- Mileage backend: Samsara mapper, asset upsert, source-specific mileage repository, forward migration 199, Activity projection and tests.
- Frontend: inspection Issue fields and reminder component embedded in current inspection, workorder and Units surfaces; existing api client and controls.
- Independent verifier/reviewer: read-only after writers idle and patch fingerprint frozen.

## Delivery sequence
1. Audit owners and preserve dirty-worktree baseline.
2. Establish policy validation/evaluation, additive schema, stable follow-up identity and transactional commands.
3. Establish mileage provenance and manual audit.
4. Wire authorized context/read/action endpoints.
5. Embed defer controls, reminders and manual mileage correction in existing screens. Keep optional details collapsed and phone controls usable.
6. Exercise behavior tests, DB migration/lifecycle rehearsal against disposable PostgreSQL, build and rendered desktop/phone checks where local authentication permits.
7. Independent review, bounded repairs, rerun affected checks, report exact remaining limitations.

## Acceptance and regression matrix
- Attention defer persists across reload; repair/OOS rejection; no empty reason/trigger; past targets flagged honestly.
- Inclusive mileage-window boundary, miles/meters conversion, unknown/stale/conflicting readings, combined triggers and date boundaries.
- Prior issue appears at inspection create/start and workorder/unit context; no cross-unit/company leakage, unauthorized location/assignment writes, revoked access or guessed IDs.
- Duplicate saves/retries create one follow-up/reading; stale versions conflict; multi-user edits preserve evidence.
- Manual correction activity includes actor/before/after/reason; next sync preserves manual record and surfaces source conflict.
- Link creates planned state, completion does not falsely claim verified, cancellation restores action; repeated defer and corrections retain original obligation identity.
- Original report/archive unchanged; legacy inspections/follow-ups valid; additive migrations pass representative old-data rehearsal and replay safety under normal migration ledger.
- Visible forms keyboard/phone accessible; errors distinct from empty state; no fake mileage or silent stale data.

## Rollout and rollback
Only apply migrations in confirmed disposable/local database for verification. Never edit applied migration text or hide checksum drift. Production rollout/deployment requires separate authority and backup/rehearsal evidence. Additive schema can remain if app is rolled back; preserve append-only reading/follow-up events. Disable new writes before app rollback if old schema constraints cannot represent new disposition values. Restore data only via reviewed recovery procedure, never by deleting evidence.

## Deferred follow-on work
Recurring manufacturer/service-policy schedules, engine-hour rules, confirmed consumption/parts planning, and statistical failure predictions require separate evidence and contracts. First delivery completes inspection-driven deferral and transparent visit/date/mileage reminders. No unsupported controls or claims of predictive accuracy.

## Local activation gate (2026-10-14)
Read-only inspection of the configured loopback app database confirms applied migration `196_no_stock_tracking.sql` has a checksum different from the unchanged repository file. New migrations 198/199 are not applied to that app database. Do not bypass the checksum guard. Resolve the prior migration discrepancy through evidence-backed schema reconciliation before local app migration/restart. Production activation remains separately authorized work. Disposable PostgreSQL migration replay and authenticated mechanic/Office browser rehearsal are independent evidence, not proof that the user's existing runtime is activated.
