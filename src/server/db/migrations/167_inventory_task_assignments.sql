set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_task_assignments (
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  source_type varchar(48) not null check(source_type in (
    'damage_inspection','receipt_exception','missing_invoice','invoice_po_decision',
    'no_po_approval','transfer_receipt','position_recount','removed_part_custody'
  )),
  source_id uuid not null,
  capability varchar(64) not null,
  required_role varchar(24) not null check(required_role in ('mechanic','office','surveillance','admin')),
  assigned_user_id uuid references user_profiles(id) on delete restrict,
  version integer not null default 1 check(version>0),
  assigned_by uuid not null references user_profiles(id) on delete restrict,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key(company_id,source_type,source_id),
  foreign key(company_id,location_id) references locations(company_id,id) on delete restrict
);

create index inventory_task_assignments_user_queue
  on inventory_task_assignments(company_id,assigned_user_id,updated_at desc)
  where assigned_user_id is not null;
create index inventory_task_assignments_location_queue
  on inventory_task_assignments(company_id,location_id,updated_at desc);

create table inventory_task_assignment_commands (
  company_id uuid not null references companies(id) on delete cascade,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(160) not null check(char_length(idempotency_key) between 8 and 160),
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  action varchar(16) not null check(action in ('claim','assign','unassign')),
  source_type varchar(48) not null,
  source_id uuid not null,
  result jsonb not null,
  created_at timestamptz not null default now(),
  primary key(company_id,actor_id,idempotency_key),
  foreign key(company_id,source_type,source_id)
    references inventory_task_assignments(company_id,source_type,source_id) on delete restrict
);

create table inventory_task_assignment_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  source_type varchar(48) not null,
  source_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action varchar(16) not null check(action in ('claim','assign','unassign')),
  from_user_id uuid references user_profiles(id) on delete restrict,
  to_user_id uuid references user_profiles(id) on delete restrict,
  assignment_version integer not null check(assignment_version>0),
  reason varchar(500) not null,
  created_at timestamptz not null default now(),
  foreign key(company_id,location_id) references locations(company_id,id) on delete restrict,
  foreign key(company_id,source_type,source_id)
    references inventory_task_assignments(company_id,source_type,source_id) on delete restrict
);

create index inventory_task_assignment_events_source
  on inventory_task_assignment_events(company_id,source_type,source_id,created_at desc,id desc);

comment on table inventory_task_assignments is
  'Actor ownership overlay for derived Inventory tasks. Canonical task lifecycle and stock truth remain in their source tables.';
comment on table inventory_task_assignment_commands is
  'Actor-scoped idempotency evidence for claim, assign and unassign commands.';
comment on table inventory_task_assignment_events is
  'Append-only assignment audit evidence. Assignment actions never mutate inventory stock.';
