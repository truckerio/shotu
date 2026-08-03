set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Provider-neutral service-order history. Raw order/line identity and line order
-- are retained so provider-specific grouping can be improved without re-importing.
create table service_history_orders (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  source_provider text not null,
  external_id text not null,
  reference text not null default '',
  status text not null default '',
  asset_id uuid references assets(id) on delete set null,
  asset_external_id text not null default '',
  ordered_at timestamptz,
  completed_at timestamptz,
  source_updated_at timestamptz,
  raw_metadata jsonb not null default '{}',
  last_seen_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, source_provider, external_id),
  unique (company_id, id)
);

create table service_history_lines (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_order_id uuid not null,
  external_id text not null,
  sequence numeric(14, 4) not null default 0,
  line_index integer not null default 0,
  line_kind text not null default 'other'
    check (line_kind in ('service', 'goods', 'section', 'note', 'other')),
  product_external_id text not null default '',
  catalog_part_id uuid,
  part_number text not null default '',
  normalized_part_number text not null default '',
  product_name text not null default '',
  description text not null default '',
  quantity numeric(14, 4),
  uom text not null default '',
  source_updated_at timestamptz,
  raw_payload jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint service_history_lines_order_company_fkey
    foreign key (company_id, service_order_id)
    references service_history_orders(company_id, id)
    on delete cascade,
  constraint service_history_lines_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete set null (catalog_part_id),
  unique (company_id, service_order_id, external_id)
);

-- Materialized part-to-repair candidates. This avoids scanning legacy JSON or
-- rebuilding Odoo same-order context on every dropdown request.
create table part_repair_history (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  service_order_id uuid not null,
  source_provider text not null,
  occurrence_key text not null,
  catalog_part_id uuid,
  normalized_part_number text not null default '',
  repair_text text not null,
  confidence text not null check (confidence in ('confirmed', 'context')),
  asset_id uuid references assets(id) on delete set null,
  used_at timestamptz,
  evidence jsonb not null default '{}',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint part_repair_history_order_company_fkey
    foreign key (company_id, service_order_id)
    references service_history_orders(company_id, id)
    on delete cascade,
  constraint part_repair_history_catalog_company_fkey
    foreign key (company_id, catalog_part_id)
    references parts_catalog(company_id, id)
    on delete set null (catalog_part_id),
  unique (company_id, source_provider, occurrence_key)
);

create index service_history_orders_company_provider_updated_idx
  on service_history_orders(company_id, source_provider, source_updated_at desc nulls last);

create index service_history_lines_order_sequence_idx
  on service_history_lines(company_id, service_order_id, sequence, line_index, id);

create index service_history_lines_catalog_orders_idx
  on service_history_lines(company_id, catalog_part_id, service_order_id)
  where catalog_part_id is not null;

create index service_history_lines_part_orders_idx
  on service_history_lines(company_id, normalized_part_number, service_order_id)
  where normalized_part_number <> '';

create index part_repair_history_catalog_rank_idx
  on part_repair_history(company_id, catalog_part_id, confidence, used_at desc)
  include (repair_text, source_provider, service_order_id, asset_id)
  where catalog_part_id is not null;

create index part_repair_history_number_rank_idx
  on part_repair_history(company_id, normalized_part_number, confidence, used_at desc)
  include (repair_text, source_provider, service_order_id, asset_id)
  where normalized_part_number <> '';

-- One-time local backfill. A used-part row has an explicit repair description,
-- so it is confirmed history. Cancelled and unfinished workorders do not teach.
insert into service_history_orders (
  company_id, source_provider, external_id, reference, status, asset_id,
  ordered_at, completed_at, source_updated_at, raw_metadata
)
select
  wo.company_id, 'local', wo.id::text, wo.serial, wo.status, wo.asset_id,
  wo.created_at, coalesce(wo.closed_at, wo.mechanic_done_at, wo.updated_at),
  wo.updated_at, jsonb_build_object('workorderId', wo.id)
from operational_workorders wo
where wo.status in ('mechanic_done', 'closed', 'odoo_entered')
on conflict (company_id, source_provider, external_id) do nothing;

insert into part_repair_history (
  company_id, service_order_id, source_provider, occurrence_key,
  catalog_part_id, normalized_part_number, repair_text, confidence,
  asset_id, used_at, evidence
)
select
  wo.company_id, history_order.id, 'local', 'request:' || request.id::text,
  request.catalog_part_id, request.normalized_part_number, btrim(request.repair_order),
  'confirmed', wo.asset_id,
  coalesce(wo.closed_at, wo.mechanic_done_at, wo.updated_at),
  jsonb_build_object('workorderId', wo.id, 'partRequestId', request.id)
from operational_workorders wo
join service_history_orders history_order
  on history_order.company_id = wo.company_id
 and history_order.source_provider = 'local'
 and history_order.external_id = wo.id::text
join workorder_part_requests request on request.workorder_id = wo.id
where wo.status in ('mechanic_done', 'closed', 'odoo_entered')
  and request.approval_status = 'approved'
  and btrim(request.repair_order) <> ''
  and (request.catalog_part_id is not null or request.normalized_part_number <> '')
on conflict (company_id, source_provider, occurrence_key) do nothing;

insert into part_repair_history (
  company_id, service_order_id, source_provider, occurrence_key,
  catalog_part_id, normalized_part_number, repair_text, confidence,
  asset_id, used_at, evidence
)
select
  wo.company_id, history_order.id, 'local',
  'used-part:' || wo.id::text || ':' || (part.ordinality - 1)::text,
  catalog.id, normalized.value, btrim(part.value ->> 'repairOrder'), 'confirmed',
  wo.asset_id, coalesce(wo.closed_at, wo.mechanic_done_at, wo.updated_at),
  jsonb_build_object('workorderId', wo.id, 'legacyPartIndex', part.ordinality - 1)
from operational_workorders wo
join service_history_orders history_order
  on history_order.company_id = wo.company_id
 and history_order.source_provider = 'local'
 and history_order.external_id = wo.id::text
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(wo.form_data -> 'parts') = 'array'
       then wo.form_data -> 'parts' else '[]'::jsonb end
) with ordinality as part(value, ordinality)
cross join lateral (
  select upper(regexp_replace(coalesce(part.value ->> 'partNo', ''), '[^A-Za-z0-9]', '', 'g')) as value
) normalized
left join parts_catalog catalog
  on catalog.company_id = wo.company_id
 and catalog.normalized_part_number = normalized.value
where wo.status in ('mechanic_done', 'closed', 'odoo_entered')
  and normalized.value <> ''
  and btrim(coalesce(part.value ->> 'repairOrder', '')) <> ''
on conflict (company_id, source_provider, occurrence_key) do nothing;

-- Keep local history current without coupling every workorder write path to this
-- feature. Refresh is bounded to one workorder and runs only for terminal work.
create or replace function refresh_local_part_repair_history(target_workorder_id uuid)
returns void
language plpgsql
as $$
declare
  target operational_workorders%rowtype;
  target_history_order_id uuid;
begin
  select * into target from operational_workorders where id = target_workorder_id;
  if not found then return; end if;

  if target.status not in ('mechanic_done', 'closed', 'odoo_entered') then
    delete from service_history_orders
    where company_id = target.company_id
      and source_provider = 'local'
      and external_id = target.id::text;
    return;
  end if;

  insert into service_history_orders (
    company_id, source_provider, external_id, reference, status, asset_id,
    ordered_at, completed_at, source_updated_at, raw_metadata, last_seen_at, updated_at
  ) values (
    target.company_id, 'local', target.id::text, target.serial, target.status,
    target.asset_id, target.created_at,
    coalesce(target.closed_at, target.mechanic_done_at, target.updated_at),
    target.updated_at, jsonb_build_object('workorderId', target.id), now(), now()
  )
  on conflict (company_id, source_provider, external_id) do update
  set reference = excluded.reference,
      status = excluded.status,
      asset_id = excluded.asset_id,
      completed_at = excluded.completed_at,
      source_updated_at = excluded.source_updated_at,
      raw_metadata = excluded.raw_metadata,
      last_seen_at = now(),
      updated_at = now()
  returning id into target_history_order_id;

  delete from part_repair_history
  where company_id = target.company_id
    and service_order_id = target_history_order_id
    and source_provider = 'local';

  insert into part_repair_history (
    company_id, service_order_id, source_provider, occurrence_key,
    catalog_part_id, normalized_part_number, repair_text, confidence,
    asset_id, used_at, evidence
  )
  select
    target.company_id, target_history_order_id, 'local', 'request:' || request.id::text,
    request.catalog_part_id, request.normalized_part_number, btrim(request.repair_order),
    'confirmed', target.asset_id,
    coalesce(target.closed_at, target.mechanic_done_at, target.updated_at),
    jsonb_build_object('workorderId', target.id, 'partRequestId', request.id)
  from workorder_part_requests request
  where request.workorder_id = target.id
    and request.approval_status = 'approved'
    and btrim(request.repair_order) <> ''
    and (request.catalog_part_id is not null or request.normalized_part_number <> '');

  insert into part_repair_history (
    company_id, service_order_id, source_provider, occurrence_key,
    catalog_part_id, normalized_part_number, repair_text, confidence,
    asset_id, used_at, evidence
  )
  select
    target.company_id, target_history_order_id, 'local',
    'used-part:' || target.id::text || ':' || (part.ordinality - 1)::text,
    catalog.id, normalized.value, btrim(part.value ->> 'repairOrder'), 'confirmed',
    target.asset_id, coalesce(target.closed_at, target.mechanic_done_at, target.updated_at),
    jsonb_build_object('workorderId', target.id, 'legacyPartIndex', part.ordinality - 1)
  from jsonb_array_elements(
    case when jsonb_typeof(target.form_data -> 'parts') = 'array'
         then target.form_data -> 'parts' else '[]'::jsonb end
  ) with ordinality as part(value, ordinality)
  cross join lateral (
    select upper(regexp_replace(coalesce(part.value ->> 'partNo', ''), '[^A-Za-z0-9]', '', 'g')) as value
  ) normalized
  left join parts_catalog catalog
    on catalog.company_id = target.company_id
   and catalog.normalized_part_number = normalized.value
  where normalized.value <> ''
    and btrim(coalesce(part.value ->> 'repairOrder', '')) <> '';
end;
$$;

create or replace function refresh_local_history_from_workorder_trigger()
returns trigger
language plpgsql
as $$
begin
  perform refresh_local_part_repair_history(new.id);
  return new;
end;
$$;

create trigger operational_workorders_refresh_part_repair_history
after insert or update of status, asset_id, form_data, mechanic_done_at, closed_at
on operational_workorders
for each row execute function refresh_local_history_from_workorder_trigger();

create or replace function refresh_local_history_from_part_request_trigger()
returns trigger
language plpgsql
as $$
begin
  perform refresh_local_part_repair_history(coalesce(new.workorder_id, old.workorder_id));
  return coalesce(new, old);
end;
$$;

create trigger workorder_part_requests_refresh_part_repair_history
after insert or update of catalog_part_id, normalized_part_number, repair_order, approval_status or delete
on workorder_part_requests
for each row execute function refresh_local_history_from_part_request_trigger();

comment on table service_history_orders is
  'Provider-neutral immutable service-order identity and lifecycle metadata for repair history.';
comment on table service_history_lines is
  'Ordered source lines preserved without assuming a labor-to-part adjacency relationship.';
comment on table part_repair_history is
  'Materialized, tenant-scoped repair suggestions; context means co-occurrence, not a confirmed relationship.';
