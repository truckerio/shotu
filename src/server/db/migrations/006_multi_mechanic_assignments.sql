create table if not exists workorder_mechanic_assignments (
  id uuid primary key default gen_random_uuid(),
  workorder_id uuid not null references operational_workorders(id) on delete cascade,
  mechanic_user_id uuid not null references app_users(id) on delete restrict,
  assignment_role text not null default 'support' check (assignment_role in ('primary', 'support')),
  active boolean not null default true,
  assigned_by_user_id uuid references app_users(id) on delete set null,
  assigned_at timestamptz not null default now(),
  released_at timestamptz,
  reason text not null default ''
);

create index if not exists workorder_mechanic_assignments_workorder_idx
  on workorder_mechanic_assignments(workorder_id, active, assigned_at);

create index if not exists workorder_mechanic_assignments_mechanic_idx
  on workorder_mechanic_assignments(mechanic_user_id, active, assigned_at desc);

create unique index if not exists workorder_mechanic_assignments_active_user_idx
  on workorder_mechanic_assignments(workorder_id, mechanic_user_id)
  where active = true;

create unique index if not exists workorder_mechanic_assignments_primary_idx
  on workorder_mechanic_assignments(workorder_id)
  where active = true and assignment_role = 'primary';

insert into workorder_mechanic_assignments (
  workorder_id,
  mechanic_user_id,
  assignment_role,
  active,
  assigned_by_user_id,
  assigned_at,
  reason
)
select
  wo.id,
  wo.current_mechanic_id,
  'primary',
  true,
  wo.created_by_user_id,
  coalesce(wo.accepted_at, wo.updated_at, wo.created_at),
  'Backfilled from primary mechanic'
from operational_workorders wo
where wo.current_mechanic_id is not null
  and not exists (
    select 1
    from workorder_mechanic_assignments assignment
    where assignment.workorder_id = wo.id
      and assignment.mechanic_user_id = wo.current_mechanic_id
      and assignment.active = true
  );
