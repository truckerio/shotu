-- Cache the provider-specific Odoo action used to open service orders.
-- Numeric action IDs differ between Odoo databases, so they are discovered
-- from the connected database instead of being hardcoded in application code.

alter table odoo_service_order_settings
  add column if not exists service_action_external_id text not null default '';

alter table odoo_service_order_settings
  add column if not exists service_action_base_url text not null default '',
  add column if not exists service_action_database text not null default '';

alter table odoo_service_order_settings
  drop constraint if exists odoo_service_order_settings_action_id_check;

alter table odoo_service_order_settings
  add constraint odoo_service_order_settings_action_id_check check (
    (service_action_external_id = '' and service_action_base_url = '' and service_action_database = '')
    or (
      service_action_external_id ~ '^[1-9][0-9]*$'
      and btrim(service_action_base_url) <> ''
      and btrim(service_action_database) <> ''
      and length(service_action_base_url) <= 2000
      and length(service_action_database) <= 200
    )
  );

comment on column odoo_service_order_settings.service_action_external_id is
  'Discovered ir.actions.act_window ID whose domain opens sale.order service orders in the custom service form.';

comment on column odoo_service_order_settings.service_action_base_url is
  'Odoo base URL against which the cached service-order action was discovered.';

comment on column odoo_service_order_settings.service_action_database is
  'Odoo database against which the cached service-order action was discovered.';
