set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- The existing Workorder chat remains canonical. Historical rows are internal;
-- customer-visible rows are an explicit audience in that same ledger.
alter table chat_messages
  add column if not exists audience varchar(16) not null default 'internal',
  add column if not exists customer_document_id uuid,
  add column if not exists customer_document_revision_id uuid,
  add column if not exists customer_document_access_grant_id uuid,
  add column if not exists customer_sender_name varchar(300),
  add column if not exists customer_request_hash char(64);

alter table chat_messages
  add constraint chat_messages_audience_check
  check (audience in ('internal','customer'));
alter table chat_messages
  add constraint chat_messages_customer_audience_shape check (
    (audience = 'internal'
      and customer_document_id is null and customer_document_revision_id is null
      and customer_document_access_grant_id is null and customer_sender_name is null
      and customer_request_hash is null)
    or (audience = 'customer'
      and customer_document_id is not null and customer_document_revision_id is not null
      and ((sender_role = 'customer' and sender_user_id is null
            and customer_document_access_grant_id is not null
            and char_length(btrim(customer_sender_name)) between 1 and 300
            and customer_request_hash ~ '^[0-9a-f]{64}$')
        or (sender_role in ('admin','office','mechanic') and sender_user_id is not null
            and customer_document_access_grant_id is null and customer_sender_name is null
            and customer_request_hash ~ '^[0-9a-f]{64}$')))
  );

create index chat_messages_customer_thread_idx
  on chat_messages(workorder_id,customer_document_id,customer_document_revision_id,created_at,id)
  where audience='customer';

create or replace function validate_customer_audience_chat_message()
returns trigger language plpgsql as $$
declare
  document_workorder_id uuid;
  grant_row customer_document_access_grants%rowtype;
begin
  if new.audience <> 'customer' then return new; end if;
  select workorder_id into document_workorder_id
  from customer_documents
  where id = new.customer_document_id
  for key share;
  if document_workorder_id is null or document_workorder_id <> new.workorder_id
    or not exists (
      select 1 from customer_document_revisions
       where id = new.customer_document_revision_id
         and document_id = new.customer_document_id
    ) then
    raise exception 'Customer discussion requires the document Workorder binding.' using errcode = '23514';
  end if;
  if new.sender_role = 'customer' then
    select * into grant_row
    from customer_document_access_grants
    where id = new.customer_document_access_grant_id
    for key share;
    if not found
      or grant_row.revoked_at is not null
      or grant_row.expires_at <= now()
      or not ('customer_chat' = any(grant_row.allowed_actions))
      or grant_row.document_id <> new.customer_document_id
      or grant_row.revision_id <> new.customer_document_revision_id
      or grant_row.workorder_id <> new.workorder_id then
      raise exception 'Customer discussion grant is unavailable for this Workorder revision.' using errcode = '42501';
    end if;
  end if;
  return new;
end;
$$;

create trigger chat_messages_customer_audience_scope_guard
before insert on chat_messages
for each row execute function validate_customer_audience_chat_message();

create or replace function reject_customer_chat_attachment()
returns trigger language plpgsql as $$
begin
  if exists (select 1 from chat_messages where id=new.message_id and audience='customer') then
    raise exception 'Customer discussion attachments are not enabled.' using errcode = '42501';
  end if;
  return new;
end;
$$;

create trigger chat_message_attachments_customer_audience_guard
before insert on chat_message_attachments
for each row execute function reject_customer_chat_attachment();

comment on column chat_messages.audience is
  'internal is the default/backfill for legacy chat; customer is a separately authorized Workorder-visible audience.';
