-- Workorder serials are business identifiers inside a company, not global IDs.
-- The UUID primary key remains the cross-tenant technical identity.

alter table operational_workorders
  drop constraint if exists operational_workorders_serial_key;

create unique index if not exists operational_workorders_company_uuid_serial_uidx
  on operational_workorders(company_uuid, serial);
