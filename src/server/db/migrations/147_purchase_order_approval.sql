set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_purchase_approval_settings (
  company_id uuid primary key references companies(id),
  approval_limit numeric(14,2) not null check (approval_limit >= 0),
  currency char(3) not null default 'USD' check (currency ~ '^[A-Z]{3}$'),
  approver_user_ids uuid[] not null default '{}',
  approver_roles text[] not null default '{}' check (approver_roles <@ array['office','admin']::text[]),
  version integer not null default 1,
  updated_by uuid not null references user_profiles(id),
  updated_at timestamptz not null default now()
);
create table inventory_purchase_approval_settings_events (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id),
  actor_id uuid not null references user_profiles(id),
  details jsonb not null,
  created_at timestamptz not null default now()
);
alter table inventory_purchase_orders add column expected_delivery_date date;
alter table inventory_purchase_orders drop constraint inventory_purchase_orders_status_check;
update inventory_purchase_orders set status = case status
  when 'pending_approval' then 'awaiting_approval'
  when 'approved' then 'ordered'
  when 'partially_received' then 'ordered'
  else status end
where status in ('pending_approval','approved','partially_received');
alter table inventory_purchase_orders add constraint inventory_purchase_orders_status_check
  check (status in ('draft','awaiting_approval','ordered','received','cancelled'));
