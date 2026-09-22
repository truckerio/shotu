set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function protect_posted_purchase_invoice_allocation() returns trigger language plpgsql as $$
begin
  if tg_op='UPDATE' and old.status='posted' then
    raise exception 'Posted purchase invoice allocations are append-only.' using errcode='55000';
  end if;
  if tg_op='DELETE' then return old; end if;
  return new;
end $$;

comment on function protect_posted_purchase_invoice_allocation() is
  'Blocks in-place mutation of posted allocation evidence. Deletes remain available to controlled tenant/test teardown; no application route exposes them.';
