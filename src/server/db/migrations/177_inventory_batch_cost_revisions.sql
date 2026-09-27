set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_aggregate_cost_layer_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  cost_layer_id uuid not null,
  version bigint not null check (version > 0),
  unit_cost numeric(14,4) not null check (unit_cost >= 0),
  currency varchar(3) not null check (currency ~ '^[A-Z]{3}$'),
  reason text not null check (length(btrim(reason)) between 2 and 500),
  previous_revision_id uuid,
  created_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null,
  request_hash varchar(64) not null,
  effective_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  constraint inventory_cost_layer_revision_layer_fk foreign key(company_id,cost_layer_id)
    references inventory_aggregate_cost_layers(company_id,id) on delete restrict,
  constraint inventory_cost_layer_revision_previous_fk foreign key(company_id,previous_revision_id)
    references inventory_aggregate_cost_layer_revisions(company_id,id) on delete restrict,
  unique(company_id,cost_layer_id,version),
  unique(company_id,created_by,idempotency_key),
  unique(company_id,id)
);

create index inventory_cost_layer_revision_current_idx
  on inventory_aggregate_cost_layer_revisions(company_id,cost_layer_id,version desc);

comment on table inventory_aggregate_cost_layer_revisions is
  'Append-only corrections to aggregate batch cost. Source receipt and invoice values remain immutable; the latest revision is the effective cost for future pricing.';
