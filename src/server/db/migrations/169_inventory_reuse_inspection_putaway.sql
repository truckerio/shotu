set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_reuse_cases
  add column received_at timestamptz,
  add column inspected_at timestamptz,
  add column release_position_id uuid;

alter table inventory_reuse_cases
  add constraint inventory_reuse_cases_release_position_fk
  foreign key(company_id,location_id,release_position_id)
  references inventory_positions(company_id,location_id,id) on delete restrict;

update inventory_reuse_cases
set received_at=coalesce(updated_at,created_at)
where received_by_user_id is not null and received_at is null;

update inventory_reuse_cases
set inspected_at=coalesce(completed_at,updated_at,created_at)
where length(btrim(coalesce(inspection_evidence,'')))>0 and inspected_at is null;

update inventory_reuse_cases reuse
set release_position_id=unit.current_position_id
from inventory_serialized_units unit
where reuse.company_id=unit.company_id and reuse.unit_id=unit.id
  and reuse.status='released' and reuse.release_position_id is null
  and unit.current_position_id is not null;

comment on column inventory_reuse_cases.received_at is
  'Durable physical receipt time. Receipt never implies inspection, disposition, or stock availability.';
comment on column inventory_reuse_cases.inspected_at is
  'Time a documented inspection decision was recorded.';
comment on column inventory_reuse_cases.release_position_id is
  'Explicit active non-system storage position selected when an inspected exact unit returned to available stock.';
