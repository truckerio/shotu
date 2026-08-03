set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- An AFTER DELETE trigger cannot reuse refresh_local_part_repair_history because
-- the source row no longer exists. Removing the provider-neutral order cascades
-- to its preserved lines and materialized repair suggestions.
create or replace function delete_local_history_from_workorder_trigger()
returns trigger
language plpgsql
as $$
begin
  delete from service_history_orders
  where company_id = old.company_id
    and source_provider = 'local'
    and external_id = old.id::text;
  return old;
end;
$$;

create trigger operational_workorders_delete_part_repair_history
after delete on operational_workorders
for each row execute function delete_local_history_from_workorder_trigger();
