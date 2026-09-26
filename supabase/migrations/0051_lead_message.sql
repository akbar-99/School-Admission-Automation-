-- The actual first message text from an inbound-captured enquiry (DM, etc.)
-- — lets marketing see what the person actually asked before claiming it,
-- not just their name and source.
alter table applications add column if not exists lead_message text;
