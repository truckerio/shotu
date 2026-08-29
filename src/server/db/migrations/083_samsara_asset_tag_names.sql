-- Preserve Samsara tags as a small, query-safe asset projection. The raw payload
-- remains private server-side integration data and is never returned by vehicle lookup.
alter table assets
  add column if not exists tag_names jsonb not null default '[]'::jsonb;

do $$
begin
  if not exists (
    select 1
    from pg_constraint
    where conname = 'assets_tag_names_array_check'
      and conrelid = 'assets'::regclass
  ) then
    alter table assets
      add constraint assets_tag_names_array_check
      check (jsonb_typeof(tag_names) = 'array') not valid;
  end if;
end $$;

-- Existing rows stay empty until their next normal Samsara sync. Avoid a full
-- table rewrite while application startup holds the migration transaction.
