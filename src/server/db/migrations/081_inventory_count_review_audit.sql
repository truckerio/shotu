set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_count_review_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  import_id uuid not null,
  line_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action varchar(16) not null check (action in ('match', 'ignore')),
  before_state jsonb not null check (jsonb_typeof(before_state) = 'object' and octet_length(before_state::text) <= 4000),
  after_state jsonb not null check (jsonb_typeof(after_state) = 'object' and octet_length(after_state::text) <= 4000),
  created_at timestamptz not null default now(),
  constraint inventory_count_review_events_import_fk
    foreign key (company_id, import_id) references inventory_count_imports(company_id, id) on delete restrict,
  constraint inventory_count_review_events_line_fk
    foreign key (company_id, line_id) references inventory_count_import_lines(company_id, id) on delete restrict
);

create index inventory_count_review_events_lookup_idx
  on inventory_count_review_events (company_id, import_id, line_id, created_at, id);

comment on table inventory_count_review_events is
  'Append-only transactional before/after evidence for opening-count line review.';
