-- Seed company parts memory from previously approved workorder decisions.
-- Future approvals update this table directly in the application transaction.
with approved_parts as (
  select distinct on (wo.company_id, pr.normalized_part_number)
    wo.company_id,
    pr.normalized_part_number,
    pr.part_number,
    pr.manufacturer,
    pr.description,
    pr.category,
    pr.repair_order,
    case
      when nullif(trim(pr.raw_query), '') is not null
        and lower(trim(pr.raw_query)) <> lower(trim(pr.part_number))
        and lower(trim(pr.raw_query)) <> lower(trim(pr.description))
      then jsonb_build_array(trim(pr.raw_query))
      else '[]'::jsonb
    end as aliases
  from workorder_part_requests pr
  join operational_workorders wo on wo.id = pr.workorder_id
  where pr.approval_status = 'approved'
    and pr.normalized_part_number <> ''
  order by wo.company_id, pr.normalized_part_number, pr.approved_at desc nulls last, pr.updated_at desc
)
insert into parts_catalog (
  company_id,
  normalized_part_number,
  part_number,
  manufacturer,
  description,
  category,
  repair_template,
  aliases
)
select
  company_id,
  normalized_part_number,
  part_number,
  manufacturer,
  description,
  category,
  repair_order,
  aliases
from approved_parts
on conflict (company_id, normalized_part_number) do nothing;
