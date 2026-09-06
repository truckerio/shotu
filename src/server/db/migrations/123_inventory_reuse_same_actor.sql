set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Small shops may have one authorized employee remove, receive, inspect, and
-- release a part. Preserve each step and actor in the existing audit history;
-- capability, evidence, exact-unit, version, and lifecycle guards still apply.
do $$
declare
  constraint_name text;
begin
  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'inventory_reuse_cases'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%received_by_user_id%removed_by_user_id%'
  loop
    execute format('alter table inventory_reuse_cases drop constraint %I', constraint_name);
  end loop;

  for constraint_name in
    select conname
    from pg_constraint
    where conrelid = 'inventory_reuse_cases'::regclass
      and contype = 'c'
      and pg_get_constraintdef(oid) like '%released_by_user_id%removed_by_user_id%'
  loop
    execute format('alter table inventory_reuse_cases drop constraint %I', constraint_name);
  end loop;
end $$;

comment on column inventory_reuse_cases.received_by_user_id is
  'Authorized actor who physically received the exact part; may equal removed_by_user_id.';
comment on column inventory_reuse_cases.released_by_user_id is
  'Authorized actor who released the exact part; may equal removed_by_user_id.';
