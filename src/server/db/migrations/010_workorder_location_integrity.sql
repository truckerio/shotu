-- Every operational workorder belongs to a service location. Historical rows
-- can be repaired automatically only when their company has one unambiguous
-- active location; otherwise the migration fails for explicit operator review.

with single_company_locations as (
  select
    company_uuid,
    min(id::text)::uuid as location_id
  from locations
  where active
  group by company_uuid
  having count(*) = 1
)
update operational_workorders workorder
set location_id = candidate.location_id,
    updated_at = now()
from single_company_locations candidate
where workorder.location_id is null
  and candidate.company_uuid = workorder.company_uuid;

do $$
begin
  if exists (select 1 from operational_workorders where location_id is null) then
    raise exception
      'Operational workorders without a location remain. Assign them before applying migration 010.';
  end if;
end;
$$;

alter table operational_workorders
  alter column location_id set not null;
