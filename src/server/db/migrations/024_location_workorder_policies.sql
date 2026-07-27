create table location_workorder_policies (
  location_id uuid primary key,
  company_id uuid not null,
  mechanic_can_record_parts boolean not null default false,
  updated_by_user_id uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint location_workorder_policies_location_company_fk
    foreign key (company_id, location_id)
    references locations(company_id, id)
    on delete cascade
);

comment on table location_workorder_policies is
  'Location-owned workorder permissions. Missing rows use restrictive application defaults.';

comment on column location_workorder_policies.mechanic_can_record_parts is
  'Allows assigned mechanics to record parts used. Part requests and chat are governed separately.';

insert into location_workorder_policies (
  location_id,
  company_id,
  mechanic_can_record_parts
)
select
  location.id,
  location.company_id,
  true
from locations location
on conflict (location_id) do nothing;
