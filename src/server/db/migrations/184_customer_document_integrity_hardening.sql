set local lock_timeout = '5s';
set local statement_timeout = '60s';

create or replace function guard_customer_document_number_series()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'Customer document number series cannot be deleted.' using errcode = '55000';
  end if;
  if new.company_id is distinct from old.company_id
    or new.document_type is distinct from old.document_type
    or new.prefix is distinct from old.prefix
    or new.digits is distinct from old.digits
    or new.created_at is distinct from old.created_at then
    raise exception 'Customer document number series identity is immutable.' using errcode = '55000';
  end if;
  if new.next_number <= old.next_number then
    raise exception 'Customer document numbers cannot reset or be reused.' using errcode = '55000';
  end if;
  return new;
end;
$$;

create trigger customer_document_number_series_guard
before update or delete on customer_document_number_series
for each row execute function guard_customer_document_number_series();

create unique index customer_documents_estimate_draft_uidx
  on customer_documents(company_id, draft_id)
  where document_type='estimate' and draft_id is not null;
create unique index customer_documents_type_workorder_uidx
  on customer_documents(company_id, workorder_id, document_type)
  where workorder_id is not null;
