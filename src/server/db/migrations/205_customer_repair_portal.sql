set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- A repair link is an explicit Workorder capability, independent of historical
-- revision-only grants. No legacy link acquires access to other revisions.
create table if not exists customer_repair_access_grants (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 location_id uuid not null,
 workorder_id uuid not null,
 token_hash char(64) not null unique check(token_hash ~ '^[0-9a-f]{64}$'),
 token_hint varchar(8) not null,
 issued_by_user_id uuid not null references user_profiles(id),
 issued_at timestamptz not null default now(),
 expires_at timestamptz not null check(expires_at > issued_at),
 revoked_at timestamptz,
 revoked_by_user_id uuid references user_profiles(id),
 last_used_at timestamptz,
 idempotency_key varchar(120) not null,
 request_hash char(64) not null,
 foreign key(company_id,location_id,workorder_id) references operational_workorders(company_id,location_id,id),
 unique(company_id,id),
 unique(company_id,issued_by_user_id,idempotency_key)
);
create table if not exists customer_repair_revision_grants (
 repair_grant_id uuid not null references customer_repair_access_grants(id),
 revision_grant_id uuid not null references customer_document_access_grants(id),
 primary key(repair_grant_id,revision_grant_id)
);
create table if not exists customer_repair_email_deliveries (
 id uuid primary key default gen_random_uuid(),
 company_id uuid not null,
 grant_id uuid not null,
 requested_by_user_id uuid not null references user_profiles(id),
 recipient_email varchar(320) not null,
 status varchar(32) not null check(status in ('requested','provider_accepted','failed','not_configured')),
 idempotency_key varchar(120) not null,
 request_hash char(64) not null,
 requested_at timestamptz not null default now(),
 resolved_at timestamptz,
 foreign key(company_id,grant_id) references customer_repair_access_grants(company_id,id),
 unique(company_id,requested_by_user_id,idempotency_key)
);
create table if not exists customer_repair_email_events (
 id uuid primary key default gen_random_uuid(),
 delivery_id uuid not null references customer_repair_email_deliveries(id),
 status varchar(32) not null,
 created_at timestamptz not null default now(),
 unique(delivery_id,status)
);
comment on table customer_repair_access_grants is 'Explicit expiring Workorder-scoped customer access. Raw secrets are never persisted; revocation invalidates all derived revision capabilities.';

create or replace function guard_customer_repair_grant() returns trigger language plpgsql as $$
begin
 if tg_op='DELETE' then raise exception 'Repair capability history cannot be deleted.' using errcode='55000'; end if;
 if (to_jsonb(new)-array['revoked_at','revoked_by_user_id','last_used_at']) is distinct from (to_jsonb(old)-array['revoked_at','revoked_by_user_id','last_used_at']) then
  raise exception 'Repair capability scope is immutable.' using errcode='55000';
 end if;
 if old.revoked_at is not null and row(new.revoked_at,new.revoked_by_user_id) is distinct from row(old.revoked_at,old.revoked_by_user_id) then
  raise exception 'Repair capability revocation is permanent.' using errcode='55000';
 end if;
 return new;
end; $$;
drop trigger if exists customer_repair_grant_guard on customer_repair_access_grants;
create trigger customer_repair_grant_guard before update or delete on customer_repair_access_grants for each row execute function guard_customer_repair_grant();
