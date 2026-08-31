set local lock_timeout = '5s';
set local statement_timeout = '60s';

-- Establish durable identities on every historical manual actual-part row. The
-- original JSON remains the compatibility projection; evidence and amendments
-- below are the immutable audit owners.
update operational_workorders workorder
set form_data = jsonb_set(
  workorder.form_data,
  '{parts}',
  (
    select jsonb_agg(
      case
        when nullif(btrim(part.value->>'partNo'), '') is null
          and nullif(btrim(part.value->>'qty'), '') is null
          and nullif(btrim(part.value->>'repairOrder'), '') is null then part.value
        else jsonb_set(
          jsonb_set(
            part.value,
            '{evidenceId}',
            to_jsonb(
              case
                when coalesce(part.value->>'evidenceId', '') ~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
                  then part.value->>'evidenceId'
                else gen_random_uuid()::text
              end
            ),
            true
          ),
          '{uomCode}',
          to_jsonb(coalesce(nullif(btrim(part.value->>'uomCode'), ''), 'pc')),
          true
        )
      end
      order by part.ordinality
    )
    from jsonb_array_elements(workorder.form_data->'parts') with ordinality as part(value, ordinality)
  ),
  true
)
where jsonb_typeof(workorder.form_data->'parts') = 'array'
  and exists (
    select 1
    from jsonb_array_elements(workorder.form_data->'parts') as part(value)
    where (
        nullif(btrim(part.value->>'partNo'), '') is not null
        or nullif(btrim(part.value->>'qty'), '') is not null
        or nullif(btrim(part.value->>'repairOrder'), '') is not null
      )
      and (
        coalesce(part.value->>'evidenceId', '') !~* '^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$'
        or nullif(btrim(part.value->>'uomCode'), '') is null
      )
  );

create table workorder_manual_part_evidence (
  evidence_id uuid primary key,
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  source_ordinal integer not null check (source_ordinal >= 0),
  original_part jsonb not null check (jsonb_typeof(original_part) = 'object'),
  original_hash text not null check (original_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint workorder_manual_part_evidence_workorder_fk
    foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id) on delete restrict,
  unique (company_id, evidence_id),
  unique (company_id, workorder_id, source_ordinal)
);

insert into workorder_manual_part_evidence (
  evidence_id, company_id, workorder_id, source_ordinal, original_part, original_hash
)
select
  (part.value->>'evidenceId')::uuid,
  workorder.company_id,
  workorder.id,
  (part.ordinality - 1)::integer,
  part.value,
  encode(digest(part.value::text, 'sha256'), 'hex')
from operational_workorders workorder
cross join lateral jsonb_array_elements(
  case when jsonb_typeof(workorder.form_data->'parts') = 'array'
    then workorder.form_data->'parts' else '[]'::jsonb end
) with ordinality as part(value, ordinality)
where jsonb_typeof(workorder.form_data->'parts') = 'array'
  and (
    nullif(btrim(part.value->>'partNo'), '') is not null
    or nullif(btrim(part.value->>'qty'), '') is not null
    or nullif(btrim(part.value->>'repairOrder'), '') is not null
  )
on conflict (evidence_id) do nothing;

create index workorder_manual_part_evidence_workorder_idx
  on workorder_manual_part_evidence (company_id, workorder_id, source_ordinal);

create table workorder_manual_part_amendments (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null references companies(id) on delete cascade,
  workorder_id uuid not null,
  evidence_id uuid not null,
  supersedes_amendment_id uuid,
  action text not null check (action in ('corrected', 'voided')),
  replacement_part jsonb,
  reason text not null check (char_length(btrim(reason)) between 2 and 1000),
  original_hash text not null check (original_hash ~ '^[0-9a-f]{64}$'),
  actor_id uuid not null references user_profiles(id) on delete restrict,
  idempotency_key text not null check (char_length(idempotency_key) between 8 and 160),
  request_hash text not null check (request_hash ~ '^[0-9a-f]{64}$'),
  created_at timestamptz not null default now(),
  constraint workorder_manual_part_amendment_evidence_fk
    foreign key (company_id, evidence_id)
    references workorder_manual_part_evidence(company_id, evidence_id) on delete restrict,
  constraint workorder_manual_part_amendment_workorder_fk
    foreign key (company_id, workorder_id)
    references operational_workorders(company_id, id) on delete restrict,
  unique (company_id, evidence_id, id),
  constraint workorder_manual_part_amendment_supersedes_fk
    foreign key (company_id, evidence_id, supersedes_amendment_id)
    references workorder_manual_part_amendments(company_id, evidence_id, id) on delete restrict,
  constraint workorder_manual_part_amendment_shape_ck check (
    (action = 'corrected' and replacement_part is not null and jsonb_typeof(replacement_part) = 'object')
    or (action = 'voided' and replacement_part is null)
  ),
  unique (supersedes_amendment_id),
  unique (company_id, actor_id, idempotency_key)
);

create index workorder_manual_part_amendment_evidence_idx
  on workorder_manual_part_amendments (company_id, workorder_id, evidence_id, created_at, id);

comment on table workorder_manual_part_evidence is
  'Immutable original evidence for pre-cutover freeform actual-part rows. It never creates inventory identity, reservations, or movements.';

comment on table workorder_manual_part_amendments is
  'Append-only Office/Admin correction or void evidence. Current meaning is derived through superseding links; original JSON evidence remains immutable.';
