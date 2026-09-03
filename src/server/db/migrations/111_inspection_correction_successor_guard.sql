set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$ begin
  if exists(
    select 1
    from inspections
    where lineage_kind = 'correction'
    group by company_id, predecessor_inspection_id
    having count(*) > 1
  ) then
    raise exception 'Migration 111 blocked: more than one correction exists for an inspection predecessor.';
  end if;
end $$;

create unique index inspections_one_correction_successor_uidx
  on inspections(company_id, predecessor_inspection_id)
  where lineage_kind = 'correction';
