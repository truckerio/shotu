set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table inventory_direct_receipt_approval_requests (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  location_id uuid not null,
  catalog_part_id uuid not null,
  target_position_id uuid,
  submitted_by uuid not null references user_profiles(id) on delete restrict,
  idempotency_key uuid not null,
  request_hash char(64) not null check(request_hash ~ '^[0-9a-f]{64}$'),
  original_command jsonb not null check(jsonb_typeof(original_command)='object'),
  receiver_evidence jsonb not null check(jsonb_typeof(receiver_evidence)='object'),
  status text not null default 'pending' check(status in('pending','approved','rejected','cancelled')),
  receipt_id uuid,
  decision_by uuid references user_profiles(id) on delete restrict,
  decision_reason varchar(500),
  decided_at timestamptz,
  version integer not null default 1 check(version > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint inventory_direct_receipt_approval_location_fk foreign key(company_id,location_id) references locations(company_id,id) on delete restrict,
  constraint inventory_direct_receipt_approval_part_fk foreign key(company_id,catalog_part_id) references parts_catalog(company_id,id) on delete restrict,
  constraint inventory_direct_receipt_approval_position_fk foreign key(company_id,target_position_id) references inventory_positions(company_id,id) on delete restrict,
  constraint inventory_direct_receipt_approval_receipt_fk foreign key(company_id,receipt_id) references local_inventory_receipts(company_id,id) on delete restrict,
  constraint inventory_direct_receipt_approval_decision_state check(
    (status='pending' and receipt_id is null and decision_by is null and decision_reason is null and decided_at is null)
    or (status='approved' and receipt_id is not null and decision_by is not null and decided_at is not null)
    or (status in('rejected','cancelled') and receipt_id is null and decision_by is not null and char_length(btrim(decision_reason)) between 1 and 500 and decided_at is not null)
  ),
  unique(company_id,submitted_by,idempotency_key),
  unique(company_id,id)
);

create index inventory_direct_receipt_approval_pending_idx
  on inventory_direct_receipt_approval_requests(company_id,location_id,created_at,id) where status='pending';

create table inventory_direct_receipt_approval_events (
  id bigint generated always as identity primary key,
  company_id uuid not null references companies(id) on delete cascade,
  request_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  action text not null check(action in('submit','approve','reject','cancel')),
  details jsonb not null default '{}'::jsonb check(jsonb_typeof(details)='object'),
  created_at timestamptz not null default now(),
  constraint inventory_direct_receipt_approval_event_request_fk foreign key(company_id,request_id)
    references inventory_direct_receipt_approval_requests(company_id,id) on delete restrict
);

create or replace function prevent_direct_receipt_approval_original_mutation()
returns trigger language plpgsql as $$
begin
  if row(new.company_id,new.location_id,new.catalog_part_id,new.target_position_id,new.submitted_by,new.idempotency_key,new.request_hash,new.original_command,new.receiver_evidence)
     is distinct from
     row(old.company_id,old.location_id,old.catalog_part_id,old.target_position_id,old.submitted_by,old.idempotency_key,old.request_hash,old.original_command,old.receiver_evidence) then
    raise exception 'Direct receipt approval original command is immutable';
  end if;
  return new;
end;
$$;
create trigger inventory_direct_receipt_approval_immutable
before update on inventory_direct_receipt_approval_requests
for each row execute function prevent_direct_receipt_approval_original_mutation();

comment on table inventory_direct_receipt_approval_requests is
  'Immutable no-PO direct-arrival command and receiver evidence. Stock is posted only by an approved canonical receipt.';
