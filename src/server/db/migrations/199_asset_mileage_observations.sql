set local lock_timeout = '5s';
set local statement_timeout = '60s';

create table asset_mileage_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  asset_id uuid not null,
  source text not null check (source in ('samsara_obd','samsara_gps','manual')),
  miles numeric(12,1) not null check (miles >= 0 and miles <= 10000000),
  observed_at timestamptz not null,
  prior_miles numeric(12,1),
  actor_id uuid references user_profiles(id) on delete restrict,
  reason text not null default '' check (char_length(reason) <= 1000),
  inspection_id uuid,
  workorder_id uuid,
  provider_payload jsonb not null default '{}',
  recorded_at timestamptz not null default now(),
  constraint asset_mileage_observation_asset_fk foreign key(company_id,asset_id) references assets(company_id,id) on delete restrict,
  constraint asset_mileage_observation_inspection_fk foreign key(company_id,inspection_id) references inspections(company_id,id) on delete restrict,
  constraint asset_mileage_observation_workorder_fk foreign key(company_id,workorder_id) references operational_workorders(company_id,id) on delete restrict,
  constraint asset_mileage_observation_manual_shape check ((source='manual' and actor_id is not null and btrim(reason)<>'') or (source<>'manual' and actor_id is null)),
  unique(company_id,asset_id,id)
);
create unique index asset_mileage_provider_observation_uidx on asset_mileage_observations(company_id,asset_id,source,observed_at,miles) where source<>'manual';
create index asset_mileage_observation_timeline_idx on asset_mileage_observations(company_id,asset_id,observed_at desc,recorded_at desc,id desc);

create table asset_mileage_state (
  company_id uuid not null,
  asset_id uuid not null,
  version bigint not null default 0 check(version >= 0),
  canonical_observation_id uuid,
  provider_observation_id uuid,
  conflict boolean not null default false,
  updated_at timestamptz not null default now(),
  primary key(company_id,asset_id),
  constraint asset_mileage_state_asset_fk foreign key(company_id,asset_id) references assets(company_id,id) on delete restrict,
  constraint asset_mileage_state_canonical_fk foreign key(company_id,asset_id,canonical_observation_id) references asset_mileage_observations(company_id,asset_id,id) on delete restrict,
  constraint asset_mileage_state_provider_fk foreign key(company_id,asset_id,provider_observation_id) references asset_mileage_observations(company_id,asset_id,id) on delete restrict
);

create table asset_mileage_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  asset_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check(char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check(request_sha256 ~ '^[0-9a-f]{64}$'),
  observation_id uuid not null,
  created_at timestamptz not null default now(),
  constraint asset_mileage_command_asset_fk foreign key(company_id,asset_id) references assets(company_id,id) on delete restrict,
  constraint asset_mileage_command_observation_fk foreign key(company_id,asset_id,observation_id) references asset_mileage_observations(company_id,asset_id,id) on delete restrict,
  unique(company_id,actor_id,idempotency_key)
);

create function protect_asset_mileage_evidence() returns trigger language plpgsql as $$ begin
  raise exception 'Asset mileage evidence is immutable.' using errcode='55000';
end; $$;
create trigger asset_mileage_observations_append_only before update or delete on asset_mileage_observations for each row execute function protect_asset_mileage_evidence();
create trigger asset_mileage_commands_append_only before update or delete on asset_mileage_commands for each row execute function protect_asset_mileage_evidence();

comment on table asset_mileage_observations is 'Append-only mileage evidence with source-specific observation time; inspection start evidence remains independent and immutable.';
