set local lock_timeout = '5s';
set local statement_timeout = '60s';
alter table inventory_stock_tasks add column identity_observation jsonb;
