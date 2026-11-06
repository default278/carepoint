BEGIN;

DO $preflight$
BEGIN
  IF to_regclass('public.billing_payments') IS NULL
     OR to_regclass('public.billing') IS NULL
     OR to_regclass('public.patients') IS NULL
     OR to_regclass('public.carepoint_notifications') IS NULL THEN
    RAISE EXCEPTION 'Carepoint payment idempotency requires the workflow migration and its billing, patient, and notification relations.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Carepoint payment idempotency requires Supabase auth.uid().';
  END IF;
  IF to_regprocedure('public.carepoint_has_role(text)') IS NULL THEN
    RAISE EXCEPTION 'Carepoint payment idempotency requires the workflow authorization helper.';
  END IF;
  IF to_regprocedure('public.carepoint_record_payment(text,numeric,text,text)') IS NULL THEN
    RAISE EXCEPTION 'Carepoint payment idempotency requires the four-argument payment function from the workflow migration.';
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_payments'
      AND column_name = 'payment_id'
  ) OR NOT EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_payments'
      AND column_name = 'bill_id'
  ) THEN
    RAISE EXCEPTION 'Carepoint payment idempotency precondition failed: expected billing_payments key columns are missing.';
  END IF;
  IF EXISTS (
    SELECT 1
    FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'billing_payments'
      AND column_name = 'idempotency_key'
      AND udt_name <> 'uuid'
  ) THEN
    RAISE EXCEPTION 'Carepoint payment idempotency precondition failed: billing_payments.idempotency_key exists with a non-UUID type.';
  END IF;
END
$preflight$;

ALTER TABLE public.billing_payments
  ADD COLUMN IF NOT EXISTS idempotency_key uuid NOT NULL DEFAULT gen_random_uuid();

CREATE UNIQUE INDEX IF NOT EXISTS billing_payments_idempotency_key_unique
  ON public.billing_payments (idempotency_key);

CREATE OR REPLACE FUNCTION public.carepoint_record_payment(
  target_bill text,
  payment_amount numeric,
  method_text text,
  reference_text text,
  request_key uuid
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  bill_key public.billing.bill_id%TYPE;
  bill_total numeric;
  amount_paid numeric;
  payment_key public.billing_payments.payment_id%TYPE;
  existing_payment public.billing_payments%ROWTYPE;
  patient_profile public.profiles.id%TYPE;
  normalized_method text := btrim(method_text);
  normalized_reference text := NULLIF(btrim(reference_text), '');
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('receptionist')) THEN
    RAISE EXCEPTION 'This account cannot record a bill payment.';
  END IF;
  IF request_key IS NULL THEN
    RAISE EXCEPTION 'A payment request key is required.';
  END IF;
  IF payment_amount IS NULL OR payment_amount <= 0
     OR method_text IS NULL OR normalized_method = '' THEN
    RAISE EXCEPTION 'A positive amount and payment method are required.';
  END IF;

  PERFORM pg_advisory_xact_lock(hashtextextended(request_key::text, 0));

  SELECT b.bill_id, b.total_amount INTO bill_key, bill_total
  FROM public.billing b
  WHERE b.bill_id::text = target_bill
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill was not found.';
  END IF;

  SELECT p.* INTO existing_payment
  FROM public.billing_payments p
  WHERE p.idempotency_key = request_key
  FOR UPDATE;
  IF FOUND THEN
    IF existing_payment.bill_id::text <> bill_key::text
       OR existing_payment.amount <> payment_amount
       OR existing_payment.payment_method <> normalized_method
       OR existing_payment.reference IS DISTINCT FROM normalized_reference THEN
      RAISE EXCEPTION 'This payment request key was already used with different payment details.';
    END IF;
    RETURN existing_payment.payment_id::text;
  END IF;

  IF bill_total IS NULL OR bill_total < 0 THEN
    RAISE EXCEPTION 'Bill total is missing or invalid; reconcile it before recording a payment.';
  END IF;

  SELECT COALESCE(sum(p.amount), 0) INTO amount_paid
  FROM public.billing_payments p
  WHERE p.bill_id::text = bill_key::text;
  IF payment_amount > bill_total - amount_paid THEN
    RAISE EXCEPTION 'Payment exceeds the bill balance.';
  END IF;

  INSERT INTO public.billing_payments(
    bill_id, amount, payment_method, reference, received_by, idempotency_key
  )
  VALUES (
    bill_key, payment_amount, normalized_method, normalized_reference, auth.uid(), request_key
  )
  RETURNING payment_id INTO payment_key;

  SELECT p.profile_id INTO patient_profile
  FROM public.billing b
  JOIN public.patients p ON p.patient_id = b.patient_id
  WHERE b.bill_id = bill_key;
  IF patient_profile IS NOT NULL THEN
    INSERT INTO public.carepoint_notifications(
      recipient_profile_id, patient_id, event_type, message
    )
    SELECT patient_profile, b.patient_id, 'payment_recorded',
      'A payment has been recorded for one of your bills.'
    FROM public.billing b
    WHERE b.bill_id = bill_key;
  END IF;

  RETURN payment_key::text;
END;
$$;

REVOKE ALL ON FUNCTION public.carepoint_record_payment(text, numeric, text, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.carepoint_record_payment(text, numeric, text, text, uuid)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.carepoint_record_payment(text, numeric, text, text, uuid)
  TO authenticated;

COMMIT;
