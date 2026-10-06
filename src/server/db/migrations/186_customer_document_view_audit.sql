create or replace function validate_customer_document_event_insert()
returns trigger language plpgsql as $$
declare grant_row customer_document_access_grants%rowtype;
declare document_kind varchar(16);
declare latest_revision_id uuid;
begin
  if new.event_type in ('viewed','accepted','declined','changes_requested') then
    select * into grant_row
    from customer_document_access_grants
    where company_id = new.company_id and id = new.access_grant_id
    for update;
    if not found
      or grant_row.document_id <> new.document_id
      or grant_row.revision_id <> new.revision_id
      or grant_row.revoked_at is not null
      or grant_row.expires_at <= now()
      or (new.event_type = 'viewed' and not ('view_revision' = any(grant_row.allowed_actions)))
      or (new.event_type <> 'viewed' and not ('respond_revision' = any(grant_row.allowed_actions))) then
      raise exception 'Customer document grant cannot perform this action on this revision.' using errcode = '42501';
    end if;
  end if;
  if new.event_type in ('accepted','declined','changes_requested') then
    select document_type into document_kind
    from customer_documents
    where company_id = new.company_id and id = new.document_id
    for update;
    if document_kind <> 'estimate' then
      raise exception 'Only Estimate revisions accept customer responses.' using errcode = '23514';
    end if;
    select id into latest_revision_id
    from customer_document_revisions
    where company_id = new.company_id and document_id = new.document_id
    order by revision_number desc limit 1;
    if latest_revision_id <> new.revision_id
      or exists (
        select 1 from customer_document_events existing
        where existing.company_id = new.company_id
          and existing.revision_id = new.revision_id
          and existing.event_type in ('voided','superseded')
      ) then
      raise exception 'Customer document revision is no longer response eligible.' using errcode = '40001';
    end if;
  end if;
  return new;
end;
$$;
