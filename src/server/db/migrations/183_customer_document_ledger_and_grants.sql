set local lock_timeout = '5s';
set local statement_timeout = '60s';

create unique index if not exists operational_workorders_company_location_id_uidx
  on operational_workorders(company_id, location_id, id);
create unique index if not exists workorder_drafts_company_location_id_uidx
  on workorder_drafts(company_id, location_id, id);

create table customer_documents (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid not null,
  draft_id uuid,
  workorder_id uuid,
  document_type varchar(16) not null check (document_type in ('estimate', 'invoice')),
  number_series_id uuid not null,
  number_value bigint not null check (number_value > 0),
  document_number varchar(64) not null check (char_length(btrim(document_number)) between 2 and 64),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  constraint customer_document_source_shape check (draft_id is not null or workorder_id is not null),
  constraint customer_document_location_fk
    foreign key (company_id, location_id) references locations(company_id, id) on delete restrict,
  constraint customer_document_draft_fk
    foreign key (company_id, location_id, draft_id)
    references workorder_drafts(company_id, location_id, id) on delete restrict,
  constraint customer_document_workorder_fk
    foreign key (company_id, location_id, workorder_id)
    references operational_workorders(company_id, location_id, id) on delete restrict,
  constraint customer_document_number_series_fk
    foreign key (company_id, number_series_id, document_type)
    references customer_document_number_series(company_id, id, document_type) on delete restrict,
  unique (company_id, id),
  unique (company_id, location_id, id),
  unique (company_id, number_series_id, number_value),
  unique (company_id, document_type, document_number)
);

create index customer_documents_source_idx
  on customer_documents(company_id, location_id, workorder_id, draft_id, document_type, created_at desc);

create or replace function guard_customer_document_identity()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer documents cannot be deleted.' using errcode = '55000';
  end if;
  if old.workorder_id is null and new.workorder_id is not null
    and (to_jsonb(new) - 'workorder_id') = (to_jsonb(old) - 'workorder_id') then
    return new;
  end if;
  if new is not distinct from old then return new; end if;
  raise exception 'Customer document identity is immutable except for one-way Workorder binding.' using errcode = '55000';
end;
$$;

create trigger customer_document_identity_guard
before update or delete on customer_documents
for each row execute function guard_customer_document_identity();

create table customer_document_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid not null,
  document_id uuid not null,
  revision_number integer not null check (revision_number > 0),
  predecessor_revision_id uuid,
  profile_version_id uuid not null,
  snapshot jsonb not null check (jsonb_typeof(snapshot) = 'object'),
  content_hash char(64) not null check (content_hash ~ '^[0-9a-f]{64}$'),
  financial_fingerprint char(64) not null check (financial_fingerprint ~ '^[0-9a-f]{64}$'),
  recipient_snapshot jsonb not null check (jsonb_typeof(recipient_snapshot) = 'object'),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$' and currency not in ('UNK', 'XXX', 'ZZZ')),
  subtotal numeric(18,4) not null,
  discount_total numeric(18,4) not null check (discount_total >= 0),
  tax_total numeric(18,4) not null,
  total_amount numeric(18,4) not null,
  invoice_readiness jsonb,
  approved_estimate_revision_id uuid,
  issued_by_user_id uuid not null references user_profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_document_revision_document_fk
    foreign key (company_id, location_id, document_id)
    references customer_documents(company_id, location_id, id) on delete restrict,
  constraint customer_document_revision_predecessor_fk
    foreign key (company_id, document_id, predecessor_revision_id)
    references customer_document_revisions(company_id, document_id, id) on delete restrict,
  constraint customer_document_revision_profile_fk
    foreign key (company_id, profile_version_id)
    references customer_document_profile_versions(company_id, id) on delete restrict,
  constraint customer_document_revision_invoice_shape check (
    invoice_readiness is null or jsonb_typeof(invoice_readiness) = 'object'
  ),
  unique (company_id, id),
  unique (company_id, document_id, id),
  unique (company_id, location_id, document_id, id),
  unique (company_id, document_id, id, content_hash),
  unique (company_id, location_id, document_id, id, content_hash),
  unique (company_id, document_id, revision_number),
  unique (company_id, issued_by_user_id, idempotency_key)
);

alter table customer_document_revisions
  add constraint customer_document_revision_approved_estimate_fk
  foreign key (company_id, approved_estimate_revision_id)
  references customer_document_revisions(company_id, id) on delete restrict;

create index customer_document_revision_history_idx
  on customer_document_revisions(company_id, document_id, revision_number desc);

create or replace function validate_customer_document_revision_insert()
returns trigger language plpgsql as $$
declare document_row customer_documents%rowtype;
declare latest customer_document_revisions%rowtype;
declare profile_location uuid;
begin
  select * into document_row
  from customer_documents
  where company_id = new.company_id and id = new.document_id
  for update;
  if not found or document_row.location_id <> new.location_id then
    raise exception 'Customer document revision scope does not match its document.' using errcode = '23503';
  end if;
  select * into latest
  from customer_document_revisions
  where company_id = new.company_id and document_id = new.document_id
  order by revision_number desc limit 1;
  if latest.id is null then
    if new.revision_number <> 1 or new.predecessor_revision_id is not null then
      raise exception 'The first customer document revision must be revision 1.' using errcode = '23514';
    end if;
  elsif new.revision_number <> latest.revision_number + 1 or new.predecessor_revision_id <> latest.id then
    raise exception 'Customer document revisions must advance from the current predecessor.' using errcode = '23514';
  end if;
  select profile.location_id into profile_location
  from customer_document_profile_versions version
  join customer_document_profiles profile
    on profile.company_id = version.company_id and profile.id = version.profile_id
  where version.company_id = new.company_id and version.id = new.profile_version_id;
  if profile_location is not null and profile_location <> new.location_id then
    raise exception 'Customer document profile is not valid for this location.' using errcode = '23514';
  end if;
  if document_row.document_type = 'estimate' and (new.invoice_readiness is not null or new.approved_estimate_revision_id is not null) then
    raise exception 'Estimate revisions cannot carry Invoice readiness evidence.' using errcode = '23514';
  end if;
  if document_row.document_type = 'invoice' and (
    new.invoice_readiness is null
    or not (new.invoice_readiness ? 'workorderVersion')
    or not (new.invoice_readiness ? 'reconciliationHash')
    or not (new.invoice_readiness ? 'authorizationBasis')
  ) then
    raise exception 'Invoice revisions require complete readiness evidence.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger customer_document_revision_insert_guard
before insert on customer_document_revisions
for each row execute function validate_customer_document_revision_insert();

create or replace function protect_customer_document_revision()
returns trigger language plpgsql as $$
begin
  raise exception 'Issued customer document revisions are immutable.' using errcode = '55000';
end;
$$;

create trigger customer_document_revision_immutable
before update or delete on customer_document_revisions
for each row execute function protect_customer_document_revision();

create table customer_document_access_grants (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  token_hash char(64) not null check (token_hash ~ '^[0-9a-f]{64}$'),
  token_hint varchar(16) not null check (char_length(token_hint) between 4 and 16),
  allowed_actions text[] not null,
  workorder_id uuid,
  issued_by_user_id uuid not null references user_profiles(id) on delete restrict,
  issued_at timestamptz not null default now(),
  expires_at timestamptz not null,
  revoked_at timestamptz,
  revoked_by_user_id uuid references user_profiles(id) on delete restrict,
  revocation_reason varchar(500),
  last_used_at timestamptz,
  idempotency_key varchar(160) not null check (char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  constraint customer_document_grant_revision_fk
    foreign key (company_id, location_id, document_id, revision_id)
    references customer_document_revisions(company_id, location_id, document_id, id) on delete restrict,
  constraint customer_document_grant_workorder_fk
    foreign key (company_id, location_id, workorder_id)
    references operational_workorders(company_id, location_id, id) on delete restrict,
  constraint customer_document_grant_actions_check check (
    cardinality(allowed_actions) between 1 and 3
    and allowed_actions <@ array['view_revision','respond_revision','customer_chat']::text[]
    and 'view_revision' = any(allowed_actions)
  ),
  constraint customer_document_grant_expiry_check check (expires_at > issued_at),
  constraint customer_document_grant_revocation_shape check (
    (revoked_at is null and revoked_by_user_id is null and revocation_reason is null)
    or (revoked_at is not null and revoked_by_user_id is not null
      and revocation_reason is not null and revoked_at >= issued_at
      and char_length(btrim(revocation_reason)) between 2 and 500)
  ),
  unique (token_hash),
  unique (company_id, id),
  unique (company_id, issued_by_user_id, idempotency_key)
);

create index customer_document_grant_scope_idx
  on customer_document_access_grants(company_id, document_id, revision_id, expires_at desc);

create or replace function guard_customer_document_access_grant()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer document access grants cannot be deleted.' using errcode = '55000';
  end if;
  if (to_jsonb(new) - array['revoked_at','revoked_by_user_id','revocation_reason','last_used_at'])
    is distinct from
     (to_jsonb(old) - array['revoked_at','revoked_by_user_id','revocation_reason','last_used_at']) then
    raise exception 'Customer document access grant identity is immutable.' using errcode = '55000';
  end if;
  if old.revoked_at is not null and row(new.revoked_at,new.revoked_by_user_id,new.revocation_reason)
    is distinct from row(old.revoked_at,old.revoked_by_user_id,old.revocation_reason) then
    raise exception 'Customer document access grant revocation is permanent.' using errcode = '55000';
  end if;
  if new.last_used_at is not null and old.last_used_at is not null and new.last_used_at < old.last_used_at then
    raise exception 'Customer document grant usage time cannot move backward.' using errcode = '23514';
  end if;
  return new;
end;
$$;

create trigger customer_document_access_grant_guard
before update or delete on customer_document_access_grants
for each row execute function guard_customer_document_access_grant();

create table customer_document_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  location_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  revision_hash char(64) not null check (revision_hash ~ '^[0-9a-f]{64}$'),
  event_type varchar(32) not null check (event_type in (
    'issued','superseded','voided','accepted','declined','changes_requested',
    'grant_issued','grant_revoked','viewed','workorder_bound',
    'delivery_requested','provider_accepted','delivery_failed','bounced','delivered'
  )),
  actor_type varchar(16) not null check (actor_type in ('staff','customer','system')),
  actor_user_id uuid references user_profiles(id) on delete restrict,
  access_grant_id uuid,
  displayed_amount numeric(18,4),
  currency varchar(3),
  metadata jsonb not null default '{}'::jsonb check (jsonb_typeof(metadata) = 'object'),
  idempotency_key varchar(200) not null check (char_length(idempotency_key) between 8 and 200),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint customer_document_event_revision_fk
    foreign key (company_id, location_id, document_id, revision_id, revision_hash)
    references customer_document_revisions(company_id, location_id, document_id, id, content_hash) on delete restrict,
  constraint customer_document_event_grant_fk
    foreign key (company_id, access_grant_id)
    references customer_document_access_grants(company_id, id) on delete restrict,
  constraint customer_document_event_actor_shape check (
    (actor_type = 'staff' and actor_user_id is not null and access_grant_id is null)
    or (actor_type = 'customer' and actor_user_id is null and access_grant_id is not null)
    or (actor_type = 'system' and actor_user_id is null and access_grant_id is null)
  ),
  constraint customer_document_event_amount_shape check (
    (displayed_amount is null and currency is null)
    or (displayed_amount is not null and currency ~ '^[A-Z]{3}$')
  ),
  unique (company_id, id)
);

create unique index customer_document_event_staff_command_uidx
  on customer_document_events(company_id, actor_user_id, idempotency_key)
  where actor_user_id is not null;
create unique index customer_document_event_grant_command_uidx
  on customer_document_events(company_id, access_grant_id, idempotency_key)
  where access_grant_id is not null;
create unique index customer_document_event_terminal_response_uidx
  on customer_document_events(company_id, revision_id)
  where event_type in ('accepted','declined','changes_requested');
create unique index customer_document_event_void_uidx
  on customer_document_events(company_id, revision_id)
  where event_type = 'voided';
create unique index customer_document_event_superseded_uidx
  on customer_document_events(company_id, revision_id)
  where event_type = 'superseded';
create index customer_document_event_history_idx
  on customer_document_events(company_id, document_id, created_at, id);

create or replace function validate_customer_document_event_insert()
returns trigger language plpgsql as $$
declare grant_row customer_document_access_grants%rowtype;
declare document_kind varchar(16);
declare latest_revision_id uuid;
begin
  if new.event_type in ('accepted','declined','changes_requested') then
    select * into grant_row
    from customer_document_access_grants
    where company_id = new.company_id and id = new.access_grant_id
    for update;
    if not found
      or grant_row.document_id <> new.document_id
      or grant_row.revision_id <> new.revision_id
      or grant_row.revoked_at is not null
      or grant_row.expires_at <= now()
      or not ('respond_revision' = any(grant_row.allowed_actions)) then
      raise exception 'Customer document grant cannot respond to this revision.' using errcode = '42501';
    end if;
    select document_type into document_kind
    from customer_documents
    where company_id = new.company_id and id = new.document_id
    for update;
    if document_kind <> 'estimate' then
      raise exception 'Only Estimate revisions accept customer responses.' using errcode = '23514';
    end if;
    select id into latest_revision_id
    from customer_document_revisions
    where company_id = new.company_id and document_id = new.document_id
    order by revision_number desc limit 1;
    if latest_revision_id <> new.revision_id
      or exists (
        select 1 from customer_document_events existing
        where existing.company_id = new.company_id
          and existing.revision_id = new.revision_id
          and existing.event_type in ('voided','superseded')
      ) then
      raise exception 'Customer document revision is no longer response eligible.' using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;

create trigger customer_document_event_insert_guard
before insert on customer_document_events
for each row execute function validate_customer_document_event_insert();

create or replace function protect_customer_document_event()
returns trigger language plpgsql as $$
begin
  raise exception 'Customer document events are append-only.' using errcode = '55000';
end;
$$;

create trigger customer_document_event_immutable
before update or delete on customer_document_events
for each row execute function protect_customer_document_event();

comment on table customer_document_revisions is
  'Immutable customer-safe issued projections. No Receipt document type exists in this release.';
comment on column customer_document_access_grants.token_hash is
  'SHA-256 digest of a cryptographically random portal token. Raw tokens must never be persisted.';
