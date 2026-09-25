-- WhatsApp delivery-status webhook support.
--
-- Our own send call only proves Meta's Graph API accepted the request
-- (status='sent') — not that the message reached the device. This adds the
-- columns needed to record Meta's own delivered/read/failed callbacks
-- against the exact message we sent.
alter type notification_status add value if not exists 'delivered';
alter type notification_status add value if not exists 'read';

-- Meta's message id, captured at send time so the webhook can match a status
-- callback back to the exact row it belongs to.
alter table notifications add column if not exists provider_message_id text;
create unique index if not exists idx_notifications_provider_message_id
  on notifications(provider_message_id) where provider_message_id is not null;
