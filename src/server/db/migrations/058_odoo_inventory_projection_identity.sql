set local lock_timeout = '5s';
set local statement_timeout = '60s';

comment on column inventory_items.external_id is
  'Provider projection identity. Odoo inventory is aggregated by catalog part, mapped app location, and unit so multiple provider stock locations and duplicate product SKUs cannot create competing rows.';
