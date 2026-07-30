# Proofreading Operations Runbook

Use this runbook when enabling proofreading, changing a provider or model,
investigating missing suggestions, or releasing dictionary changes. Read the
[design and API contract](../PROOFREADING.md) and
[data-processing record](proofreading-data-processing.md) first.

## 1. Preconditions

Confirm that:

- migration `040_proofreading_dictionaries.sql` is present and unmodified;
- `npm run db:check` reports no migration drift;
- provider credentials exist in the environment secret manager, not in tracked
  files or Vite/browser variables;
- WProofreader and any contextual provider are covered by the approved vendor,
  privacy, residency, retention, and incident-response terms;
- the benchmark thresholds and production gate have an accountable reviewer.

Check whether variables are present without printing their values:

```bash
node -e 'for (const name of ["PROOFREADING_PROVIDER", "WPROOFREADER_SERVICE_ID", "PROOFREADING_DEEP_MODE_ENABLED", "PROOFREADING_CONTEXT_PROVIDER", "OPENAI_API_KEY"]) console.log(`${name}: ${process.env[name] ? "configured" : "not configured"}`)'
```

Do not paste environment output, request bodies, narrative text, service IDs,
API keys, cookies, or full provider responses into tickets or chat.

## 2. Local verification

Install dependencies, migrate a disposable/local database, and run focused plus
full checks:

```bash
npm ci
npm run db:migrate
npm run db:check
npm run test:proofreading
npm run test:proofreading:benchmark
# benchmark entry point: node --env-file=.env --env-file-if-exists=.env.proofreading scripts/proofreading/benchmark.js
npm run verify
git diff --check
```

The live benchmark sends its corpus to configured external providers. Run it
only against an approved environment and provider account. Capture aggregate
recall, unexpected findings, p50/p95 latency, provider/model, mode, corpus
revision, and date. Do not capture credentials or unrelated production text.

## 3. Browser walkthrough

Use a real authenticated Admin/Manager, Mechanic, and Surveillance path that
contains each shared narrative field. Verify desktop Chrome/Safari and phone
viewports, including 390 x 844 and 430 x 932.

1. Type a misspelling, pause, and confirm fast mode underlines it without
   moving the caret or changing surrounding text.
2. Type through a delimiter and confirm only an eligible single-token spelling
   correction may auto-apply. Confirm no correction-history banner or Undo
   control appears and the corrected field remains directly editable.
3. Enter a grammar issue and a contextual word-choice issue. Blur the multiline
   field and confirm deep suggestions appear without automatic replacement.
4. Open the suggestion menu with pointer and keyboard. Traverse actions,
   dismiss with Escape, and verify focus returns to the field.
5. Open the mobile keyboard near every viewport edge. Confirm the menu stays in
   the visual viewport, action targets are at least 44 px, and the page has no
   horizontal overflow.
6. Start IME composition and confirm no check or replacement occurs until
   composition ends.
7. Type quickly enough to overlap checks. Confirm an obsolete response never
   marks or changes the new text.
8. Add a spelling token to the personal dictionary. Confirm it disappears for
   that user after refresh but still appears for another user in the company.
9. As an authorized admin, add a company term. Confirm it is suppressed for
   other company users but not for a user in another company. Remove it and
   confirm the finding returns.
10. Save/autosave the form, refresh, and confirm both manual and automatic
    corrections persisted through the normal form path.
11. Verify names, passwords, search, part number, quantity, and identifier
    fields do not call the remote proofreading endpoint.
12. Disable or block the provider. Confirm typed data remains intact, native
    browser spellcheck is available, saves/submission still work, and the
    interface does not show a disruptive provider error.

Inspect the browser console and network panel for uncaught errors, leaked
credentials, request storms, unexpected narrative endpoints, and requests that
continue after navigation. Do not preserve narrative payload screenshots from
real users as test evidence.

## 4. Deployment sequence

1. Apply migration 040 with the matching application release.
2. Initially deploy with contextual processing disabled. Verify classic
   WProofreader, dictionaries, fail-open behavior, and normal workorder writes.
3. If approved, enable deep WProofreader in a limited environment and run the
   corpus plus UI walkthrough.
4. If approved separately, set `PROOFREADING_CONTEXT_PROVIDER=openai` and the
   contextual threshold/model. A present `OPENAI_API_KEY` alone must not enable
   this path.
5. Observe the application for at least 15 minutes: proofreading 5xx/timeout
   rate, request latency, external usage, process CPU/memory, workorder save
   errors, and operator reports of false corrections.
6. Complete the general [production release gate](production-gate.md).

The current concurrency, cache, coalescing, backoff, and route-limit controls
are process-local. Keep one application replica until shared coordination is
implemented and load-tested. Adding replicas without that work multiplies
vendor concurrency and permits independent rate-limit budgets.

## 5. Troubleshooting

### No underline or suggestion

- Confirm the text has at least three characters and the field is a shared
  `NarrativeField`.
- Confirm native spellcheck has not been disabled by an unrelated field policy.
- Check that the request returns `200` and exact issue offsets match the current
  text. Stale or malformed ranges are intentionally discarded.
- Verify `PROOFREADING_PROVIDER`, the WProofreader service ID, language, and
  outbound network access without printing credentials.
- The browser backs off for 30 seconds after a provider error. Wait for the
  backoff or reload only after fixing the cause.

### Spelling is found but a word inside a phrase is missed

- Inspect normalized provider type/range in a safe synthetic test. Broad
  grammar spans should trigger one bounded spelling-only lexical recovery call.
- Confirm `PROOFREADING_RECOVERY_MAX_CHARS` has not truncated the recovery
  segment.
- Add a deterministic corpus case before changing recovery mapping. Do not add
  a hardcoded correction table to a workorder component.

### Contextual suggestion is absent

- Context runs only in `deep` mode after blur and only when deep mode plus the
  configured context provider are enabled.
- Confirm the text is English and long enough for the adapter.
- The adapter intentionally drops confidence below the configured threshold,
  changed offsets, multiword replacements, identifiers, and overlapping
  results.
- A context timeout is best effort; the WProofreader result should remain.

### A technical term remains underlined

- Add it to a personal dictionary or ask an authorized admin to add a company
  term. Do not weaken global spelling rules for one customer term.
- Verify the actor selected an authorized company and the term is active.
- Verify normalization and the 2–64 character letters/apostrophe/hyphen/space
  contract. Part numbers and mixed alphanumeric identifiers are intentionally
  outside dictionary input.

### Too many provider requests or high latency

- Check client debounce and cancellation before increasing capacity.
- Look for identical requests that should be coalesced and cache-key differences
  caused by mode, language, text, or dictionary terms.
- Compare fast and deep benchmark latency. Keep context on blur rather than on
  every keystroke.
- Confirm the application has not been scaled beyond one replica with
  process-local coordination.
- Reduce provider traffic through configuration only after evaluating recall;
  never remove request limits or increase them blindly.

### Provider outage

Keep workorder entry available. Set `PROOFREADING_CONTEXT_PROVIDER=disabled` to
remove only the context layer, or `PROOFREADING_PROVIDER=disabled` to fall back
to native browser spellcheck. Restart/redeploy through the normal configuration
procedure, verify save/autosave, and record the provider incident without
narrative bodies. Re-enable one layer at a time after provider recovery and a
passing synthetic check.

## 6. Rollback and replacement

Configuration rollback is preferred because proofreading is fail-open. Disable
context first, then the primary provider if needed. Do not roll back migration
040 by dropping dictionary or audit tables; deploy a forward fix.

For provider replacement, follow the adapter procedure in
[`docs/PROOFREADING.md`](../PROOFREADING.md). Keep the old adapter available for
configuration rollback until the replacement passes the corpus, privacy gate,
live role walkthrough, and observation period. Remove old code and variables in
a later cleanup release after confirming no runtime references remain.
