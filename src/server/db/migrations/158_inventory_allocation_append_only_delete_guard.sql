set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function protect_posted_purchase_invoice_allocation() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.status='posted' then
    raise exception 'Posted purchase invoice allocations are append-only.' using errcode='55000';
  end if;
  if tg_op='DELETE' then
    if current_setting('app.allow_inventory_evidence_teardown', true)='on' then
      return old;
    end if;
    raise exception 'Purchase invoice allocation evidence cannot be deleted.' using errcode='55000';
  end if;
  return new;
end $$;

comment on function protect_posted_purchase_invoice_allocation() is
  'Blocks mutation and deletion of allocation evidence. Test teardown must opt in for the current transaction.';
