-- An unclaimed Instagram enquiry can already have been answered by staff
-- directly in the Instagram app, or need no follow-up at all (e.g. admission
-- is closed). "Dismissed" takes it out of the unclaimed pool without deleting
-- it; a new message from the parent brings it back.
alter table applications
  add column if not exists dismissed_at timestamptz,
  add column if not exists dismissed_by uuid references users(id);

-- Replies staff type in the Instagram app arrive as webhook "echoes"; the
-- same message can also arrive via a reply sent from this app, so message ids
-- must be unique to keep either path from double-recording it.
create unique index if not exists uq_instagram_messages_provider_id
  on instagram_messages(provider_message_id);
