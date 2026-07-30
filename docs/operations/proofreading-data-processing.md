# Proofreading Data Processing

This document records the application's current proofreading data flow and the
questions that must be resolved before a provider is enabled in production. It
is an engineering inventory, not a substitute for the company's privacy notice,
data-processing agreement, or legal review.

## Purpose and scope

Remote proofreading helps operators find spelling, narrowly safe grammar, and
optional high-confidence contextual word-choice issues in workorder narrative
fields. It must not be used for passwords, authentication data, names,
identifiers, part numbers, quantity fields, search queries, or unrelated free
text.

Workorder narratives can still contain personal, operational, vehicle, repair,
location, customer, or safety information typed by an operator. Treat every
narrative request as confidential company data even when the UI does not ask
for those categories explicitly.

## Data-flow inventory

| Stage | Data | Recipient/location | Durable? | Control |
| --- | --- | --- | --- | --- |
| Browser field | Current narrative text, language, fast/deep mode, optional company selector | User device | Only through the normal form/draft/autosave workflow | Shared `NarrativeField`; no provider credential in browser |
| Application check route | Authenticated actor context, authorized company, effective dictionary terms, narrative request | Application process | Check payload is not intentionally persisted by proofreading | Request validation, tenant authorization, bounded size, request deadline |
| WProofreader classic/deep | Narrative text, language, bounded accepted-word list, mode flags | WProofreader HTTPS API | Vendor retention is not established in this repository | Server-only service ID, bounded payload, fail-open adapter |
| WProofreader lexical recovery | Only bounded text from unsafe grammar spans, language, grammar-disabled flag | WProofreader HTTPS API | Vendor retention is not established in this repository | One best-effort bounded recovery request |
| OpenAI context, optional | Narrative text plus fixed instructions and strict output schema | OpenAI Responses API | Request sets `store: false`; other provider logging/abuse-monitoring retention must still be confirmed contractually | Explicit feature configuration, English/deep only, high-confidence exact-range filtering |
| Response to browser | Normalized issue offsets, problem token, message, suggestions, optional confidence/rule | Authenticated user device | React state only unless browser tooling captures it | No credentials or raw provider response |
| Personal/company dictionary | Display term, normalized term, company, optional owner, creator/remover, timestamps | PostgreSQL | Durable; removal is soft and audit events remain | Tenant-scoped service authorization and migration 040 constraints |
| Service controls | Hash-derived check-cache key and normalized results; effective dictionary rows; identical in-flight promise; actor rate-limit counters | Application memory | TTL/window/process lifetime only | Bounded process-local caches, coalescing, concurrency, and rate limiting |

The cache key is a one-way hash of the request inputs and does not expose text
as a key. Cached normalized findings still contain matched tokens and remain in
process memory until eviction or process exit. The application must not log
request bodies, narrative text, provider prompts/responses, dictionary contents,
cookies, service IDs, or API keys.

## Data minimization

- Send only the active narrative field, not the whole workorder, user profile,
  asset record, attachments, chat, or rendered document.
- Keep checks within the 5,000-character API limit. Lexical recovery has a
  smaller configurable cap.
- Select tenant and personal dictionary terms on the server. Do not send user
  IDs, roles, email addresses, or location records to providers.
- Send at most the bounded provider word list needed to suppress accepted
  vocabulary. PostgreSQL remains dictionary truth.
- Use fast mode while typing and deep/context only on blur to reduce provider
  disclosure and traffic.
- Reject broad or uncertain contextual rewrites. Return only normalized findings
  needed for the operator to decide.
- Do not use provider responses or workorder text for model training, analytics,
  or product experiments without a separate approved purpose and notice.

## Authorization and tenant separation

The proofreading route uses the authenticated request actor. When an actor has
one company, the server can select it. Otherwise the caller supplies a company
ID that is checked against the actor's authorized company set. The browser
cannot choose another dictionary owner.

Every dictionary row has a `company_id`. A personal row has the current actor as
`owner_user_id`; a company row has no owner. Personal mutations are self-service.
Company mutations require an admin authorized for that company. Effective
checks union the actor's active personal terms with active company terms. The
database's composite owner/company foreign key prevents a personal dictionary
row from referring to an owner outside that company membership.

Provider-side dictionary identifiers or account groupings are never trusted as
tenant boundaries. If vendor dictionaries are added later as a transport cache,
PostgreSQL authorization and local result suppression must remain authoritative.

## Retention and deletion

The proofreading check path does not intentionally write narrative requests or
normalized issues to PostgreSQL. Process-memory cache entries expire according
to `PROOFREADING_CACHE_TTL_MS` and disappear on process restart. Confirm that
application, proxy, APM, error-reporting, and provider logs do not capture
request bodies before production enablement.

Dictionary terms are durable application data. Removal marks a term inactive
and retains the row plus append-only audit event. Current foreign keys cascade
company deletion but generally preserve user-related history through restricted
or nullable references. Define and approve support, user-deletion,
company-offboarding, legal-hold, and backup-expiry handling before promising a
specific dictionary deletion interval.

The repository does not establish WProofreader or OpenAI operational-log,
backup, abuse-monitoring, or support-copy retention. `store: false` prevents the
OpenAI request from opting into stored Responses objects, but it must not be
described as a complete zero-retention guarantee. Obtain current written terms
for every enabled provider and deployment region.

## Production privacy and vendor gate

Before enabling WProofreader deep AI or OpenAI context, record an owner and
evidence for:

- legal basis and user/customer notice for transmitting workorder narratives;
- signed data-processing agreement and complete subprocessor list;
- processing and backup regions, cross-border transfer mechanism, and customer
  residency commitments;
- operational, abuse-monitoring, support, and backup retention periods;
- deletion request and company-offboarding procedure, including backups;
- provider use of customer data for training or service improvement, with that
  use contractually disabled where required;
- encryption in transit, credential storage, access controls, auditability,
  breach notification, and security/availability documentation;
- provider availability targets, quotas, rate limits, cost controls, and
  escalation contacts;
- whether sensitive categories are prohibited and how the product prevents or
  warns against entering them;
- an approved synthetic benchmark and false-positive review.

If any answer is unknown, keep that layer disabled in production. An available
credential is not approval. Record decisions in the release evidence and link
them from the general [production gate](production-gate.md).

## Incident handling

For suspected narrative or credential exposure:

1. Disable the context layer, then the primary provider if necessary. Workorder
   entry remains available through fail-open/native behavior.
2. Rotate the affected server-side credential through the secret manager. Do
   not place the old or new value in a ticket.
3. Preserve request IDs, timestamps, route status, provider account identifiers,
   and aggregate counts without copying narrative bodies.
4. Determine which provider, environment, tenant set, and time window were
   affected using approved logs.
5. Follow the company's security/privacy incident process and provider
   notification terms.
6. Re-enable one layer at a time only after containment, corrected configuration,
   synthetic verification, and approval.

See the [proofreading runbook](proofreading-runbook.md) for operational steps.
