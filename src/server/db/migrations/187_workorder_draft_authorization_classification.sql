set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_drafts
  add column authorization_classification varchar(40) not null default 'unclassified',
  add column authorization_exception_reason varchar(1000),
  add constraint workorder_draft_authorization_classification_check check (
    authorization_classification in ('unclassified','required_external_customer','internal_fleet','exempt')
  ),
  add constraint workorder_draft_authorization_exception_check check (
    (authorization_classification in ('unclassified','required_external_customer') and authorization_exception_reason is null)
    or
    (authorization_classification in ('internal_fleet','exempt')
      and char_length(btrim(authorization_exception_reason)) between 2 and 1000)
  );

comment on column workorder_drafts.authorization_classification is
  'Server-persisted authorization path. Unclassified drafts cannot become Workorders.';
comment on column workorder_drafts.authorization_exception_reason is
  'Required audited reason for an Admin-designated internal fleet or exempt authorization exception.';

create table workorder_authorization_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid,
  workorder_id uuid not null,
  classification varchar(40) not null check (classification in ('required_external_customer','internal_fleet','exempt')),
  activation_policy varchar(80) not null,
  exception_reason varchar(1000),
  accepted_estimate_revision_id uuid,
  actor_user_id uuid references user_profiles(id) on delete restrict,
  authority varchar(80) not null,
  created_at timestamptz not null default now(),
  constraint workorder_authorization_workorder_fk foreign key (company_id,location_id,workorder_id)
    references operational_workorders(company_id,location_id,id) on delete restrict,
  constraint workorder_authorization_revision_fk foreign key (company_id,accepted_estimate_revision_id)
    references customer_document_revisions(company_id,id) on delete restrict,
  constraint workorder_authorization_shape check (
    (classification='required_external_customer' and accepted_estimate_revision_id is not null and exception_reason is null)
    or (classification in ('internal_fleet','exempt') and accepted_estimate_revision_id is null
      and char_length(btrim(exception_reason)) between 2 and 1000)
  ),
  unique(company_id,workorder_id)
);

create or replace function guard_workorder_authorization_event()
returns trigger language plpgsql as $$ begin
  raise exception 'Workorder authorization evidence is immutable.' using errcode='55000';
end; $$;
create trigger workorder_authorization_event_immutable
before update or delete on workorder_authorization_events
for each row execute function guard_workorder_authorization_event();
