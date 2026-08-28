set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_count_imports
  add column source_content_type varchar(120),
  add column source_size_bytes integer,
  add column source_file_bytes bytea;

alter table inventory_count_imports
  add constraint inventory_count_imports_source_file_check check (
    (source_file_bytes is null and source_content_type is null and source_size_bytes is null)
    or (
      source_file_bytes is not null
      and source_content_type = 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      and source_size_bytes between 1 and 2000000
      and octet_length(source_file_bytes) = source_size_bytes
    )
  );

comment on column inventory_count_imports.source_file_bytes is
  'Original authenticated XLSX upload retained as immutable database evidence.';
