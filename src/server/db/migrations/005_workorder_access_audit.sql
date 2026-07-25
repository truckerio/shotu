create table if not exists workorder_access_events (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  user_id uuid references app_users(id) on delete set null,
  actor_role text not null,
  event_type text not null default 'opened' check (event_type in ('opened')),
  created_at timestamptz not null default now()
);

create index if not exists workorder_access_events_workorder_idx
  on workorder_access_events(workorder_id, created_at desc);
