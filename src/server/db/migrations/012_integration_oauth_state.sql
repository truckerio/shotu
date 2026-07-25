-- OAuth callbacks are public by necessity. A state token must identify exactly
-- one pending company connection.

create unique index if not exists integration_accounts_oauth_state_uidx
  on integration_accounts(oauth_state)
  where oauth_state is not null;
