-- A refund is initiated by admin/COO (Razorpay refunds are staff-triggered,
-- not something the webhook ever reports) — recorded here so the marketing
-- rep who owns the lead can be notified, since they'd otherwise have no way
-- to find out.
alter type payment_state add value if not exists 'refunded';

alter table payments
  add column if not exists refunded_at timestamptz,
  add column if not exists refund_reason text,
  add column if not exists refunded_by uuid references users(id);
