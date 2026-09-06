create table if not exists inventory_stocking_policies (
  company_id uuid not null,
  location_id uuid not null,
  catalog_part_id uuid not null,
  minimum_available numeric(18,3) not null check (minimum_available >= 0),
  target_quantity numeric(18,3),
  alert_enabled boolean not null default true,
  version bigint not null default 1 check (version > 0),
  created_by uuid references user_profiles(id) on delete set null,
  updated_by uuid references user_profiles(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (company_id, location_id, catalog_part_id),
  foreign key (company_id, location_id) references locations(company_id, id) on delete cascade,
  foreign key (company_id, catalog_part_id) references parts_catalog(company_id, id) on delete cascade,
  check (target_quantity is null or target_quantity >= minimum_available)
);

create table if not exists inventory_replenishment_alerts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  location_id uuid not null,
  catalog_part_id uuid not null,
  policy_version bigint not null,
  minimum_snapshot numeric(18,3) not null,
  target_snapshot numeric(18,3),
  opening_available numeric(18,3) not null,
  current_available numeric(18,3) not null,
  opened_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  resolved_at timestamptz,
  foreign key (company_id, location_id, catalog_part_id)
    references inventory_stocking_policies(company_id, location_id, catalog_part_id) on delete restrict
);

create unique index if not exists inventory_replenishment_one_open_idx
  on inventory_replenishment_alerts(company_id, location_id, catalog_part_id)
  where resolved_at is null;

create index if not exists inventory_replenishment_open_queue_idx
  on inventory_replenishment_alerts(company_id, location_id, opened_at desc)
  where resolved_at is null;

create or replace function evaluate_inventory_replenishment_alert()
returns trigger language plpgsql as $$
declare
  policy inventory_stocking_policies%rowtype;
  available numeric(18,3);
begin
  if new.source_provider <> 'local' or new.location_id is null or new.catalog_part_id is null then return new; end if;
  select * into policy from inventory_stocking_policies
   where company_id=new.company_id and location_id=new.location_id and catalog_part_id=new.catalog_part_id;
  if not found or not policy.alert_enabled then
    update inventory_replenishment_alerts set resolved_at=now(), updated_at=now()
     where company_id=new.company_id and location_id=new.location_id and catalog_part_id=new.catalog_part_id and resolved_at is null;
    return new;
  end if;
  available := greatest(new.quantity_on_hand-new.quantity_reserved, 0);
  if available <= policy.minimum_available then
    insert into inventory_replenishment_alerts(company_id,location_id,catalog_part_id,policy_version,minimum_snapshot,target_snapshot,opening_available,current_available)
    values(new.company_id,new.location_id,new.catalog_part_id,policy.version,policy.minimum_available,policy.target_quantity,available,available)
    on conflict (company_id,location_id,catalog_part_id) where resolved_at is null
    do update set current_available=excluded.current_available, updated_at=now();
  else
    update inventory_replenishment_alerts set current_available=available,resolved_at=now(),updated_at=now()
     where company_id=new.company_id and location_id=new.location_id and catalog_part_id=new.catalog_part_id and resolved_at is null;
  end if;
  return new;
end $$;

drop trigger if exists inventory_items_replenishment_trigger on inventory_items;
create trigger inventory_items_replenishment_trigger
after insert or update of quantity_on_hand, quantity_reserved on inventory_items
for each row execute function evaluate_inventory_replenishment_alert();
