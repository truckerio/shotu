set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_purchase_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  location_id uuid not null,
  catalog_part_id uuid,
  category text not null check(category in ('suggestion','part_request')),
  part_number text not null default '',
  description text not null check(length(trim(description)) between 1 and 500),
  quantity numeric(14,3) not null check(quantity > 0),
  uom_code text not null references units_of_measure(code),
  status text not null default 'approval_waiting' check(status in ('approval_waiting','approved','added')),
  supplier text not null default '',
  notes text not null default '',
  version integer not null default 1,
  created_by uuid not null references user_profiles(id),
  approved_by uuid references user_profiles(id),
  approved_at timestamptz,
  added_by uuid references user_profiles(id),
  added_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  foreign key(company_id,location_id) references locations(company_id,id),
  foreign key(company_id,catalog_part_id) references parts_catalog(company_id,id),
  unique(company_id,id),
  check ((status='approval_waiting' and approved_by is null and approved_at is null and added_by is null and added_at is null)
    or (status='approved' and approved_by is not null and approved_at is not null and added_by is null and added_at is null)
    or (status='added' and approved_by is not null and approved_at is not null and added_by is not null and added_at is not null))
);
create index inventory_purchase_request_queue on inventory_purchase_requests(company_id,location_id,status,created_at desc);
create unique index inventory_purchase_request_active_suggestion on inventory_purchase_requests(company_id,location_id,catalog_part_id)
  where category='suggestion' and status in ('approval_waiting','approved');

create table inventory_purchase_request_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  request_id uuid not null,
  actor_id uuid not null references user_profiles(id),
  action text not null check(action in ('request_create','request_approve','request_update','request_add')),
  details jsonb not null,
  created_at timestamptz not null default now(),
  foreign key(company_id,request_id) references inventory_purchase_requests(company_id,id)
);
