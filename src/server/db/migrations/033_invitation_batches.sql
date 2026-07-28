alter table user_invitations
  add column if not exists batch_id uuid;

create index if not exists user_invitations_batch_status_idx
  on user_invitations(batch_id, status)
  where batch_id is not null;
