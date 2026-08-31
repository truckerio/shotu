set local lock_timeout = '5s';
set local statement_timeout = '60s';

create unique index inventory_authority_exceptions_company_id_uidx
  on inventory_authority_exceptions (company_id, id);

create table inventory_authority_exception_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  exception_id uuid not null,
  event_type text not null check (event_type in ('acknowledged_no_stock_change')),
  outcome text not null check (outcome = 'resolved_without_stock_mutation'),
  reason text not null check (char_length(btrim(reason)) between 2 and 1000),
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  request_hash text not null,
  details jsonb not null default '{}',
  created_at timestamptz not null default now(),
  constraint inventory_authority_exception_event_exception_fk
    foreign key (company_id, exception_id)
    references inventory_authority_exceptions(company_id, id) on delete restrict,
  unique (company_id, actor_id, idempotency_key)
);

create index inventory_authority_exception_events_exception_idx
  on inventory_authority_exception_events (company_id, exception_id, created_at, id);

comment on table inventory_authority_exception_events is
  'Append-only Admin acknowledgement evidence. Events never create stock, import provider quantities, or release reservations.';
