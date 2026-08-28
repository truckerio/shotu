set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table part_fulfillment_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  catalog_part_id uuid not null,
  destination_location_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0 and quantity <= 999999.999),
  uom_code text not null references units_of_measure(code),
  needed_by date,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  recommendation_version integer not null default 1 check (recommendation_version >= 1),
  state varchar(32) not null default 'recommended' check (state in ('recommended', 'approved', 'partially_fulfilled', 'backordered', 'completed', 'cancelled', 'reconciliation_required')),
  created_by_user_id uuid not null references user_profiles(id) on delete restrict,
  approved_by_user_id uuid references user_profiles(id) on delete restrict,
  approval_idempotency_key varchar(120) check (approval_idempotency_key is null or char_length(approval_idempotency_key) between 8 and 120),
  approval_request_hash char(64) check (approval_request_hash is null or approval_request_hash ~ '^[0-9a-f]{64}$'),
  approved_at timestamptz,
  cancelled_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_fulfillment_request_workorder_company_fk foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict,
  constraint part_fulfillment_request_catalog_company_fk foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete restrict,
  constraint part_fulfillment_request_destination_company_fk foreign key (company_id, destination_location_id) references locations(company_id, id) on delete restrict,
  unique (company_id, created_by_user_id, idempotency_key),
  unique (company_id, id)
);

create table part_fulfillment_legs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  fulfillment_request_id uuid not null,
  route_type varchar(32) not null check (route_type in ('destination_stock', 'internal_transfer')),
  source_location_id uuid,
  destination_location_id uuid not null,
  quantity numeric(14, 3) not null check (quantity > 0),
  uom_code text not null references units_of_measure(code),
  state varchar(32) not null check (state in ('proposed', 'reserved', 'ready_for_transfer', 'partially_available', 'backordered', 'cancelled', 'reconciliation_required')),
  inventory_item_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_fulfillment_leg_request_company_fk foreign key (company_id, fulfillment_request_id) references part_fulfillment_requests(company_id, id) on delete cascade,
  constraint part_fulfillment_leg_source_company_fk foreign key (company_id, source_location_id) references locations(company_id, id) on delete restrict,
  constraint part_fulfillment_leg_destination_company_fk foreign key (company_id, destination_location_id) references locations(company_id, id) on delete restrict,
  constraint part_fulfillment_leg_inventory_company_fk foreign key (company_id, inventory_item_id) references inventory_items(company_id, id) on delete restrict,
  constraint part_fulfillment_leg_route_shape check (
    (route_type = 'destination_stock' and source_location_id is null)
    or (route_type = 'internal_transfer' and source_location_id is not null and source_location_id <> destination_location_id)
    or (route_type = 'internal_transfer' and state = 'backordered' and source_location_id is null)
  ),
  unique (company_id, id)
);

create table part_fulfillment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  fulfillment_request_id uuid not null,
  event_type varchar(48) not null,
  actor_id uuid references user_profiles(id) on delete restrict,
  details jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  constraint part_fulfillment_event_request_company_fk foreign key (company_id, fulfillment_request_id) references part_fulfillment_requests(company_id, id) on delete cascade
);

create index part_fulfillment_requests_destination_state_idx on part_fulfillment_requests (company_id, destination_location_id, state, needed_by, created_at desc, id);
create index part_fulfillment_requests_workorder_idx on part_fulfillment_requests (company_id, workorder_id, created_at desc, id);
create unique index part_fulfillment_approval_idempotency_idx
  on part_fulfillment_requests (company_id, approved_by_user_id, approval_idempotency_key)
  where approval_idempotency_key is not null;
create index part_fulfillment_legs_source_lookup_idx on part_fulfillment_legs (company_id, source_location_id, state, created_at desc, id);
create index part_fulfillment_events_history_idx on part_fulfillment_events (company_id, fulfillment_request_id, created_at, id);

comment on table part_fulfillment_requests is 'Application-owned recommendation and approval record. It does not claim provider transfer or purchase success.';
comment on table part_fulfillment_legs is 'Immutable-route fulfillment legs. Internal transfers remain ready_for_transfer until a future confirmed provider-command slice.';
