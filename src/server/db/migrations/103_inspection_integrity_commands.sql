set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inspection_revision_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  predecessor_inspection_id uuid not null,
  successor_inspection_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (company_id, predecessor_inspection_id, successor_inspection_id),
  unique (company_id, actor_id, idempotency_key),
  foreign key (company_id, predecessor_inspection_id) references inspections(company_id, id) on delete restrict,
  foreign key (company_id, successor_inspection_id) references inspections(company_id, id) on delete restrict
);

create table inspection_workorder_create_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  inspection_id uuid not null,
  workorder_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  unique (company_id, actor_id, idempotency_key),
  foreign key (company_id, inspection_id) references inspections(company_id, id) on delete restrict,
  foreign key (company_id, workorder_id) references operational_workorders(company_id, id) on delete restrict
);
