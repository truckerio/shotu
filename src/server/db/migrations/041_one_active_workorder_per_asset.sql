-- One physical asset cannot be scheduled into concurrent active workorders.
-- Completed, Odoo-entered, and cancelled workorders remain as asset history.

create unique index operational_workorders_one_active_per_asset_uidx
  on operational_workorders(asset_id)
  where asset_id is not null
    and status not in ('closed', 'odoo_entered', 'cancelled');
