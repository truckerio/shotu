set local lock_timeout = '5s';
set local statement_timeout = '60s';

do $$
declare
  duplicate_groups text;
begin
  select string_agg(format('%s/%s/%s (%s active)',company_id,asset_id,inspection_kind,active_count),', ')
  into duplicate_groups
  from (
    select company_id,asset_id,inspection_kind,count(*) as active_count
    from inspections
    where status in ('requested','assigned','in_progress')
    group by company_id, asset_id, inspection_kind
    having count(*) > 1
    order by company_id,asset_id,inspection_kind
    limit 20
  ) duplicates;

  if duplicate_groups is not null then
    raise exception 'Migration 105 blocked: duplicate active weekly inspections require explicit reconciliation: %', duplicate_groups
      using errcode = '23514';
  end if;
end $$;

create unique index inspections_one_active_weekly_uidx
  on inspections(company_id,asset_id,inspection_kind)
  where status in ('requested','assigned','in_progress');

create table inspection_create_commands (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete restrict,
  inspection_id uuid not null,
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key varchar(120) not null check (char_length(idempotency_key) between 8 and 120),
  request_sha256 char(64) not null check (request_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint inspection_create_command_inspection_fk
    foreign key (company_id,inspection_id) references inspections(company_id,id) on delete restrict,
  unique (company_id, actor_id, idempotency_key)
);

create index inspection_create_commands_inspection_idx
  on inspection_create_commands(company_id,inspection_id);

create function protect_inspection_create_command()
returns trigger language plpgsql as $$ begin
  raise exception 'Inspection create commands are immutable.' using errcode = '55000';
end; $$;

create trigger inspection_create_commands_append_only
  before update or delete on inspection_create_commands
  for each row execute function protect_inspection_create_command();
