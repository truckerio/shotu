set local lock_timeout = '5s';
set local statement_timeout = '60s';

alter table invoice_source_access_events
  drop constraint invoice_source_access_events_action_check;

alter table invoice_source_access_events
  add constraint invoice_source_access_events_action_check
  check (action in ('view', 'training_export', 'retention_delete', 'reextract'));
