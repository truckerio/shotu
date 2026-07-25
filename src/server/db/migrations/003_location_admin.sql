-- Consolidate duplicate locations created by the legacy schema seed.
create temporary table location_merge_map on commit drop as
select id as duplicate_id, canonical_id
from (
  select
    id,
    first_value(id) over (
      partition by company_id, lower(btrim(name))
      order by created_at, id
    ) as canonical_id
  from locations
) ranked
where id <> canonical_id;

update app_users target
set location_id = mapping.canonical_id
from location_merge_map mapping
where target.location_id = mapping.duplicate_id;

update assets target
set location_id = mapping.canonical_id
from location_merge_map mapping
where target.location_id = mapping.duplicate_id;

update inventory_items target
set location_id = mapping.canonical_id
from location_merge_map mapping
where target.location_id = mapping.duplicate_id;

update operational_workorders target
set location_id = mapping.canonical_id
from location_merge_map mapping
where target.location_id = mapping.duplicate_id;

update part_allocations target
set location_id = mapping.canonical_id
from location_merge_map mapping
where target.location_id = mapping.duplicate_id;

insert into user_location_memberships (user_id, location_id, active, created_at, updated_at)
select membership.user_id, mapping.canonical_id, membership.active, membership.created_at, now()
from user_location_memberships membership
join location_merge_map mapping on mapping.duplicate_id = membership.location_id
on conflict (user_id, location_id) do update
set active = user_location_memberships.active or excluded.active,
    updated_at = now();

delete from user_location_memberships membership
using location_merge_map mapping
where membership.location_id = mapping.duplicate_id;

delete from locations location
using location_merge_map mapping
where location.id = mapping.duplicate_id;

create unique index if not exists locations_company_name_uidx
  on locations(company_id, lower(btrim(name)));

create table if not exists location_workorder_templates (
  id uuid primary key default gen_random_uuid(),
  location_id uuid not null unique references locations(id) on delete cascade,
  header_title text not null,
  brand_top text not null default 'PRO TEC',
  brand_bottom text not null default 'REPAIR',
  warranty_text text not null default 'NO WARRANTY ON PARTS SUPPLIED BY CUSTOMER',
  responsibility_text text not null default 'Not responsible for loss or damage to vehicle in case of fire, theft or any other cause beyond our control.',
  authorization_text text not null default 'I authorize the above repair to be completed along with necessary material(s).',
  active boolean not null default true,
  version integer not null default 1,
  updated_by_user_id uuid references app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

insert into location_workorder_templates (location_id, header_title)
select id, upper(name) || ' WORKORDER'
from locations
on conflict (location_id) do nothing;

create table if not exists user_invitations (
  id uuid primary key default gen_random_uuid(),
  company_id text not null,
  location_id uuid not null references locations(id) on delete cascade,
  email text not null,
  name text not null,
  role text not null check (role in ('mechanic', 'office', 'surveillance')),
  token_hash text not null unique,
  status text not null default 'pending' check (status in ('pending', 'accepted', 'expired', 'revoked')),
  invited_by_user_id uuid references app_users(id) on delete set null,
  expires_at timestamptz not null,
  accepted_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists user_invitations_location_status_idx
  on user_invitations(location_id, status, created_at desc);

create unique index if not exists user_invitations_pending_email_uidx
  on user_invitations(location_id, lower(email))
  where status = 'pending';
