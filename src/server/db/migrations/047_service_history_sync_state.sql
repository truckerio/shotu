set local lock_timeout = '5s';
set local statement_timeout = '30s';

-- Advance provider watermarks only after a successful history import. Track
-- full reconciliation separately so ordinary incremental parts syncs do not
-- reread the complete provider history every time.
create table service_history_sync_state (
  company_id uuid not null references companies(id) on delete cascade,
  source_provider text not null,
  provider_watermark timestamptz,
  last_reconciled_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (company_id, source_provider)
);

comment on table service_history_sync_state is
  'Successful provider history watermark and periodic full-reconciliation state.';
