-- Company and personal proofreading vocabulary is application-owned. Provider
-- dictionaries are an optional transport optimization, never the source of truth.

create table proofreading_dictionary_terms (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  owner_user_id uuid references user_profiles(id) on delete restrict,
  display_term text not null,
  normalized_term text not null,
  active boolean not null default true,
  created_by_user_id uuid references user_profiles(id) on delete set null,
  removed_by_user_id uuid references user_profiles(id) on delete set null,
  removed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint proofreading_dictionary_terms_display_length
    check (char_length(display_term) between 2 and 64),
  constraint proofreading_dictionary_terms_normalized_length
    check (char_length(normalized_term) between 2 and 64),
  constraint proofreading_dictionary_terms_display_format
    check (display_term ~ '^[[:alpha:]]+([ ''’-][[:alpha:]]+)*$'),
  constraint proofreading_dictionary_terms_normalized_format
    check (normalized_term ~ '^[[:alpha:]]+([ ''-][[:alpha:]]+)*$'),
  constraint proofreading_dictionary_terms_normalized_case
    check (normalized_term = lower(normalized_term)),
  constraint proofreading_dictionary_terms_removal_state
    check (
      (active and removed_at is null and removed_by_user_id is null)
      or
      (not active and removed_at is not null)
    ),
  constraint proofreading_dictionary_terms_owner_company_fk
    foreign key (owner_user_id, company_id)
    references user_company_memberships(user_id, company_id)
    on delete restrict
);

create unique index proofreading_dictionary_terms_active_uidx
  on proofreading_dictionary_terms (
    company_id,
    coalesce(owner_user_id, '00000000-0000-0000-0000-000000000000'::uuid),
    normalized_term
  )
  where active;

create index proofreading_dictionary_terms_lookup_idx
  on proofreading_dictionary_terms (company_id, owner_user_id, normalized_term, updated_at desc);

create table proofreading_dictionary_events (
  id uuid primary key default gen_random_uuid(),
  dictionary_term_id uuid not null references proofreading_dictionary_terms(id) on delete restrict,
  company_id uuid not null references companies(id) on delete cascade,
  owner_user_id uuid references user_profiles(id) on delete restrict,
  actor_user_id uuid references user_profiles(id) on delete set null,
  action text not null check (action in ('add', 'remove')),
  display_term text not null,
  normalized_term text not null,
  created_at timestamptz not null default now(),
  constraint proofreading_dictionary_events_term_length
    check (char_length(normalized_term) between 2 and 64),
  constraint proofreading_dictionary_events_owner_company_fk
    foreign key (owner_user_id, company_id)
    references user_company_memberships(user_id, company_id)
    on delete restrict
);

create index proofreading_dictionary_events_company_created_idx
  on proofreading_dictionary_events (company_id, created_at desc);

create index proofreading_dictionary_events_owner_created_idx
  on proofreading_dictionary_events (owner_user_id, created_at desc)
  where owner_user_id is not null;

comment on table proofreading_dictionary_terms is
  'Tenant-scoped company and personal terms accepted by the proofreading system. Inactive rows preserve removal history.';

comment on table proofreading_dictionary_events is
  'Append-only audit history for proofreading vocabulary additions, reactivations, and removals.';
