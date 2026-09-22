set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table inventory_serialized_units
  drop constraint inventory_serialized_units_status_check;

alter table inventory_serialized_units
  add constraint inventory_serialized_units_status_check check (
    status in (
      'pending', 'in_stock', 'held', 'issued', 'reserved', 'installed_pending_approval',
      'installed', 'removed', 'returned', 'scrapped', 'void'
    )
  );

comment on column inventory_serialized_units.status is
  'held identifies a received exact unit that is physically present but unavailable pending discrepancy resolution.';
