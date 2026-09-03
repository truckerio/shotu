alter table inspections
  add column odometer_miles numeric(10,1),
  add column engine_hours numeric(9,1),
  add column previous_report_reviewed boolean,
  add column start_evidence_recorded_at timestamptz;

alter table inspections
  add constraint inspections_start_evidence_shape_chk check (
    (start_evidence_recorded_at is null
      and odometer_miles is null
      and engine_hours is null
      and previous_report_reviewed is null)
    or
    (start_evidence_recorded_at is not null
      and started_at is not null
      and previous_report_reviewed is not null
      and (
        (unit_type = 'Truck'
          and odometer_miles is not null
          and odometer_miles between 0 and 99999999.9
          and (engine_hours is null or engine_hours between 0 and 9999999.9))
        or
        (unit_type = 'Trailer'
          and odometer_miles is null
          and engine_hours is null)
      ))
  );

create or replace function protect_inspection_start_evidence()
returns trigger language plpgsql as $$
begin
  if old.start_evidence_recorded_at is not null and
    (new.started_at,
     new.odometer_miles,
     new.engine_hours,
     new.previous_report_reviewed,
     new.start_evidence_recorded_at)
    is distinct from
    (old.started_at,
     old.odometer_miles,
     old.engine_hours,
     old.previous_report_reviewed,
     old.start_evidence_recorded_at) then
    raise exception 'Inspection start evidence is immutable.';
  end if;
  return new;
end $$;

create trigger inspections_start_evidence_immutable
before update on inspections
for each row execute function protect_inspection_start_evidence();
