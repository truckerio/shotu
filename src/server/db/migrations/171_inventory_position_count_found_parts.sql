set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_position_count_lines
  add column if not exists line_source varchar(24) not null default 'snapshot';

alter table inventory_position_count_lines
  drop constraint if exists inventory_position_count_lines_source_check;
alter table inventory_position_count_lines
  add constraint inventory_position_count_lines_source_check
  check(line_source in ('snapshot','found'));

alter table inventory_position_count_commands
  drop constraint if exists inventory_position_count_commands_action_check;
alter table inventory_position_count_commands
  add constraint inventory_position_count_commands_action_check
  check(action in ('observe','observe_identity','add_found','apply'));

comment on column inventory_position_count_lines.line_source is
  'Snapshot lines existed at count start. Found lines are existing master parts physically observed with expected quantity zero.';
