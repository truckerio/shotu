set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inspection_print_archives add column pdf_bytes bytea;
alter table inspection_print_archives drop constraint inspection_print_ready_shape;
alter table inspection_print_archives add constraint inspection_print_ready_shape check (
  (status in ('pending','failed') and pdf_sha256 is null and pdf_byte_size is null and storage_key is null and pdf_bytes is null and generated_at is null)
  or (status='ready' and pdf_sha256 is not null and pdf_byte_size is not null and storage_key is not null and generated_at is not null and (
    (storage_key='db:inline-pdf' and pdf_bytes is not null and octet_length(pdf_bytes)=pdf_byte_size and pdf_byte_size between 5 and 10485760)
    or (storage_key<>'db:inline-pdf' and pdf_bytes is null)
  ))
);

comment on column inspection_print_archives.pdf_bytes is
  'Immutable generated PDF bytes for new inspection archives. Legacy inline:snapshot rows remain snapshot-backed and are materialized without rewriting archive evidence.';
