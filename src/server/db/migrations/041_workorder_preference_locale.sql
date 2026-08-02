alter table user_workorder_preferences
  add column if not exists locale text not null default 'en';

alter table user_workorder_preferences
  drop constraint if exists user_workorder_preferences_locale_check;

alter table user_workorder_preferences
  add constraint user_workorder_preferences_locale_check
  check (locale in ('en', 'pa', 'es'));
