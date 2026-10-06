set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table workorder_drafts drop constraint workorder_draft_authorization_classification_check;
alter table workorder_drafts add constraint workorder_draft_authorization_classification_check
  check (authorization_classification in ('unclassified','approval_not_required','required_external_customer','internal_fleet','exempt'));
alter table workorder_drafts drop constraint workorder_draft_authorization_exception_check;
alter table workorder_drafts add constraint workorder_draft_authorization_exception_check check (
  (authorization_classification in ('unclassified','approval_not_required','required_external_customer') and authorization_exception_reason is null)
  or (authorization_classification in ('internal_fleet','exempt') and char_length(btrim(authorization_exception_reason)) between 2 and 1000)
);

alter table workorder_authorization_events drop constraint workorder_authorization_events_classification_check;
alter table workorder_authorization_events add constraint workorder_authorization_events_classification_check
  check (classification in ('approval_not_required','required_external_customer','internal_fleet','exempt'));
alter table workorder_authorization_events drop constraint workorder_authorization_shape;
alter table workorder_authorization_events add constraint workorder_authorization_shape check (
  (classification='approval_not_required' and activation_policy='approval_not_required_v1'
    and accepted_estimate_revision_id is null and exception_reason is null)
  or (classification='required_external_customer' and accepted_estimate_revision_id is not null and exception_reason is null)
  or (classification in ('internal_fleet','exempt') and accepted_estimate_revision_id is null
    and char_length(btrim(exception_reason)) between 2 and 1000)
);

create table customer_directory_customers (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  name varchar(300) not null check (char_length(btrim(name)) between 1 and 300),
  address varchar(1000),
  version integer not null default 1 check (version > 0),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  updated_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id,id)
);
create index customer_directory_customers_name_idx on customer_directory_customers(company_id,lower(name),id);

create table customer_directory_contacts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  customer_id uuid not null,
  name varchar(300) not null check (char_length(btrim(name)) between 1 and 300),
  email varchar(320),
  phone varchar(100),
  version integer not null default 1 check (version > 0),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  updated_by_user_id uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key (company_id,customer_id) references customer_directory_customers(company_id,id) on delete restrict,
  unique (company_id,customer_id,id)
);
create index customer_directory_contacts_customer_idx on customer_directory_contacts(company_id,customer_id,name,id);
