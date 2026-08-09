alter table chat_message_attachments
  add column if not exists content bytea;

alter table chat_message_attachments
  drop constraint if exists chat_message_attachments_content_size_check;

alter table chat_message_attachments
  add constraint chat_message_attachments_content_size_check
  check (content is null or octet_length(content) = byte_size);

comment on column chat_message_attachments.content is
  'Private attachment bytes stored transactionally with chat metadata. Null only for legacy filesystem-backed rows.';
