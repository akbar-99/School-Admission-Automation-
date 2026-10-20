-- ============================================================================
-- Every payment this app knows about comes through Razorpay (markPaymentCompleted,
-- only ever called after server-side signature verification or a verified
-- webhook) — there was no way to record an admission fee a parent paid
-- through a completely separate channel (confirmed live: a direct bank
-- NEFT transfer straight to the school's account, with no Razorpay order
-- ever created on our side for it).
--
-- Inserts a payments row representing the out-of-band payment (no
-- razorpay_order_id/payment_id, since none exists — those columns are
-- nullable) and moves the application to PAYMENT_COMPLETED. The caller
-- (recordManualPayment, admin/actions.ts) then calls handlePaymentCompleted
-- — the exact same function a real Razorpay payment triggers — so
-- enrollment, the admission number, notifications and Broadway/Sheets sync
-- all happen identically to a normal online payment; only how the payment
-- itself got recorded differs.
--
-- AGREEMENT_SENT can't jump straight to PAYMENT_COMPLETED under
-- enforce_status_transition (0061) — it only allows -> PAYMENT_PENDING —
-- so this needs the same app.bypass_status_check escape hatch every other
-- legitimate out-of-order transition in this app already uses.
-- ============================================================================
create or replace function admin_record_manual_payment(
  p_application uuid,
  p_amount_paise integer,
  p_reference text
)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_app     applications;
  v_payment payments;
begin
  select * into v_app from applications where id = p_application for update;
  if v_app.id is null then
    return jsonb_build_object('status', 'NOT_FOUND');
  end if;
  if v_app.section_id is not null then
    return jsonb_build_object('status', 'ALREADY_SECTIONED');
  end if;
  if v_app.status not in ('AGREEMENT_SENT', 'PAYMENT_PENDING', 'PAYMENT_FAILED', 'ABANDONED') then
    return jsonb_build_object('status', 'INVALID_STATUS', 'current_status', v_app.status);
  end if;
  if p_amount_paise <= 0 then
    return jsonb_build_object('status', 'INVALID_AMOUNT');
  end if;

  insert into payments (
    application_id, amount, currency, status, receipt, notes,
    includes_admission, includes_study_material, admission_amount, study_material_amount
  ) values (
    p_application, p_amount_paise, 'INR', 'completed', p_reference,
    jsonb_build_object('manual', true, 'reference', p_reference),
    true, false, p_amount_paise, 0
  )
  returning * into v_payment;

  perform set_config('app.bypass_status_check', 'on', true);
  update applications set status = 'PAYMENT_COMPLETED' where id = p_application;

  return jsonb_build_object('status', 'OK', 'payment_id', v_payment.id);
end $$;
