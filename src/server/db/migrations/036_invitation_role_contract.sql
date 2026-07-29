-- Invitation roles must match the authenticated company membership roles.
-- Add the corrected constraint without blocking writes during its table scan.

alter table user_invitations
  drop constraint if exists user_invitations_role_check;

alter table user_invitations
  add constraint user_invitations_role_check
  check (role in ('mechanic', 'office', 'surveillance', 'admin'))
  not valid;

alter table user_invitations
  validate constraint user_invitations_role_check;
