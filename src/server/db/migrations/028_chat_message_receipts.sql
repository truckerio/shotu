-- Per-user chat delivery state. chat_messages.read_by remains legacy-only;
-- application code reads and writes this normalized table instead.
create table if not exists chat_message_receipts (
  message_id uuid not null references chat_messages(id) on delete cascade,
  user_id uuid not null references user_profiles(id),
  delivered_at timestamptz not null default now(),
  read_at timestamptz,
  primary key (message_id, user_id),
  constraint chat_message_receipts_read_after_delivery_check
    check (read_at is null or read_at >= delivered_at)
);

create index if not exists chat_message_receipts_user_delivery_idx
  on chat_message_receipts(user_id, delivered_at desc);

create index if not exists chat_message_receipts_user_unread_idx
  on chat_message_receipts(user_id, message_id)
  where read_at is null;

comment on table chat_message_receipts is
  'Normalized per-user delivery and read acknowledgements for non-system workorder chat messages.';
comment on column chat_message_receipts.message_id is
  'Chat message acknowledged by the receiving user.';
comment on column chat_message_receipts.user_id is
  'Authenticated receiving user; never supplied as an actor identifier by the browser.';
comment on column chat_message_receipts.delivered_at is
  'First time the receiving client acknowledged delivery.';
comment on column chat_message_receipts.read_at is
  'First time the receiving client acknowledged that chat was read; implies delivery.';
