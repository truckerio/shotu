set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_serialized_units
  drop constraint inventory_serialized_units_status_check,
  alter column status type varchar(32);
alter table inventory_serialized_units
  add constraint inventory_serialized_units_status_check check (
    status in (
      'pending', 'in_stock', 'issued', 'reserved', 'installed_pending_approval',
      'installed', 'removed', 'returned', 'scrapped', 'void'
    )
  );

alter table workorder_serialized_part_usages
  drop constraint workorder_serialized_part_usages_status_check,
  drop constraint workorder_serialized_usage_final_state,
  alter column status type varchar(32);
alter table workorder_serialized_part_usages
  add constraint workorder_serialized_part_usages_status_check check (
    status in ('issued', 'reserved', 'installed_pending_approval', 'installed', 'returned', 'removed')
  ),
  add constraint workorder_serialized_usage_final_state check (
    (status in ('issued', 'reserved') and finalized_by_user_id is null and finalized_at is null
      and finalize_idempotency_key is null and finalize_request_hash is null)
    or
    (status in ('installed_pending_approval', 'installed', 'returned', 'removed')
      and finalized_by_user_id is not null and finalized_at is not null
      and finalize_idempotency_key is not null and char_length(finalize_idempotency_key) between 8 and 120
      and finalize_request_hash is not null and finalize_request_hash ~ '^[0-9a-f]{64}$')
  );

drop index workorder_serialized_usage_one_unresolved_unit_idx;
create unique index workorder_serialized_usage_one_active_unit_idx
  on workorder_serialized_part_usages (company_id, unit_id)
  where status in ('issued', 'reserved', 'installed_pending_approval', 'installed', 'removed');

create index workorder_serialized_usage_pending_approval_idx
  on workorder_serialized_part_usages (company_id, workorder_id, status, id)
  where status in ('reserved', 'installed_pending_approval');

create index inventory_unit_events_workorder_timeline_idx
  on inventory_unit_events (workorder_id, created_at desc, id desc)
  where workorder_id is not null;

create table workorder_serialized_part_usage_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  usage_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action varchar(32) not null check (action in ('install', 'return', 'remove')),
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_hash char(64) not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint workorder_serialized_usage_commands_usage_fk
    foreign key (company_id, usage_id)
    references workorder_serialized_part_usages(company_id, id) on delete restrict,
  unique (company_id, actor_id, idempotency_key),
  unique (company_id, usage_id, action)
);

alter table inventory_unit_events drop constraint inventory_unit_events_event_type_check;
alter table inventory_unit_events
  add constraint inventory_unit_events_event_type_check check (
    event_type in (
      'receipt_staged', 'receipt_confirmed', 'receipt_recorded',
      'reconciliation_required', 'issued', 'reserved',
      'installed_pending_approval', 'installed', 'returned',
      'removed_returned_to_stock', 'removed', 'void'
    )
  );

alter table inventory_unit_events drop constraint inventory_unit_events_workorder_shape;
alter table inventory_unit_events
  add constraint inventory_unit_events_workorder_shape check (
    (event_type in ('issued', 'reserved', 'installed_pending_approval', 'installed', 'returned', 'removed_returned_to_stock', 'removed')
      and usage_id is not null and workorder_id is not null and asset_id is not null)
    or
    (event_type not in ('issued', 'reserved', 'installed_pending_approval', 'installed', 'returned', 'removed_returned_to_stock', 'removed')
      and usage_id is null and workorder_id is null and asset_id is null)
  );

comment on table workorder_serialized_part_usage_commands is
  'Idempotent append-only commands for reservation installation, confirmed return, and removal.';
