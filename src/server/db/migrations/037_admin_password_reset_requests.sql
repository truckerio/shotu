alter table admin_user_events
  drop constraint if exists admin_user_events_action_check;

alter table admin_user_events
  add constraint admin_user_events_action_check
  check (action in (
    'activated',
    'deactivated',
    'password_reset',
    'password_reset_requested',
    'deleted',
    'locations_updated'
  ));

comment on column admin_user_events.action is
  'Append-only administrator action. password_reset_requested records email delivery requests and does not prove a completed reset.';
