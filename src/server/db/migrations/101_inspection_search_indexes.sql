set local lock_timeout = '5s';
set local statement_timeout = '60s';

create extension if not exists pg_trgm;

create index inspections_number_trgm_idx
  on inspections using gin (inspection_number gin_trgm_ops);

create index inspections_unit_number_trgm_idx
  on inspections using gin ((asset_snapshot->>'unitNo') gin_trgm_ops);

create index inspections_vin_trgm_idx
  on inspections using gin ((asset_snapshot->>'vin') gin_trgm_ops);

create index inspections_plate_trgm_idx
  on inspections using gin ((asset_snapshot->>'licensePlate') gin_trgm_ops);
