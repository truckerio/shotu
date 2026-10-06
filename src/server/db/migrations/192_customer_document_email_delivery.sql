set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table customer_document_access_grants
  add constraint customer_document_grant_delivery_scope_key
  unique(company_id,location_id,document_id,revision_id,id);

create table customer_document_email_deliveries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  document_id uuid not null,
  revision_id uuid not null,
  grant_id uuid not null,
  requested_by_user_id uuid not null references user_profiles(id) on delete restrict,
  recipient_email varchar(320) not null,
  status varchar(24) not null check (status in ('requested','provider_accepted','failed','not_configured')),
  idempotency_key varchar(120) not null,
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  requested_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (company_id,location_id,document_id,revision_id)
    references customer_document_revisions(company_id,location_id,document_id,id) on delete restrict,
  foreign key (company_id,location_id,document_id,revision_id,grant_id)
    references customer_document_access_grants(company_id,location_id,document_id,revision_id,id) on delete restrict,
  unique(company_id,id),
  unique(company_id,requested_by_user_id,idempotency_key)
);

create table customer_document_email_delivery_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  delivery_id uuid not null,
  status varchar(24) not null check (status in ('requested','provider_accepted','failed','not_configured')),
  created_at timestamptz not null default now(),
  foreign key (company_id,delivery_id) references customer_document_email_deliveries(company_id,id) on delete restrict,
  unique(delivery_id,status)
);

create or replace function guard_customer_document_email_delivery()
returns trigger language plpgsql as $$ begin
  if tg_op = 'DELETE' then
    raise exception 'Customer email delivery requests cannot be deleted.' using errcode='55000';
  end if;
  if (to_jsonb(new) - array['status','resolved_at']) is distinct from
      (to_jsonb(old) - array['status','resolved_at']) then
    raise exception 'Customer email delivery request identity is immutable.' using errcode='55000';
  end if;
  if old.status <> 'requested' or new.status not in ('provider_accepted','failed','not_configured')
    or old.resolved_at is not null or new.resolved_at is null then
    raise exception 'Customer email delivery resolution is final.' using errcode='23514';
  end if;
  return new;
end; $$;
create trigger customer_document_email_delivery_guard
before update or delete on customer_document_email_deliveries
for each row execute function guard_customer_document_email_delivery();

create or replace function guard_customer_document_email_delivery_event()
returns trigger language plpgsql as $$ begin
  raise exception 'Customer email delivery events are immutable.' using errcode='55000';
end; $$;
create trigger customer_document_email_delivery_event_immutable
before update or delete on customer_document_email_delivery_events
for each row execute function guard_customer_document_email_delivery_event();
