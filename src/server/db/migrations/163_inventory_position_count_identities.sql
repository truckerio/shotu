set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_position_count_sessions
  add column if not exists applied_by uuid references user_profiles(id) on delete restrict,
  add column if not exists apply_reason varchar(500);

alter table inventory_position_count_lines
  add column if not exists observed_by uuid references user_profiles(id) on delete restrict;

alter table inventory_position_count_commands
  drop constraint if exists inventory_position_count_commands_action_check;
alter table inventory_position_count_commands
  add constraint inventory_position_count_commands_action_check
  check(action in ('observe','observe_identity','apply'));

create table if not exists inventory_position_count_unit_snapshots (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  session_id uuid not null,
  unit_id uuid not null,
  catalog_part_id uuid not null,
  uom_code text not null references units_of_measure(code),
  serial_number_snapshot varchar(100) not null,
  status_snapshot varchar(24) not null,
  custody_version_snapshot integer not null check(custody_version_snapshot > 0),
  unit_updated_at_snapshot timestamptz not null,
  observed_by uuid references user_profiles(id) on delete restrict,
  observed_at timestamptz,
  input_mode varchar(16) check(input_mode is null or input_mode in ('scanner','manual')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_position_count_unit_session_fk foreign key(company_id,session_id)
    references inventory_position_count_sessions(company_id,id) on delete restrict,
  constraint inventory_position_count_unit_identity_fk foreign key(company_id,unit_id)
    references inventory_serialized_units(company_id,id) on delete restrict,
  constraint inventory_position_count_unit_part_fk foreign key(company_id,catalog_part_id)
    references parts_catalog(company_id,id) on delete restrict,
  unique(company_id,session_id,unit_id),
  unique(company_id,session_id,serial_number_snapshot),
  unique(company_id,id)
);

create index if not exists inventory_position_count_unit_session_idx
  on inventory_position_count_unit_snapshots(company_id,session_id,catalog_part_id,serial_number_snapshot);

comment on table inventory_position_count_unit_snapshots is
  'Immutable exact-unit and custody snapshot plus physical identity observations for one exact-position count.';
