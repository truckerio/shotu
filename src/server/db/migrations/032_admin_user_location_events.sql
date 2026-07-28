alter table admin_user_events
  drop constraint if exists admin_user_events_action_check;

alter table admin_user_events
  add constraint admin_user_events_action_check
  check (action in (
    'activated',
    'deactivated',
    'password_reset',
    'deleted',
    'locations_updated'
  ));
