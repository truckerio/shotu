-- Operational identity is separate from Better Auth credentials and sessions.

alter table app_users rename to user_profiles;
alter table user_profiles rename column name to display_name;
alter table user_profiles rename column email to contact_email;

drop index if exists app_users_role_active_idx;
alter table user_profiles drop column role;
alter table user_profiles drop column location_id;

alter table user_profiles rename constraint app_users_pkey to user_profiles_pkey;
alter table user_profiles rename constraint app_users_auth_user_id_fkey to user_profiles_auth_user_id_fkey;
alter index if exists app_users_auth_user_id_idx rename to user_profiles_auth_user_id_idx;
alter table user_profiles drop constraint if exists app_users_email_key;
create index user_profiles_display_name_idx
  on user_profiles(display_name)
  where active and deleted_at is null;

comment on table user_profiles is
  'Operational person profile. Better Auth owns login email, username, credentials, and sessions.';
comment on column user_profiles.display_name is
  'Name shown in workorder operations and audit history.';
comment on column user_profiles.contact_email is
  'Optional operational contact address. auth_user.email remains login identity.';
comment on table user_company_memberships is
  'Canonical company role assignments. Roles never live on user_profiles.';
comment on table user_location_memberships is
  'Canonical location access assignments. Locations never live on user_profiles.';
