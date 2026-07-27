-- Repair the final operational-profile contract for databases that missed the
-- unique auth identity index during the app_users -> user_profiles rename.

create unique index if not exists user_profiles_auth_user_id_uidx
  on user_profiles(auth_user_id)
  where auth_user_id is not null;
