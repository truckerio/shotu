set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_count_import_lines
  add column reviewed_bin_location varchar(120);

update inventory_count_import_lines
set reviewed_bin_location = source_bin_location;

alter table inventory_count_import_lines
  alter column reviewed_bin_location set not null;

comment on column inventory_count_import_lines.source_bin_location is
  'Immutable bin or shelf value parsed from source workbook.';
comment on column inventory_count_import_lines.reviewed_bin_location is
  'Operator-reviewed bin or shelf used when applying opening count.';
