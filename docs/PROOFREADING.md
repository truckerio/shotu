# Proofreading

Workorder narratives use one shared client and one replaceable server boundary.
The goal is useful corrections without letting a network provider block data
entry or silently rewrite technical text.

```text
NarrativeField
  |-- fast check while typing ---------+
  |-- deep check after blur -----------+--> POST /api/proofreading/check
  |                                         |-- WProofreader adapter
  |                                         |     |-- classic spelling + safe grammar
  |                                         |     |-- bounded lexical recovery
  |                                         |     `-- optional WProofreader AI (deep only)
  |                                         `-- optional OpenAI context adapter (deep only)
  `-- personal dictionary actions --------> /api/proofreading/dictionary
                                                    |
                                                    `-- PostgreSQL personal + company terms
```

`frontend/src/components/forms/NarrativeField.jsx` is the shared presentation
owner. Workorder forms must use it instead of importing a provider SDK or
creating a role-specific spellchecker. The provider module normalizes every
result, so the UI is independent of WProofreader and OpenAI response formats.

## User experience and safety rules

- Focused fields wait 650 ms after typing and request `fast` mode. A new edit
  aborts the obsolete browser request.
- A multiline field requests `deep` mode after blur. Deep mode may add
  contextual results but never blocks the fast result.
- Spelling, grammar, and context findings have distinct visual treatment.
- A suggestion is applied only when its range still matches the current text.
  Replacements use a real input event so controlled React forms, autosave, and
  validation receive the change.
- Automatic replacement is limited to one high-confidence, single-token
  spelling correction after a delimiter. It excludes numbers, identifiers,
  acronyms, mixed technical tokens, grammar, and contextual suggestions.
  Corrections do not add a change-history banner or action; the field remains
  directly editable.
- The suggestion menu supports keyboard use, 44 px mobile targets, Ignore once,
  and Add to my dictionary. It is kept inside the visual viewport when the
  mobile keyboard is open.
- During IME composition, checks and automatic replacement are suspended.
- On provider failure the field keeps its value, enables native browser
  spellcheck, and backs off before retrying. Creating, editing, autosaving, and
  submitting a workorder remain available.

Only narrative fields use remote proofreading. Passwords, identifiers, names,
search boxes, part numbers, and quantity controls must remain outside this
pipeline.

## Server pipeline

The primary WProofreader request uses the unified check command so spelling and
grammar are evaluated together. Spelling findings are preserved. Grammar is
accepted only when both the matched text and replacement are a single token.
This prevents a provider's broad phrase rewrite from replacing several words
through one suggestion.

When WProofreader returns an unsafe multiword grammar span, the adapter performs
at most one bounded recovery request with grammar disabled. Misspelled tokens
found inside those spans are mapped back to their exact offsets in the original
text. The recovery text is capped by `PROOFREADING_RECOVERY_MAX_CHARS`.

Deep mode can additionally run:

1. WProofreader AI by sending `enforce_ai=true`; and
2. the OpenAI contextual adapter when explicitly enabled.

The OpenAI adapter uses the Responses API with a strict JSON schema,
`store: false`, and the configured high-confidence threshold. It accepts only
one-token replacements with exact offsets into the submitted text. It does not
rewrite style, punctuation, names, identifiers, part numbers, abbreviations, or
technical terms. Context results are suggestions only and are never
auto-replaced.

The service has a bounded TTL/LRU cache, coalesces identical in-flight checks,
and limits concurrent provider work. Each request has an abortable deadline.
These controls are process-local. Before running more than one application
replica, move cache/coalescing and rate-limit coordination to a shared store
such as Redis or PostgreSQL; otherwise replicas enforce independent limits and
duplicate provider traffic.

## API contracts

All endpoints require the normal authenticated browser session and tenant
authorization. The authenticated request context supplies the actor. A caller
cannot choose another user by sending an ID.

### Check text

`POST /api/proofreading/check`

```json
{
  "text": "Inspectd the brke pads.",
  "language": "en-US",
  "mode": "fast",
  "companyId": "optional-company-uuid"
}
```

- `text` is required, 3 to 5,000 characters.
- `language` defaults to `en-US` and supports `en-US`, `en-CA`, and `en-GB`.
- `mode` defaults to `fast`; valid values are `fast` and `deep`.
- `companyId` is required only when the actor's company cannot be selected
  unambiguously. It must be in the actor's authorized company set.

```json
{
  "provider": "wproofreader",
  "issues": [
    {
      "start": 0,
      "end": 8,
      "problem": "Inspectd",
      "kind": "spelling",
      "message": "Possible spelling mistake.",
      "suggestions": ["Inspected"],
      "confidence": 98
    }
  ]
}
```

`kind` is `spelling`, `grammar`, or `context`. `confidence`, `rule`, and
`autoReplace` are optional metadata. The client validates ranges and normalizes
the issue list again before rendering it. Active personal and company
dictionary terms are excluded from the result and may be sent to WProofreader
as a bounded `user_wordlist` optimization.

### Dictionary

`GET /api/proofreading/dictionary?companyId=<uuid>` returns the effective active
company and personal entries:

```json
{
  "terms": [
    {
      "id": "uuid",
      "companyId": "uuid",
      "ownerUserId": "uuid-or-null",
      "scope": "personal",
      "term": "Bendix",
      "normalizedTerm": "bendix",
      "createdAt": "timestamp",
      "updatedAt": "timestamp"
    }
  ]
}
```

`POST /api/proofreading/dictionary` adds or reactivates a term. `DELETE` soft
removes it. Both accept JSON:

```json
{
  "term": "Bendix",
  "companyId": "optional-company-uuid",
  "scope": "personal"
}
```

`scope` defaults to `personal`. Any authenticated actor may manage their own
personal terms. Only an admin with access to the selected company may add or
remove `company` terms. Terms are normalized case-insensitively, must be 2 to
64 characters, and may contain letters, apostrophes, hyphens, and spaces. The
response is `{ "term": <presented-term-object> }`.

## Configuration

The complete example belongs in `.env.example`; this section explains the
runtime groups without including credentials.

```dotenv
PROOFREADING_PROVIDER=wproofreader
WPROOFREADER_SERVICE_ID=
PROOFREADING_TIMEOUT_MS=3000
PROOFREADING_DEEP_TIMEOUT_MS=5000
PROOFREADING_CACHE_TTL_MS=30000
PROOFREADING_CACHE_MAX_ENTRIES=250
PROOFREADING_CONCURRENCY_LIMIT=4
PROOFREADING_RECOVERY_MAX_CHARS=1200

PROOFREADING_DEEP_MODE_ENABLED=false
PROOFREADING_CONTEXT_PROVIDER=disabled
PROOFREADING_CONTEXT_TIMEOUT_MS=5000
PROOFREADING_CONTEXT_MIN_CONFIDENCE=95
PROOFREADING_OPENAI_MODEL=gpt-5.6-luna
OPENAI_API_KEY=
OPENAI_API_BASE_URL=https://api.openai.com/v1
```

Keep provider credentials only in an untracked local environment file and the
deployment secret manager. Do not expose them through Vite variables, browser
responses, logs, screenshots, or support exports. WProofreader documents its
HTTP API at <https://webspellchecker.com/wsc-web-api/>. The OpenAI adapter uses
the Responses API at <https://platform.openai.com/docs/api-reference/responses>.

`PROOFREADING_PROVIDER=disabled` leaves native browser spellcheck in control.
Set the context provider to `openai` only after completing the privacy and
quality gates below. A configured API key by itself does not opt the product
into contextual processing.

## Benchmark and verification

The shop-language corpus includes difficult misspellings, contextual word
choice, clean technical prose, and identifiers. Run the real configured
providers with:

```bash
npm run test:proofreading:benchmark
# optional local provider overrides may live in ignored .env.proofreading
# equivalent: node --env-file=.env --env-file-if-exists=.env.proofreading scripts/proofreading/benchmark.js
```

The command exits nonzero when recall, unexpected-result, or p95 latency
thresholds fail. The defaults can be tightened with
`PROOFREADING_BENCHMARK_MIN_RECALL`,
`PROOFREADING_BENCHMARK_MAX_UNEXPECTED`, and
`PROOFREADING_BENCHMARK_MAX_P95_MS`. Do not relax thresholds to make a provider
change pass. Review false positives on clean technical notes and identifiers,
then record the provider, model, mode, corpus revision, date, recall, unexpected
results, and p95 latency in the release evidence.

Also run:

```bash
npm run test:proofreading
npm run verify
```

Complete the desktop, phone, keyboard, IME, stale-response, provider-failure,
dictionary, auto-replace, direct editing, and autosave walkthrough in
[the runbook](operations/proofreading-runbook.md).

## Adding or replacing a provider

1. Implement a provider-specific adapter under
   `src/server/modules/proofreading/providers/`. Keep credentials and transport
   details inside that adapter.
2. Implement `name` and `check({ text, language, mode, dictionaryTerms,
   signal })`; return normalized issues only.
3. Validate exact ranges, cap suggestions, reject unsafe rewrites, and preserve
   fail-open behavior. Never make a form depend on provider fields.
4. Register the provider behind configuration in `proofreading.service.js`.
   Do not import it from `NarrativeField` or a workorder feature.
5. Add normalization, timeout, abort, malformed-response, and outage tests.
6. Run the local corpus in fast and deep modes, compare it with the deployed
   provider, and complete privacy/vendor review.
7. Deploy disabled or to a limited environment first. Watch latency, error
   rate, provider usage, false positives, and workorder-save failures before
   changing the production setting.
8. Remove the old adapter and configuration only after the replacement is live,
   observable, reversible, and no longer referenced.

See [proofreading operations](operations/proofreading-runbook.md),
[data processing](operations/proofreading-data-processing.md), and the
[production gate](operations/production-gate.md) for the release controls.
