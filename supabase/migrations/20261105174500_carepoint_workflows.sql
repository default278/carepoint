-- Additive Carepoint workflow expansion for the live schema.
-- Apply as one transaction after reviewing the project's existing RLS policies.
-- This migration does not drop tables, delete rows, or reset existing data.
-- Preconditions below abort if confirmed relation/key assumptions are not true.

BEGIN;

DO $preflight$
DECLARE
  target record;
  relation_oid oid;
  key_attnum smallint;
  has_duplicates boolean;
  has_default boolean;
  is_not_null boolean;
  column_type text;
  missing_roles text;
BEGIN
  FOR target IN
    SELECT * FROM (VALUES
      ('profiles', 'id'),
      ('roles', 'id'),
      ('patients', 'patient_id'),
      ('doctors', 'doctor_id'),
      ('appointments', 'appointment_id'),
      ('lab_tests', 'test_id'),
      ('medications', 'medication_id'),
      ('prescriptions', 'prescription_id'),
      ('prescription_medications', 'prescription_medication_id'),
      ('billing', 'bill_id')
    ) AS referenced_keys(table_name, column_name)
  LOOP
    relation_oid := to_regclass(format('public.%I', target.table_name));
    IF relation_oid IS NULL THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: public.% is missing.',
        target.table_name;
    END IF;

    SELECT a.attnum INTO key_attnum
    FROM pg_attribute a
    WHERE a.attrelid = relation_oid
      AND a.attname = target.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF key_attnum IS NULL THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: public.%.% is missing.',
        target.table_name, target.column_name;
    END IF;

    IF NOT EXISTS (
      SELECT 1
      FROM pg_index i
      WHERE i.indrelid = relation_oid
        AND i.indisunique
        AND i.indisvalid
        AND i.indpred IS NULL
        AND i.indexprs IS NULL
        AND i.indnkeyatts = 1
        AND i.indkey[0] = key_attnum
    ) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: public.%.% is not a single-column primary/unique key. Confirm the live key before applying.',
        target.table_name, target.column_name;
    END IF;
  END LOOP;

  FOR target IN
    SELECT * FROM (VALUES
      ('roles', 'name'),
      ('user_roles', 'user_id'), ('user_roles', 'role_id'),
      ('patients', 'name'), ('patients', 'address'), ('patients', 'created_at'),
      ('doctors', 'name'), ('doctors', 'specialization'), ('doctors', 'created_at'),
      ('appointments', 'patient_id'), ('appointments', 'doctor_id'),
      ('appointments', 'appointment_date'), ('appointments', 'status'),
      ('appointments', 'reason'), ('appointments', 'created_at'),
      ('medical_records', 'record_id'), ('medical_records', 'patient_id'),
      ('medical_records', 'doctor_id'), ('medical_records', 'diagnosis'),
      ('medical_records', 'notes'), ('medical_records', 'treatment_plan'),
      ('medical_records', 'created_at'),
      ('lab_tests', 'name'), ('lab_tests', 'description'),
      ('medications', 'name'), ('medications', 'description'),
      ('prescriptions', 'created_at'),
      ('prescription_medications', 'prescription_id'),
      ('prescription_medications', 'medication_id'),
      ('prescription_medications', 'dosage'),
      ('prescription_medications', 'instructions'),
      ('billing', 'patient_id'), ('billing', 'total_amount'),
      ('billing', 'status'), ('billing', 'created_at')
    ) AS required_columns(table_name, column_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM information_schema.columns c
      WHERE c.table_schema = 'public'
        AND c.table_name = target.table_name
        AND c.column_name = target.column_name
    ) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: confirmed field public.%.% is missing.',
        target.table_name, target.column_name;
    END IF;
  END LOOP;

  FOR target IN
    SELECT * FROM (VALUES
      ('user_roles', 'user_id', 'profiles', 'id'),
      ('user_roles', 'role_id', 'roles', 'id'),
      ('appointments', 'patient_id', 'patients', 'patient_id'),
      ('appointments', 'doctor_id', 'doctors', 'doctor_id'),
      ('medical_records', 'patient_id', 'patients', 'patient_id'),
      ('medical_records', 'doctor_id', 'doctors', 'doctor_id'),
      ('prescription_medications', 'prescription_id', 'prescriptions', 'prescription_id'),
      ('prescription_medications', 'medication_id', 'medications', 'medication_id'),
      ('billing', 'patient_id', 'patients', 'patient_id')
    ) AS required_links(source_table, source_column, target_table, target_column)
  LOOP
    IF NOT EXISTS (
      SELECT 1
      FROM pg_constraint fk
      JOIN pg_attribute source_column
        ON source_column.attrelid = fk.conrelid
       AND source_column.attname = target.source_column
       AND source_column.attnum > 0
       AND NOT source_column.attisdropped
      JOIN pg_attribute target_column
        ON target_column.attrelid = fk.confrelid
       AND target_column.attname = target.target_column
       AND target_column.attnum > 0
       AND NOT target_column.attisdropped
      WHERE fk.contype = 'f'
        AND fk.conrelid = to_regclass(format('public.%I', target.source_table))
        AND fk.confrelid = to_regclass(format('public.%I', target.target_table))
        AND fk.conkey = ARRAY[source_column.attnum]
        AND fk.confkey = ARRAY[target_column.attnum]
    ) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: required existing relationship public.%.% -> public.%.% is not present.',
        target.source_table, target.source_column,
        target.target_table, target.target_column;
    END IF;
  END LOOP;

  FOR target IN
    SELECT * FROM (VALUES
      ('patients', 'patient_id'),
      ('appointments', 'appointment_id'),
      ('prescriptions', 'prescription_id'),
      ('prescription_medications', 'prescription_medication_id'),
      ('billing', 'bill_id')
    ) AS generated_keys(table_name, column_name)
  LOOP
    SELECT a.atthasdef OR a.attidentity <> ''
    INTO has_default
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(format('public.%I', target.table_name))
      AND a.attname = target.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF NOT COALESCE(has_default, false) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: public.%.% has no verified generated/default key; inspect its insert behavior before applying.',
        target.table_name, target.column_name;
    END IF;
  END LOOP;

  FOR target IN
    SELECT * FROM (VALUES
      ('patients', 'created_at'),
      ('appointments', 'created_at'),
      ('prescriptions', 'created_at'),
      ('billing', 'created_at')
    ) AS required_defaults(table_name, column_name)
  LOOP
    SELECT a.attnotnull, a.atthasdef OR a.attidentity <> ''
    INTO is_not_null, has_default
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(format('public.%I', target.table_name))
      AND a.attname = target.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF is_not_null AND NOT COALESCE(has_default, false) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: inserts into public.%.% require a value but have no default.',
        target.table_name, target.column_name;
    END IF;
  END LOOP;

  SELECT t.typcategory = 'N' INTO has_default
  FROM pg_attribute a
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attrelid = 'public.billing'::regclass
    AND a.attname = 'total_amount'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF NOT COALESCE(has_default, false) THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: public.billing.total_amount is not a numeric SQL type.';
  END IF;

  SELECT t.typname INTO column_type
  FROM pg_attribute a
  JOIN pg_type t ON t.oid = a.atttypid
  WHERE a.attrelid = 'public.appointments'::regclass
    AND a.attname = 'appointment_date'
    AND a.attnum > 0
    AND NOT a.attisdropped;
  IF column_type NOT IN ('timestamp', 'timestamptz') THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: public.appointments.appointment_date must be timestamp/timestamptz for the current date-and-time workflow; inspect and adapt if its actual type differs.';
  END IF;

  FOR target IN
    SELECT * FROM (VALUES
      ('appointments', 'status'),
      ('billing', 'status')
    ) AS nullable_or_default_status(table_name, column_name)
  LOOP
    SELECT a.attnotnull, a.atthasdef OR a.attidentity <> ''
    INTO is_not_null, has_default
    FROM pg_attribute a
    WHERE a.attrelid = to_regclass(format('public.%I', target.table_name))
      AND a.attname = target.column_name
      AND a.attnum > 0
      AND NOT a.attisdropped;
    IF is_not_null AND NOT COALESCE(has_default, false) THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: public.%.% is required but its default/value policy is unverified.',
        target.table_name, target.column_name;
    END IF;
  END LOOP;

  IF to_regclass('public.user_roles') IS NULL
     OR to_regclass('auth.users') IS NULL THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: expected user_roles or auth.users relation is missing.';
  END IF;
  IF to_regprocedure('auth.uid()') IS NULL THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: Supabase auth.uid() function is missing.';
  END IF;
  IF to_regrole('anon') IS NULL OR to_regrole('authenticated') IS NULL THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: Supabase anon/authenticated database roles are missing.';
  END IF;
  SELECT string_agg(required.name, ', ' ORDER BY required.name)
  INTO missing_roles
  FROM unnest(ARRAY[
    'admin', 'receptionist', 'doctor', 'patient', 'lab_technician', 'pharmacist'
  ]) AS required(name)
  WHERE NOT EXISTS (SELECT 1 FROM public.roles r WHERE r.name = required.name);
  IF missing_roles IS NOT NULL THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: missing role rows for %; reconcile role records before applying.',
      missing_roles;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'patients' AND column_name = 'profile_id'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.patients WHERE profile_id IS NOT NULL GROUP BY profile_id HAVING count(*) > 1)'
      INTO has_duplicates;
    IF has_duplicates THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: duplicate patients.profile_id values exist; reconcile mappings before applying.';
    END IF;
  END IF;

  IF EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'doctors' AND column_name = 'profile_id'
  ) THEN
    EXECUTE 'SELECT EXISTS (SELECT 1 FROM public.doctors WHERE profile_id IS NOT NULL GROUP BY profile_id HAVING count(*) > 1)'
      INTO has_duplicates;
    IF has_duplicates THEN
      RAISE EXCEPTION 'Carepoint migration precondition failed: duplicate doctors.profile_id values exist; reconcile mappings before applying.';
    END IF;
  END IF;
END;
$preflight$;

DO $$
DECLARE
  profile_id_type text;
  patient_id_type text;
  doctor_id_type text;
  appointment_id_type text;
  test_id_type text;
  medication_id_type text;
  bill_id_type text;
  prescription_item_id_type text;
BEGIN
  SELECT format_type(a.atttypid, a.atttypmod) INTO profile_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.profiles'::regclass AND a.attname = 'id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO patient_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.patients'::regclass AND a.attname = 'patient_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO doctor_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.doctors'::regclass AND a.attname = 'doctor_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO appointment_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.appointments'::regclass AND a.attname = 'appointment_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO test_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.lab_tests'::regclass AND a.attname = 'test_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO medication_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.medications'::regclass AND a.attname = 'medication_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO bill_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.billing'::regclass AND a.attname = 'bill_id' AND NOT a.attisdropped;
  SELECT format_type(a.atttypid, a.atttypmod) INTO prescription_item_id_type
  FROM pg_attribute a
  WHERE a.attrelid = 'public.prescription_medications'::regclass
    AND a.attname = 'prescription_medication_id' AND NOT a.attisdropped;

  IF profile_id_type IS NULL OR patient_id_type IS NULL OR doctor_id_type IS NULL
     OR appointment_id_type IS NULL OR test_id_type IS NULL
     OR medication_id_type IS NULL OR bill_id_type IS NULL
     OR prescription_item_id_type IS NULL THEN
    RAISE EXCEPTION 'Carepoint migration precondition failed: one or more live key columns were not found.';
  END IF;

  EXECUTE format('ALTER TABLE public.patients ADD COLUMN IF NOT EXISTS profile_id %s', profile_id_type);
  EXECUTE format('ALTER TABLE public.doctors ADD COLUMN IF NOT EXISTS profile_id %s', profile_id_type);
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.patients'::regclass AND conname = 'patients_profile_id_fkey') THEN
    ALTER TABLE public.patients
      ADD CONSTRAINT patients_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.doctors'::regclass AND conname = 'doctors_profile_id_fkey') THEN
    ALTER TABLE public.doctors
      ADD CONSTRAINT doctors_profile_id_fkey FOREIGN KEY (profile_id)
      REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
  END IF;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.doctor_assignments (
      assignment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      doctor_id %s NOT NULL REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
      assigned_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      assigned_at timestamptz NOT NULL DEFAULT now(),
      is_active boolean NOT NULL DEFAULT true
    )',
    patient_id_type, doctor_id_type, profile_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.encounters (
      encounter_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      doctor_id %s REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
      appointment_id %s REFERENCES public.appointments(appointment_id) ON DELETE SET NULL,
      status text NOT NULL DEFAULT ''open'',
      started_at timestamptz NOT NULL DEFAULT now(),
      ended_at timestamptz
    )',
    patient_id_type, doctor_id_type, appointment_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.vital_signs (
      vital_sign_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id uuid NOT NULL REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT,
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      recorded_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      systolic_bp integer,
      diastolic_bp integer,
      heart_rate integer,
      temperature_c numeric(5,2),
      respiratory_rate integer,
      oxygen_saturation numeric(5,2),
      weight_kg numeric(7,2),
      height_cm numeric(7,2),
      notes text,
      recorded_at timestamptz NOT NULL DEFAULT now()
    )',
    patient_id_type, profile_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.consultations (
      consultation_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id uuid NOT NULL REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT,
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      doctor_id %s NOT NULL REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
      chief_complaint text,
      clinical_notes text,
      treatment_plan text,
      created_at timestamptz NOT NULL DEFAULT now()
    )',
    patient_id_type, doctor_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.diagnoses (
      diagnosis_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id uuid NOT NULL REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT,
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      doctor_id %s NOT NULL REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
      code text,
      description text NOT NULL,
      is_primary boolean NOT NULL DEFAULT false,
      created_at timestamptz NOT NULL DEFAULT now()
    )',
    patient_id_type, doctor_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.lab_orders (
      lab_order_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      encounter_id uuid NOT NULL REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT,
      patient_id %s NOT NULL REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      ordered_by %s NOT NULL REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT,
      test_id %s NOT NULL REFERENCES public.lab_tests(test_id) ON DELETE RESTRICT,
      status text NOT NULL DEFAULT ''requested'',
      priority text NOT NULL DEFAULT ''routine'',
      instructions text,
      ordered_at timestamptz NOT NULL DEFAULT now()
    )',
    patient_id_type, doctor_id_type, test_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.lab_results (
      lab_result_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      lab_order_id uuid NOT NULL REFERENCES public.lab_orders(lab_order_id) ON DELETE RESTRICT,
      result_value text,
      units text,
      reference_range text,
      result_notes text,
      status text NOT NULL DEFAULT ''pending_review'',
      performed_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      reviewed_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      performed_at timestamptz,
      published_at timestamptz
    )',
    profile_id_type, profile_id_type
  );

  EXECUTE format(
    'ALTER TABLE public.prescriptions
      ADD COLUMN IF NOT EXISTS encounter_id uuid REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS patient_id %s REFERENCES public.patients(patient_id) ON DELETE RESTRICT,
      ADD COLUMN IF NOT EXISTS doctor_id %s REFERENCES public.doctors(doctor_id) ON DELETE RESTRICT',
    patient_id_type, doctor_id_type
  );
  ALTER TABLE public.billing
    ADD COLUMN IF NOT EXISTS encounter_id uuid
    REFERENCES public.encounters(encounter_id) ON DELETE RESTRICT;

  EXECUTE format(
    'ALTER TABLE public.prescription_medications
      ADD COLUMN IF NOT EXISTS quantity integer,
      ADD COLUMN IF NOT EXISTS frequency text,
      ADD COLUMN IF NOT EXISTS duration text,
      ADD COLUMN IF NOT EXISTS dispensed_quantity integer,
      ADD COLUMN IF NOT EXISTS dispensed_by %s,
      ADD COLUMN IF NOT EXISTS dispensed_at timestamptz',
    profile_id_type
  );
  ALTER TABLE public.prescriptions
    ADD COLUMN IF NOT EXISTS status text;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.prescription_medications'::regclass AND conname = 'prescription_medications_dispensed_by_fkey') THEN
    ALTER TABLE public.prescription_medications
      ADD CONSTRAINT prescription_medications_dispensed_by_fkey FOREIGN KEY (dispensed_by)
      REFERENCES public.profiles(id) ON DELETE SET NULL NOT VALID;
  END IF;

  ALTER TABLE public.medications
    ADD COLUMN IF NOT EXISTS stock_quantity bigint;

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.billing_payments (
      payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      bill_id %s NOT NULL REFERENCES public.billing(bill_id) ON DELETE RESTRICT,
      amount numeric(12,2) NOT NULL CHECK (amount > 0),
      payment_method text NOT NULL,
      reference text,
      received_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      paid_at timestamptz NOT NULL DEFAULT now()
    )',
    bill_id_type, profile_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.carepoint_stock_movements (
      movement_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      medication_id %s NOT NULL REFERENCES public.medications(medication_id) ON DELETE RESTRICT,
      prescription_medication_id %s REFERENCES public.prescription_medications(prescription_medication_id) ON DELETE RESTRICT,
      movement_type text NOT NULL CHECK (movement_type IN (''opening_balance'', ''adjustment'', ''dispense'')),
      quantity_before bigint,
      quantity_after bigint NOT NULL CHECK (quantity_after >= 0),
      notes text,
      recorded_by %s REFERENCES public.profiles(id) ON DELETE SET NULL,
      recorded_at timestamptz NOT NULL DEFAULT now()
    )',
    medication_id_type, prescription_item_id_type, profile_id_type
  );

  EXECUTE format(
    'CREATE TABLE IF NOT EXISTS public.carepoint_notifications (
      notification_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
      recipient_profile_id %s NOT NULL REFERENCES public.profiles(id) ON DELETE RESTRICT,
      patient_id %s REFERENCES public.patients(patient_id) ON DELETE SET NULL,
      encounter_id uuid REFERENCES public.encounters(encounter_id) ON DELETE SET NULL,
      event_type text NOT NULL,
      message text NOT NULL,
      created_at timestamptz NOT NULL DEFAULT now(),
      read_at timestamptz
    )',
    profile_id_type, patient_id_type
  );

  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.encounters'::regclass AND conname = 'encounters_patient_key'
  ) THEN
    ALTER TABLE public.encounters
      ADD CONSTRAINT encounters_patient_key UNIQUE (encounter_id, patient_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.encounters'::regclass AND conname = 'encounters_doctor_key'
  ) THEN
    ALTER TABLE public.encounters
      ADD CONSTRAINT encounters_doctor_key UNIQUE (encounter_id, patient_id, doctor_id);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_encounter_patient_fkey'
  ) THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_encounter_patient_fkey
      FOREIGN KEY (encounter_id, patient_id)
      REFERENCES public.encounters(encounter_id, patient_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.consultations'::regclass AND conname = 'consultations_encounter_doctor_fkey'
  ) THEN
    ALTER TABLE public.consultations
      ADD CONSTRAINT consultations_encounter_doctor_fkey
      FOREIGN KEY (encounter_id, patient_id, doctor_id)
      REFERENCES public.encounters(encounter_id, patient_id, doctor_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.diagnoses'::regclass AND conname = 'diagnoses_encounter_doctor_fkey'
  ) THEN
    ALTER TABLE public.diagnoses
      ADD CONSTRAINT diagnoses_encounter_doctor_fkey
      FOREIGN KEY (encounter_id, patient_id, doctor_id)
      REFERENCES public.encounters(encounter_id, patient_id, doctor_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_orders'::regclass AND conname = 'lab_orders_encounter_doctor_fkey'
  ) THEN
    ALTER TABLE public.lab_orders
      ADD CONSTRAINT lab_orders_encounter_doctor_fkey
      FOREIGN KEY (encounter_id, patient_id, ordered_by)
      REFERENCES public.encounters(encounter_id, patient_id, doctor_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.prescriptions'::regclass AND conname = 'prescriptions_encounter_doctor_fkey'
  ) THEN
    ALTER TABLE public.prescriptions
      ADD CONSTRAINT prescriptions_encounter_doctor_fkey
      FOREIGN KEY (encounter_id, patient_id, doctor_id)
      REFERENCES public.encounters(encounter_id, patient_id, doctor_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.billing'::regclass AND conname = 'billing_encounter_patient_fkey'
  ) THEN
    ALTER TABLE public.billing
      ADD CONSTRAINT billing_encounter_patient_fkey
      FOREIGN KEY (encounter_id, patient_id)
      REFERENCES public.encounters(encounter_id, patient_id) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.encounters'::regclass AND conname = 'encounters_status_check'
  ) THEN
    ALTER TABLE public.encounters
      ADD CONSTRAINT encounters_status_check
      CHECK (status IN ('open', 'in_progress', 'completed', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_orders'::regclass AND conname = 'lab_orders_status_check'
  ) THEN
    ALTER TABLE public.lab_orders
      ADD CONSTRAINT lab_orders_status_check
      CHECK (status IN ('requested', 'in_progress', 'completed', 'cancelled')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_orders'::regclass AND conname = 'lab_orders_priority_check'
  ) THEN
    ALTER TABLE public.lab_orders
      ADD CONSTRAINT lab_orders_priority_check
      CHECK (priority IN ('routine', 'urgent')) NOT VALID;
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.lab_results'::regclass AND conname = 'lab_results_status_check'
  ) THEN
    ALTER TABLE public.lab_results
      ADD CONSTRAINT lab_results_status_check
      CHECK (status IN ('pending_review', 'approved', 'rejected')) NOT VALID;
  END IF;
END $$;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.medications'::regclass AND conname = 'medications_stock_quantity_nonnegative') THEN
    ALTER TABLE public.medications
      ADD CONSTRAINT medications_stock_quantity_nonnegative CHECK (stock_quantity >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.prescription_medications'::regclass AND conname = 'prescription_medications_quantity_positive') THEN
    ALTER TABLE public.prescription_medications
      ADD CONSTRAINT prescription_medications_quantity_positive CHECK (quantity IS NULL OR quantity > 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.prescription_medications'::regclass AND conname = 'prescription_medications_dispensed_nonnegative') THEN
    ALTER TABLE public.prescription_medications
      ADD CONSTRAINT prescription_medications_dispensed_nonnegative CHECK (dispensed_quantity >= 0) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_systolic_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_systolic_range CHECK (systolic_bp IS NULL OR systolic_bp BETWEEN 1 AND 400) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_diastolic_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_diastolic_range CHECK (diastolic_bp IS NULL OR diastolic_bp BETWEEN 1 AND 300) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_heart_rate_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_heart_rate_range CHECK (heart_rate IS NULL OR heart_rate BETWEEN 1 AND 300) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_temperature_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_temperature_range CHECK (temperature_c IS NULL OR temperature_c BETWEEN 25 AND 45) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_respiratory_rate_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_respiratory_rate_range CHECK (respiratory_rate IS NULL OR respiratory_rate BETWEEN 1 AND 100) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_oxygen_saturation_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_oxygen_saturation_range CHECK (oxygen_saturation IS NULL OR oxygen_saturation BETWEEN 0 AND 100) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_weight_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_weight_range CHECK (weight_kg IS NULL OR weight_kg BETWEEN 0 AND 1000) NOT VALID;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'public.vital_signs'::regclass AND conname = 'vital_signs_height_range') THEN
    ALTER TABLE public.vital_signs
      ADD CONSTRAINT vital_signs_height_range CHECK (height_cm IS NULL OR height_cm BETWEEN 0 AND 300) NOT VALID;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS doctor_assignments_patient_active_idx
  ON public.doctor_assignments(patient_id, is_active);
CREATE INDEX IF NOT EXISTS doctor_assignments_doctor_active_idx
  ON public.doctor_assignments(doctor_id, is_active);
CREATE UNIQUE INDEX IF NOT EXISTS doctor_assignments_patient_doctor_active_idx
  ON public.doctor_assignments(patient_id, doctor_id)
  WHERE is_active;
CREATE UNIQUE INDEX IF NOT EXISTS encounters_appointment_unique_idx
  ON public.encounters(appointment_id)
  WHERE appointment_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS patients_profile_id_unique_idx
  ON public.patients(profile_id) WHERE profile_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS doctors_profile_id_unique_idx
  ON public.doctors(profile_id) WHERE profile_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS encounters_patient_started_idx
  ON public.encounters(patient_id, started_at DESC);
CREATE INDEX IF NOT EXISTS consultations_encounter_created_idx
  ON public.consultations(encounter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS diagnoses_encounter_created_idx
  ON public.diagnoses(encounter_id, created_at DESC);
CREATE INDEX IF NOT EXISTS vital_signs_encounter_recorded_idx
  ON public.vital_signs(encounter_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_encounter_ordered_idx
  ON public.lab_orders(encounter_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS lab_orders_patient_ordered_idx
  ON public.lab_orders(patient_id, ordered_at DESC);
CREATE INDEX IF NOT EXISTS lab_results_order_idx
  ON public.lab_results(lab_order_id);
CREATE INDEX IF NOT EXISTS prescriptions_patient_idx
  ON public.prescriptions(patient_id);
CREATE INDEX IF NOT EXISTS billing_encounter_idx
  ON public.billing(encounter_id);
CREATE INDEX IF NOT EXISTS billing_payments_bill_paid_idx
  ON public.billing_payments(bill_id, paid_at DESC);
CREATE INDEX IF NOT EXISTS carepoint_stock_movements_medication_recorded_idx
  ON public.carepoint_stock_movements(medication_id, recorded_at DESC);
CREATE INDEX IF NOT EXISTS carepoint_stock_movements_item_idx
  ON public.carepoint_stock_movements(prescription_medication_id)
  WHERE prescription_medication_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS carepoint_notifications_recipient_created_idx
  ON public.carepoint_notifications(recipient_profile_id, created_at DESC);
CREATE INDEX IF NOT EXISTS carepoint_notifications_unread_idx
  ON public.carepoint_notifications(recipient_profile_id, created_at DESC)
  WHERE read_at IS NULL;

ALTER TABLE public.profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.patients ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctors ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.appointments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medical_records ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_tests ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescriptions ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.prescription_medications ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.doctor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.encounters ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.vital_signs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.consultations ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.diagnoses ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.lab_results ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.billing_payments ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carepoint_stock_movements ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.carepoint_notifications ENABLE ROW LEVEL SECURITY;

CREATE OR REPLACE FUNCTION public.carepoint_has_role(required_role text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT EXISTS (
    SELECT 1
    FROM public.profiles p
    JOIN public.user_roles ur ON ur.user_id::text = p.id::text
    JOIN public.roles r ON r.id::text = ur.role_id::text
    WHERE p.id::text = auth.uid()::text
      AND r.name = required_role
  );
$$;

CREATE OR REPLACE FUNCTION public.carepoint_schema_ready()
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT auth.uid() IS NOT NULL
    AND to_regclass('public.doctor_assignments') IS NOT NULL
    AND to_regclass('public.encounters') IS NOT NULL
    AND to_regclass('public.vital_signs') IS NOT NULL
    AND to_regclass('public.consultations') IS NOT NULL
    AND to_regclass('public.diagnoses') IS NOT NULL
    AND to_regclass('public.lab_orders') IS NOT NULL
    AND to_regclass('public.lab_results') IS NOT NULL
    AND to_regclass('public.billing_payments') IS NOT NULL
    AND to_regclass('public.carepoint_stock_movements') IS NOT NULL
    AND to_regclass('public.carepoint_notifications') IS NOT NULL;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_owns_patient(target_patient text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.carepoint_has_role('patient') AND EXISTS (
    SELECT 1 FROM public.patients p
    WHERE p.patient_id::text = target_patient
      AND p.profile_id::text = auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public.carepoint_is_doctor(target_doctor text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.carepoint_has_role('doctor') AND EXISTS (
    SELECT 1 FROM public.doctors d
    WHERE d.doctor_id::text = target_doctor
      AND d.profile_id::text = auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public.carepoint_is_assigned_doctor(target_patient text)
RETURNS boolean
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
  SELECT public.carepoint_has_role('doctor') AND EXISTS (
    SELECT 1
    FROM public.doctor_assignments da
    JOIN public.doctors d ON d.doctor_id::text = da.doctor_id::text
    WHERE da.patient_id::text = target_patient
      AND da.is_active
      AND d.profile_id::text = auth.uid()::text
  );
$$;

CREATE OR REPLACE FUNCTION public.carepoint_notify_assigned_doctor()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  recipient public.profiles.id%TYPE;
  patient_recipient public.profiles.id%TYPE;
BEGIN
  IF TG_OP = 'UPDATE'
     AND NEW.doctor_id IS NOT DISTINCT FROM OLD.doctor_id
     AND NEW.appointment_date IS NOT DISTINCT FROM OLD.appointment_date THEN
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    SELECT p.profile_id INTO patient_recipient
    FROM public.patients p
    WHERE p.patient_id = NEW.patient_id;
    IF patient_recipient IS NOT NULL THEN
      INSERT INTO public.carepoint_notifications(
        recipient_profile_id, patient_id, event_type, message
      )
      VALUES (
        patient_recipient, NEW.patient_id, 'appointment_requested',
        'An appointment has been requested for your patient account.'
      );
    END IF;
  ELSIF NEW.appointment_date IS DISTINCT FROM OLD.appointment_date THEN
    SELECT p.profile_id INTO patient_recipient
    FROM public.patients p
    WHERE p.patient_id = NEW.patient_id;
    IF patient_recipient IS NOT NULL THEN
      INSERT INTO public.carepoint_notifications(
        recipient_profile_id, patient_id, event_type, message
      )
      VALUES (
        patient_recipient, NEW.patient_id, 'appointment_rescheduled',
        'Your appointment date or time has changed.'
      );
    END IF;
  END IF;

  IF NEW.doctor_id IS NOT NULL
     AND (
       TG_OP = 'INSERT'
       OR NEW.doctor_id IS DISTINCT FROM OLD.doctor_id
       OR NEW.appointment_date IS DISTINCT FROM OLD.appointment_date
     ) THEN
    SELECT d.profile_id INTO recipient
    FROM public.doctors d
    WHERE d.doctor_id = NEW.doctor_id;
  END IF;

  IF recipient IS NOT NULL THEN
    INSERT INTO public.carepoint_notifications(
      recipient_profile_id, patient_id, event_type, message
    )
    VALUES (
      recipient, NEW.patient_id,
      CASE WHEN TG_OP = 'INSERT' THEN 'appointment_assigned' ELSE 'appointment_updated' END,
      CASE WHEN TG_OP = 'INSERT' THEN 'A patient appointment was assigned to you.'
        ELSE 'A patient appointment for you has been updated.' END
    );
  END IF;
  RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_request_appointment(
  target_doctor text,
  requested_date timestamptz,
  reason_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
BEGIN
  IF NOT public.carepoint_has_role('patient') THEN
    RAISE EXCEPTION 'Only a patient account can request an appointment.';
  END IF;
  IF requested_date IS NULL OR reason_text IS NULL OR btrim(reason_text) = '' THEN
    RAISE EXCEPTION 'Appointment date and reason are required.';
  END IF;

  SELECT p.patient_id INTO patient_key
  FROM public.patients p
  WHERE p.profile_id::text = auth.uid()::text;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'No patient record is linked to this profile.';
  END IF;
  SELECT d.doctor_id INTO doctor_key
  FROM public.doctors d
  WHERE d.doctor_id::text = target_doctor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor was not found.';
  END IF;

  INSERT INTO public.appointments(patient_id, doctor_id, appointment_date, reason)
  VALUES (patient_key, doctor_key, requested_date, btrim(reason_text));
END;
$$;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_trigger
    WHERE tgrelid = 'public.appointments'::regclass
      AND tgname = 'carepoint_20261105_appointment_notification'
      AND NOT tgisinternal
  ) THEN
    CREATE TRIGGER carepoint_20261105_appointment_notification
      AFTER INSERT OR UPDATE OF doctor_id, appointment_date ON public.appointments
      FOR EACH ROW EXECUTE FUNCTION public.carepoint_notify_assigned_doctor();
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_dispense_prescription_item(item_key text, dispense_count integer)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  target_medication public.medications.medication_id%TYPE;
  target_item public.prescription_medications.prescription_medication_id%TYPE;
  target_prescription public.prescriptions.prescription_id%TYPE;
  ordered_count integer;
  already_dispensed integer;
  stock_before bigint;
  stock_after bigint;
BEGIN
  IF NOT public.carepoint_has_role('pharmacist') THEN
    RAISE EXCEPTION 'Only an assigned pharmacist can dispense medication.';
  END IF;
  IF dispense_count IS NULL OR dispense_count <= 0 THEN
    RAISE EXCEPTION 'Dispense quantity must be a positive integer.';
  END IF;

  SELECT pm.medication_id, pm.prescription_medication_id, pm.prescription_id,
         pm.quantity, pm.dispensed_quantity
  INTO target_medication, target_item, target_prescription, ordered_count, already_dispensed
  FROM public.prescription_medications pm
  WHERE pm.prescription_medication_id::text = item_key
  FOR UPDATE;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Prescription medication item was not found.';
  END IF;
  IF ordered_count IS NULL OR already_dispensed IS NULL THEN
    RAISE EXCEPTION 'This legacy prescription has no verified quantity or dispensing balance. Reconcile it before dispensing.';
  END IF;
  IF already_dispensed + dispense_count > ordered_count THEN
    RAISE EXCEPTION 'Dispense quantity exceeds the recorded prescription quantity.';
  END IF;

  SELECT m.stock_quantity INTO stock_before
  FROM public.medications m
  WHERE m.medication_id = target_medication
  FOR UPDATE;
  IF NOT FOUND OR stock_before IS NULL THEN
    RAISE EXCEPTION 'Medication stock is not known. Record an opening stock balance before dispensing.';
  END IF;
  IF stock_before < dispense_count THEN
    RAISE EXCEPTION 'Medication stock is insufficient.';
  END IF;

  UPDATE public.medications m
  SET stock_quantity = stock_before - dispense_count
  WHERE m.medication_id = target_medication
  RETURNING m.stock_quantity INTO stock_after;

  UPDATE public.prescription_medications pm
  SET dispensed_quantity = already_dispensed + dispense_count,
      dispensed_by = auth.uid(),
      dispensed_at = now()
  WHERE pm.prescription_medication_id = target_item;

  INSERT INTO public.carepoint_stock_movements(
    medication_id, prescription_medication_id, movement_type,
    quantity_before, quantity_after, notes, recorded_by
  )
  VALUES (
    target_medication, target_item, 'dispense', stock_before, stock_after,
    'Prescription dispensing', auth.uid()
  );

  UPDATE public.prescriptions p
  SET status = CASE
    WHEN NOT EXISTS (
      SELECT 1
      FROM public.prescription_medications pm
      WHERE pm.prescription_id = target_prescription
        AND (pm.quantity IS NULL OR pm.dispensed_quantity IS NULL OR pm.dispensed_quantity < pm.quantity)
    ) THEN 'dispensed'
    ELSE 'partially_dispensed'
  END
  WHERE p.prescription_id = target_prescription;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_adjust_medication_stock(
  target_medication text,
  target_stock bigint,
  notes_text text
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  medication_key public.medications.medication_id%TYPE;
  stock_before bigint;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('pharmacist')) THEN
    RAISE EXCEPTION 'Only an administrator or pharmacist can record medication stock.';
  END IF;
  IF target_stock IS NULL OR target_stock < 0 THEN
    RAISE EXCEPTION 'Stock quantity must be a non-negative whole number.';
  END IF;

  SELECT m.medication_id, m.stock_quantity
  INTO medication_key, stock_before
  FROM public.medications m
  WHERE m.medication_id::text = target_medication
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication was not found.';
  END IF;

  UPDATE public.medications
  SET stock_quantity = target_stock
  WHERE medication_id = medication_key;

  INSERT INTO public.carepoint_stock_movements(
    medication_id, movement_type, quantity_before, quantity_after, notes, recorded_by
  )
  VALUES (
    medication_key,
    CASE WHEN stock_before IS NULL THEN 'opening_balance' ELSE 'adjustment' END,
    stock_before,
    target_stock,
    NULLIF(btrim(notes_text), ''),
    auth.uid()
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_record_triage(
  target_patient text,
  target_doctor text,
  measurements jsonb,
  target_appointment text
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  doctor_profile public.profiles.id%TYPE;
  appointment_key public.appointments.appointment_id%TYPE;
  appointment_patient public.appointments.patient_id%TYPE;
  appointment_doctor public.appointments.doctor_id%TYPE;
  new_encounter uuid;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('receptionist')
          OR public.carepoint_has_role('doctor')) THEN
    RAISE EXCEPTION 'This account cannot record triage.';
  END IF;

  SELECT p.patient_id INTO patient_key
  FROM public.patients p
  WHERE p.patient_id::text = target_patient;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient was not found.';
  END IF;

  IF public.carepoint_has_role('doctor') THEN
    SELECT d.doctor_id INTO doctor_key
    FROM public.doctors d
    WHERE d.profile_id::text = auth.uid()::text;
    IF NOT FOUND OR NOT public.carepoint_is_assigned_doctor(patient_key::text) THEN
      RAISE EXCEPTION 'A doctor may record triage only for an assigned patient.';
    END IF;
  ELSIF target_doctor IS NOT NULL AND btrim(target_doctor) <> '' THEN
    SELECT d.doctor_id INTO doctor_key
    FROM public.doctors d
    WHERE d.doctor_id::text = target_doctor;
    IF NOT FOUND THEN
      RAISE EXCEPTION 'Assigned doctor was not found.';
    END IF;
    INSERT INTO public.doctor_assignments(patient_id, doctor_id, assigned_by, is_active)
    SELECT patient_key, doctor_key, auth.uid(), true
    WHERE NOT EXISTS (
      SELECT 1 FROM public.doctor_assignments da
      WHERE da.patient_id::text = patient_key::text
        AND da.doctor_id::text = doctor_key::text
        AND da.is_active
    );
  END IF;

  IF target_appointment IS NOT NULL AND btrim(target_appointment) <> '' THEN
    SELECT a.appointment_id, a.patient_id, a.doctor_id
    INTO appointment_key, appointment_patient, appointment_doctor
    FROM public.appointments a
    WHERE a.appointment_id::text = target_appointment;
    IF NOT FOUND OR appointment_patient::text <> patient_key::text THEN
      RAISE EXCEPTION 'The selected appointment does not belong to this patient.';
    END IF;
    IF doctor_key IS NULL THEN
      doctor_key := appointment_doctor;
    ELSIF appointment_doctor::text <> doctor_key::text THEN
      RAISE EXCEPTION 'The selected appointment is assigned to a different doctor.';
    END IF;
    IF EXISTS (
      SELECT 1 FROM public.encounters e WHERE e.appointment_id = appointment_key
    ) THEN
      RAISE EXCEPTION 'This appointment already has an encounter.';
    END IF;
  END IF;

  INSERT INTO public.encounters(patient_id, doctor_id, appointment_id, status)
  VALUES (patient_key, doctor_key, appointment_key, 'open')
  RETURNING encounter_id INTO new_encounter;

  INSERT INTO public.vital_signs(
    encounter_id, patient_id, recorded_by, systolic_bp, diastolic_bp,
    heart_rate, temperature_c, respiratory_rate, oxygen_saturation,
    weight_kg, height_cm, notes
  )
  VALUES (
    new_encounter,
    patient_key,
    auth.uid(),
    NULLIF(measurements->>'systolic_bp', '')::integer,
    NULLIF(measurements->>'diastolic_bp', '')::integer,
    NULLIF(measurements->>'heart_rate', '')::integer,
    NULLIF(measurements->>'temperature_c', '')::numeric,
    NULLIF(measurements->>'respiratory_rate', '')::integer,
    NULLIF(measurements->>'oxygen_saturation', '')::numeric,
    NULLIF(measurements->>'weight_kg', '')::numeric,
    NULLIF(measurements->>'height_cm', '')::numeric,
    NULLIF(measurements->>'notes', '')
  );

  IF doctor_key IS NOT NULL THEN
    SELECT d.profile_id INTO doctor_profile
    FROM public.doctors d
    WHERE d.doctor_id = doctor_key;
    IF doctor_profile IS NOT NULL THEN
      INSERT INTO public.carepoint_notifications(
        recipient_profile_id, patient_id, encounter_id, event_type, message
      )
      VALUES (
        doctor_profile, patient_key, new_encounter, 'patient_checked_in',
        'A patient has checked in and is waiting for your consultation.'
      );
    END IF;
  END IF;
  RETURN new_encounter;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_assign_doctor(target_patient text, target_doctor text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  doctor_profile public.profiles.id%TYPE;
  inserted_assignments integer := 0;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('receptionist')) THEN
    RAISE EXCEPTION 'This account cannot assign a doctor.';
  END IF;
  SELECT p.patient_id INTO patient_key FROM public.patients p WHERE p.patient_id::text = target_patient;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Patient was not found.';
  END IF;
  SELECT d.doctor_id INTO doctor_key FROM public.doctors d WHERE d.doctor_id::text = target_doctor;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Doctor was not found.';
  END IF;

  INSERT INTO public.doctor_assignments(patient_id, doctor_id, assigned_by, is_active)
  SELECT patient_key, doctor_key, auth.uid(), true
  WHERE NOT EXISTS (
    SELECT 1 FROM public.doctor_assignments da
    WHERE da.patient_id::text = patient_key::text
      AND da.doctor_id::text = doctor_key::text
      AND da.is_active
  );
  GET DIAGNOSTICS inserted_assignments = ROW_COUNT;
  UPDATE public.encounters
  SET doctor_id = doctor_key
  WHERE patient_id::text = patient_key::text
    AND doctor_id IS NULL
    AND status = 'open';
  IF inserted_assignments > 0 THEN
    SELECT d.profile_id INTO doctor_profile
    FROM public.doctors d
    WHERE d.doctor_id = doctor_key;
    IF doctor_profile IS NOT NULL THEN
      INSERT INTO public.carepoint_notifications(
        recipient_profile_id, patient_id, event_type, message
      )
      VALUES (
        doctor_profile, patient_key, 'doctor_assigned',
        'A patient has been assigned to your care.'
      );
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_set_lab_order_in_progress(target_order text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  current_status text;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('lab_technician')) THEN
    RAISE EXCEPTION 'Only a laboratory technician can process a laboratory order.';
  END IF;

  SELECT lo.status INTO current_status
  FROM public.lab_orders lo
  WHERE lo.lab_order_id::text = target_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laboratory order was not found.';
  END IF;
  IF current_status NOT IN ('requested', 'in_progress') THEN
    RAISE EXCEPTION 'Only a requested laboratory order can be accepted.';
  END IF;

  UPDATE public.lab_orders
  SET status = 'in_progress'
  WHERE lab_order_id::text = target_order;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_create_prescription(
  target_encounter uuid,
  target_medication text,
  dosage_text text,
  frequency_text text,
  duration_text text,
  instructions_text text,
  prescribed_quantity integer
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  medication_key public.medications.medication_id%TYPE;
  prescription_key public.prescriptions.prescription_id%TYPE;
  patient_profile public.profiles.id%TYPE;
BEGIN
  IF prescribed_quantity IS NULL OR prescribed_quantity <= 0
     OR frequency_text IS NULL OR btrim(frequency_text) = ''
     OR duration_text IS NULL OR btrim(duration_text) = '' THEN
    RAISE EXCEPTION 'Prescription quantity must be a positive integer.';
  END IF;
  SELECT e.patient_id, e.doctor_id INTO patient_key, doctor_key
  FROM public.encounters e
  WHERE e.encounter_id = target_encounter
  FOR UPDATE;
  IF NOT FOUND OR doctor_key IS NULL THEN
    RAISE EXCEPTION 'An encounter with an assigned doctor is required.';
  END IF;
  IF NOT public.carepoint_has_role('admin') AND
     (NOT public.carepoint_has_role('doctor')
      OR NOT public.carepoint_is_doctor(doctor_key::text)
      OR NOT public.carepoint_is_assigned_doctor(patient_key::text)) THEN
    RAISE EXCEPTION 'Only the assigned doctor can prescribe for this encounter.';
  END IF;

  SELECT m.medication_id INTO medication_key
  FROM public.medications m
  WHERE m.medication_id::text = target_medication;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Medication was not found.';
  END IF;

  INSERT INTO public.prescriptions(encounter_id, patient_id, doctor_id, status)
  VALUES (target_encounter, patient_key, doctor_key, 'pending')
  RETURNING prescription_id INTO prescription_key;

  INSERT INTO public.prescription_medications(
    prescription_id, medication_id, dosage, frequency, duration, instructions,
    quantity, dispensed_quantity
  )
  VALUES (
    prescription_key, medication_key, dosage_text, btrim(frequency_text),
    btrim(duration_text), instructions_text, prescribed_quantity, 0
  );
  SELECT p.profile_id INTO patient_profile
  FROM public.patients p
  WHERE p.patient_id = patient_key;
  IF patient_profile IS NOT NULL THEN
    INSERT INTO public.carepoint_notifications(
      recipient_profile_id, patient_id, encounter_id, event_type, message
    )
    VALUES (
      patient_profile, patient_key, target_encounter, 'prescription_created',
      'A prescription has been created for your encounter.'
    );
  END IF;
  RETURN prescription_key::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_review_lab_result(result_key text, decision text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  order_patient text;
  patient_profile public.profiles.id%TYPE;
BEGIN
  IF decision NOT IN ('approved', 'rejected') THEN
    RAISE EXCEPTION 'Review decision must be approved or rejected.';
  END IF;

  SELECT lo.patient_id::text INTO order_patient
  FROM public.lab_results lr
  JOIN public.lab_orders lo ON lo.lab_order_id = lr.lab_order_id
  WHERE lr.lab_result_id::text = result_key
  FOR UPDATE OF lr;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laboratory result was not found.';
  END IF;
  IF NOT public.carepoint_has_role('admin')
     AND NOT (public.carepoint_has_role('doctor')
              AND public.carepoint_is_assigned_doctor(order_patient)) THEN
    RAISE EXCEPTION 'Only an assigned doctor can review this laboratory result.';
  END IF;

  UPDATE public.lab_results
  SET status = decision,
      reviewed_by = auth.uid(),
      published_at = CASE WHEN decision = 'approved' THEN now() ELSE NULL END
  WHERE lab_result_id::text = result_key;

  IF decision = 'approved' THEN
    SELECT p.profile_id INTO patient_profile
    FROM public.lab_results lr
    JOIN public.lab_orders lo ON lo.lab_order_id = lr.lab_order_id
    JOIN public.patients p ON p.patient_id = lo.patient_id
    WHERE lr.lab_result_id::text = result_key;
    IF patient_profile IS NOT NULL THEN
      INSERT INTO public.carepoint_notifications(
        recipient_profile_id, patient_id, event_type, message
      )
      SELECT patient_profile, lo.patient_id, 'lab_result_published',
        'A laboratory result has been reviewed and published.'
      FROM public.lab_results lr
      JOIN public.lab_orders lo ON lo.lab_order_id = lr.lab_order_id
      WHERE lr.lab_result_id::text = result_key;
    END IF;
  END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_submit_lab_result(
  target_order text,
  value_text text,
  units_text text,
  reference_text text,
  notes_text text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  order_key public.lab_orders.lab_order_id%TYPE;
  order_status text;
  result_key public.lab_results.lab_result_id%TYPE;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('lab_technician')) THEN
    RAISE EXCEPTION 'Only a laboratory technician can submit a laboratory result.';
  END IF;
  IF value_text IS NULL OR btrim(value_text) = '' THEN
    RAISE EXCEPTION 'A laboratory result value is required.';
  END IF;

  SELECT lo.lab_order_id, lo.status INTO order_key, order_status
  FROM public.lab_orders lo
  WHERE lo.lab_order_id::text = target_order
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laboratory order was not found.';
  END IF;
  IF order_status = 'completed' OR order_status = 'cancelled' THEN
    RAISE EXCEPTION 'This laboratory order is no longer accepting results.';
  END IF;

  INSERT INTO public.lab_results(
    lab_order_id, result_value, units, reference_range, result_notes,
    status, performed_by, performed_at
  )
  VALUES (
    order_key, btrim(value_text), NULLIF(btrim(units_text), ''),
    NULLIF(btrim(reference_text), ''), NULLIF(btrim(notes_text), ''),
    'pending_review', auth.uid(), now()
  )
  RETURNING lab_result_id INTO result_key;

  UPDATE public.lab_orders
  SET status = 'completed'
  WHERE lab_order_id = order_key;
  RETURN result_key::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_record_payment(
  target_bill text,
  payment_amount numeric,
  method_text text,
  reference_text text
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
  patient_profile public.profiles.id%TYPE;
BEGIN
  IF NOT (public.carepoint_has_role('admin') OR public.carepoint_has_role('receptionist')) THEN
    RAISE EXCEPTION 'This account cannot record a bill payment.';
  END IF;
  IF payment_amount IS NULL OR payment_amount <= 0 OR method_text IS NULL OR btrim(method_text) = '' THEN
    RAISE EXCEPTION 'A positive amount and payment method are required.';
  END IF;

  SELECT b.bill_id, b.total_amount INTO bill_key, bill_total
  FROM public.billing b
  WHERE b.bill_id::text = target_bill
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Bill was not found.';
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

  INSERT INTO public.billing_payments(bill_id, amount, payment_method, reference, received_by)
  VALUES (bill_key, payment_amount, btrim(method_text), NULLIF(btrim(reference_text), ''), auth.uid())
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

CREATE OR REPLACE FUNCTION public.carepoint_complete_consultation(
  target_encounter uuid,
  complaint_text text,
  clinical_text text,
  plan_text text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  encounter_status text;
  consultation_key uuid;
BEGIN
  IF complaint_text IS NULL OR btrim(complaint_text) = '' THEN
    RAISE EXCEPTION 'A chief complaint is required.';
  END IF;

  SELECT e.patient_id, e.doctor_id, e.status
  INTO patient_key, doctor_key, encounter_status
  FROM public.encounters e
  WHERE e.encounter_id = target_encounter
  FOR UPDATE;
  IF NOT FOUND OR doctor_key IS NULL THEN
    RAISE EXCEPTION 'An encounter with an assigned doctor is required.';
  END IF;
  IF encounter_status = 'completed' THEN
    RAISE EXCEPTION 'This encounter is already completed.';
  END IF;
  IF NOT public.carepoint_has_role('admin') AND
     (NOT public.carepoint_has_role('doctor')
      OR NOT public.carepoint_is_doctor(doctor_key::text)
      OR NOT public.carepoint_is_assigned_doctor(patient_key::text)) THEN
    RAISE EXCEPTION 'Only the assigned doctor can complete this consultation.';
  END IF;

  INSERT INTO public.consultations(
    encounter_id, patient_id, doctor_id, chief_complaint, clinical_notes, treatment_plan
  )
  VALUES (
    target_encounter, patient_key, doctor_key, btrim(complaint_text),
    NULLIF(btrim(clinical_text), ''), NULLIF(btrim(plan_text), '')
  )
  RETURNING consultation_id INTO consultation_key;

  UPDATE public.encounters
  SET status = 'completed', ended_at = now()
  WHERE encounter_id = target_encounter;
  RETURN consultation_key::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_record_diagnosis(
  target_encounter uuid,
  diagnosis_code text,
  diagnosis_text text,
  primary_diagnosis boolean
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  diagnosis_key uuid;
BEGIN
  IF diagnosis_text IS NULL OR btrim(diagnosis_text) = '' THEN
    RAISE EXCEPTION 'A diagnosis description is required.';
  END IF;

  SELECT e.patient_id, e.doctor_id INTO patient_key, doctor_key
  FROM public.encounters e
  WHERE e.encounter_id = target_encounter
  FOR UPDATE;
  IF NOT FOUND OR doctor_key IS NULL THEN
    RAISE EXCEPTION 'An encounter with an assigned doctor is required.';
  END IF;
  IF NOT public.carepoint_has_role('admin') AND
     (NOT public.carepoint_has_role('doctor')
      OR NOT public.carepoint_is_doctor(doctor_key::text)
      OR NOT public.carepoint_is_assigned_doctor(patient_key::text)) THEN
    RAISE EXCEPTION 'Only the assigned doctor can record a diagnosis.';
  END IF;

  INSERT INTO public.diagnoses(
    encounter_id, patient_id, doctor_id, code, description, is_primary
  )
  VALUES (
    target_encounter, patient_key, doctor_key, NULLIF(btrim(diagnosis_code), ''),
    btrim(diagnosis_text), COALESCE(primary_diagnosis, false)
  )
  RETURNING diagnosis_id INTO diagnosis_key;
  RETURN diagnosis_key::text;
END;
$$;

CREATE OR REPLACE FUNCTION public.carepoint_create_lab_order(
  target_encounter uuid,
  target_test text,
  order_priority text,
  order_instructions text
)
RETURNS text
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  patient_key public.patients.patient_id%TYPE;
  doctor_key public.doctors.doctor_id%TYPE;
  test_key public.lab_tests.test_id%TYPE;
  order_key uuid;
BEGIN
  IF order_priority NOT IN ('routine', 'urgent') THEN
    RAISE EXCEPTION 'Laboratory priority must be routine or urgent.';
  END IF;

  SELECT e.patient_id, e.doctor_id INTO patient_key, doctor_key
  FROM public.encounters e
  WHERE e.encounter_id = target_encounter
  FOR UPDATE;
  IF NOT FOUND OR doctor_key IS NULL THEN
    RAISE EXCEPTION 'An encounter with an assigned doctor is required.';
  END IF;
  IF NOT public.carepoint_has_role('admin') AND
     (NOT public.carepoint_has_role('doctor')
      OR NOT public.carepoint_is_doctor(doctor_key::text)
      OR NOT public.carepoint_is_assigned_doctor(patient_key::text)) THEN
    RAISE EXCEPTION 'Only the assigned doctor can order a laboratory test.';
  END IF;

  SELECT t.test_id INTO test_key
  FROM public.lab_tests t
  WHERE t.test_id::text = target_test;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'Laboratory test was not found.';
  END IF;

  INSERT INTO public.lab_orders(
    encounter_id, patient_id, ordered_by, test_id, priority, instructions
  )
  VALUES (
    target_encounter, patient_key, doctor_key, test_key, order_priority,
    NULLIF(btrim(order_instructions), '')
  )
  RETURNING lab_order_id INTO order_key;
  RETURN order_key::text;
END;
$$;

REVOKE ALL ON FUNCTION public.carepoint_has_role(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_schema_ready() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_owns_patient(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_is_doctor(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_is_assigned_doctor(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_notify_assigned_doctor() FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_request_appointment(text, timestamptz, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_dispense_prescription_item(text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_adjust_medication_stock(text, bigint, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_record_triage(text, text, jsonb, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_assign_doctor(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_set_lab_order_in_progress(text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_create_prescription(uuid, text, text, text, text, text, integer) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_complete_consultation(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_record_diagnosis(uuid, text, text, boolean) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_create_lab_order(uuid, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_review_lab_result(text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_submit_lab_result(text, text, text, text, text) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.carepoint_record_payment(text, numeric, text, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_has_role(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_schema_ready() TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_owns_patient(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_is_doctor(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_is_assigned_doctor(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_request_appointment(text, timestamptz, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_dispense_prescription_item(text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_adjust_medication_stock(text, bigint, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_record_triage(text, text, jsonb, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_assign_doctor(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_set_lab_order_in_progress(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_create_prescription(uuid, text, text, text, text, text, integer) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_complete_consultation(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_record_diagnosis(uuid, text, text, boolean) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_create_lab_order(uuid, text, text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_review_lab_result(text, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.carepoint_submit_lab_result(text, text, text, text, text) TO authenticated;

DO $$
DECLARE
  spec record;
  policy_name text;
  read_rule text;
  write_rule text;
BEGIN
  FOR spec IN
    SELECT * FROM (VALUES
      ('profiles', 'id::text = auth.uid()::text OR public.carepoint_has_role(''admin'')',
        'id::text = auth.uid()::text OR public.carepoint_has_role(''admin'')'),
      ('roles', 'true', 'public.carepoint_has_role(''admin'')'),
      ('user_roles', 'user_id::text = auth.uid()::text OR public.carepoint_has_role(''admin'')',
        'public.carepoint_has_role(''admin'') AND user_id::text <> auth.uid()::text'),
      ('patients', 'profile_id::text = auth.uid()::text OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR (public.carepoint_has_role(''receptionist'') AND profile_id IS NULL) OR profile_id::text = auth.uid()::text'),
      ('doctors', 'auth.uid() IS NOT NULL',
        'public.carepoint_has_role(''admin'')'),
      ('appointments', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR public.carepoint_is_doctor(doctor_id::text)',
        'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND public.carepoint_is_doctor(doctor_id::text))'),
      ('medical_records', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND public.carepoint_is_doctor(doctor_id::text))'),
      ('lab_tests', 'auth.uid() IS NOT NULL', 'public.carepoint_has_role(''admin'')'),
      ('medications', 'auth.uid() IS NOT NULL', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''pharmacist'')'),
      ('prescriptions', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''pharmacist'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'false'),
      ('prescription_medications', 'EXISTS (SELECT 1 FROM public.prescriptions p WHERE p.prescription_id::text = prescription_medications.prescription_id::text AND (public.carepoint_owns_patient(p.patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''pharmacist'') OR public.carepoint_is_assigned_doctor(p.patient_id::text)))',
        'false'),
      ('billing', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'')',
        'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'')'),
      ('carepoint_stock_movements', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''pharmacist'')',
        'false'),
      ('carepoint_notifications', 'recipient_profile_id::text = auth.uid()::text',
        'false')
    ) AS rules(table_name, read_rule, write_rule)
  LOOP
    read_rule := spec.read_rule;
    write_rule := spec.write_rule;
    FOREACH policy_name IN ARRAY ARRAY['carepoint_20261105_access', 'carepoint_20261105_guard'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = spec.table_name AND policyname = policy_name
      ) THEN
        IF policy_name = 'carepoint_20261105_access' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
            policy_name, spec.table_name, read_rule, write_rule
          );
        ELSE
          EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public USING (%s) WITH CHECK (%s)',
            policy_name, spec.table_name, read_rule, write_rule
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  FOR spec IN
    SELECT * FROM (VALUES
      ('doctor_assignments', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR public.carepoint_is_doctor(doctor_id::text)',
        'false'),
      ('encounters', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND (doctor_id IS NULL OR public.carepoint_is_doctor(doctor_id::text)))'),
      ('vital_signs', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'false'),
      ('consultations', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND public.carepoint_is_doctor(doctor_id::text) AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.encounter_id::text = consultations.encounter_id::text AND e.patient_id::text = consultations.patient_id::text AND e.doctor_id::text = consultations.doctor_id::text))'),
      ('diagnoses', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND public.carepoint_is_doctor(doctor_id::text) AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.encounter_id::text = diagnoses.encounter_id::text AND e.patient_id::text = diagnoses.patient_id::text AND e.doctor_id::text = diagnoses.doctor_id::text))'),
      ('lab_orders', 'public.carepoint_owns_patient(patient_id::text) OR public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''lab_technician'') OR public.carepoint_is_assigned_doctor(patient_id::text)',
        'public.carepoint_has_role(''admin'') OR (public.carepoint_is_assigned_doctor(patient_id::text) AND public.carepoint_is_doctor(ordered_by::text) AND EXISTS (SELECT 1 FROM public.encounters e WHERE e.encounter_id::text = lab_orders.encounter_id::text AND e.patient_id::text = lab_orders.patient_id::text AND e.doctor_id::text = lab_orders.ordered_by::text))'),
      ('lab_results', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''lab_technician'') OR EXISTS (SELECT 1 FROM public.lab_orders lo WHERE lo.lab_order_id = lab_results.lab_order_id AND (public.carepoint_owns_patient(lo.patient_id::text) OR public.carepoint_is_assigned_doctor(lo.patient_id::text)))',
        'false'),
      ('billing_payments', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''receptionist'') OR EXISTS (SELECT 1 FROM public.billing b WHERE b.bill_id::text = billing_payments.bill_id::text AND public.carepoint_owns_patient(b.patient_id::text))',
        'false'),
      ('carepoint_stock_movements', 'public.carepoint_has_role(''admin'') OR public.carepoint_has_role(''pharmacist'')',
        'false'),
      ('carepoint_notifications', 'recipient_profile_id::text = auth.uid()::text',
        'false')
    ) AS rules(table_name, read_rule, write_rule)
  LOOP
    FOREACH policy_name IN ARRAY ARRAY['carepoint_20261105_access', 'carepoint_20261105_guard'] LOOP
      IF NOT EXISTS (
        SELECT 1 FROM pg_policies
        WHERE schemaname = 'public' AND tablename = spec.table_name AND policyname = policy_name
      ) THEN
        IF policy_name = 'carepoint_20261105_access' THEN
          EXECUTE format(
            'CREATE POLICY %I ON public.%I AS PERMISSIVE FOR ALL TO authenticated USING (%s) WITH CHECK (%s)',
            policy_name, spec.table_name, spec.read_rule, spec.write_rule
          );
        ELSE
          EXECUTE format(
            'CREATE POLICY %I ON public.%I AS RESTRICTIVE FOR ALL TO public USING (%s) WITH CHECK (%s)',
            policy_name, spec.table_name, spec.read_rule, spec.write_rule
          );
        END IF;
      END IF;
    END LOOP;
  END LOOP;

  FOR spec IN
    SELECT table_name
    FROM (VALUES
      ('profiles'), ('roles'), ('user_roles'), ('patients'), ('doctors'),
      ('appointments'), ('medical_records'), ('lab_tests'), ('medications'),
      ('prescriptions'), ('prescription_medications'), ('doctor_assignments'),
      ('encounters'), ('vital_signs'), ('consultations'), ('diagnoses'),
      ('lab_orders'), ('lab_results'), ('billing'), ('billing_payments'),
      ('carepoint_stock_movements'), ('carepoint_notifications')
    ) AS secured_tables(table_name)
  LOOP
    IF NOT EXISTS (
      SELECT 1 FROM pg_policies
      WHERE schemaname = 'public'
        AND tablename = spec.table_name
        AND policyname = 'carepoint_20261105_no_delete'
    ) THEN
      EXECUTE format(
        'CREATE POLICY carepoint_20261105_no_delete ON public.%I AS RESTRICTIVE FOR DELETE TO public USING (false)',
        spec.table_name
      );
    END IF;
  END LOOP;
END $$;

GRANT SELECT ON public.profiles, public.roles, public.user_roles, public.patients, public.doctors,
  public.appointments, public.medical_records, public.lab_tests, public.medications,
  public.prescriptions, public.prescription_medications, public.billing,
  public.doctor_assignments, public.encounters, public.vital_signs, public.consultations,
  public.diagnoses, public.lab_orders, public.lab_results, public.billing_payments,
  public.carepoint_stock_movements, public.carepoint_notifications TO authenticated;
GRANT INSERT, UPDATE ON public.patients, public.appointments, public.medical_records,
  public.prescriptions, public.prescription_medications, public.doctor_assignments,
  public.encounters, public.vital_signs, public.consultations, public.diagnoses,
  public.lab_orders, public.lab_results, public.billing, public.billing_payments,
  public.medications, public.user_roles TO authenticated;

COMMIT;
