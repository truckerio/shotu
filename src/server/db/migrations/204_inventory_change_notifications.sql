set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- PostgreSQL delivers NOTIFY only when the writing transaction commits and
-- coalesces identical channel/payload pairs within one transaction. The UUID
-- is routing metadata for trusted servers; SSE never exposes it to clients.
create or replace function notify_inventory_stock_change()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    perform pg_notify('inventory_stock_changed', old.company_id::text);
    return old;
  end if;
  if tg_op = 'UPDATE' and old.company_id is distinct from new.company_id then
    perform pg_notify('inventory_stock_changed', old.company_id::text);
  end if;
  perform pg_notify('inventory_stock_changed', new.company_id::text);
  return new;
end $$;

-- These are the mutable sources used by listLocalInventoryStock and its
-- availability, price, identity, physical position, and attention projections.
do $$
declare table_name text;
begin
  foreach table_name in array array[
    'parts_catalog',
    'part_reference_numbers',
    'inventory_items',
    'odoo_inventory_balances',
    'odoo_product_mappings',
    'inventory_part_price_versions',
    'inventory_part_selling_policy_versions',
    'inventory_stocking_policies',
    'inventory_replenishment_alerts',
    'inventory_serialized_units',
    'inventory_receipt_lines',
    'inventory_positions',
    'inventory_position_balances',
    'inventory_aggregate_cost_layer_positions',
    'locations'
  ] loop
    execute format('drop trigger if exists inventory_stock_change_notification on %I', table_name);
    execute format(
      'create trigger inventory_stock_change_notification after insert or update or delete on %I for each row execute function notify_inventory_stock_change()',
      table_name
    );
  end loop;
end $$;
