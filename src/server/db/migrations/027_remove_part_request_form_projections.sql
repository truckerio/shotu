-- Part request approval is workflow/audit data, not proof that a part was used
-- on the workorder. Older code projected approved mechanic requests into
-- operational_workorders.form_data.parts, which made them printable and locked
-- in the parts editor through requestId. Keep the request records and remove
-- only those non-office-added request projections from the editable workorder
-- form. Explicit office-added rows stay because the office intentionally added
-- them to the workorder.
with cleaned as (
  select
    wo.id,
    coalesce(
      jsonb_agg(part.item order by part.ordinality) filter (
        where not (
          part.item ? 'requestId'
          and (part.item ->> 'requestId') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
          and exists (
            select 1
            from workorder_part_requests request
            where request.id = (part.item ->> 'requestId')::uuid
              and request.workorder_id = wo.id
              and not exists (
                select 1
                from part_request_events event
                where event.part_request_id = request.id
                  and event.event_type = 'office_added'
              )
          )
        )
      ),
      '[]'::jsonb
    ) as parts
  from operational_workorders wo
  cross join lateral jsonb_array_elements(
    case
      when jsonb_typeof(wo.form_data -> 'parts') = 'array' then wo.form_data -> 'parts'
      else '[]'::jsonb
    end
  ) with ordinality as part(item, ordinality)
  where jsonb_typeof(wo.form_data -> 'parts') = 'array'
  group by wo.id
)
update operational_workorders wo
set form_data = jsonb_set(wo.form_data, '{parts}', cleaned.parts, true),
    updated_at = now()
from cleaned
where cleaned.id = wo.id
  and cleaned.parts is distinct from wo.form_data -> 'parts';
