# Carepoint database field mapping

This mapping reflects the current UI and only the field names that PostgREST accepted in the live project. SQL types, nullability, constraints, and RLS policies are not exposed to the configured anon key; see [live-database-schema-report.md](./live-database-schema-report.md). Migration-dependent operations remain gated until the owner applies and verifies the reviewed migration. No live write is claimed.

## Authentication pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Login | Email address | Supabase Auth user email | Auth string | Required; browser email input | Auth user | Yes, used for authentication only |
| Login | Password | Supabase Auth password | Auth secret | Required | Auth user | No application-table write |
| Forgot password | Email address | Supabase Auth recovery API | Auth string | Required; browser email input | Auth user | No application-table write |
| Reset password | New password | Supabase Auth update-user API | Auth secret | Required; Supabase enforces configured password rules | Auth user | Yes, Supabase Auth |

No public registration form exists. The remember-me checkbox was removed because it had no implemented persistence behavior.

## Admin pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Admin dashboard | Patient count | `patients.patient_id` count from RLS-visible results | SQL type not exposed | N/A | Patient rows | Read only |
| Admin dashboard | Doctor count | `doctors.doctor_id` count from RLS-visible results | SQL type not exposed | N/A | Doctor rows | Read only |
| Admin dashboard | Appointment counts | `appointments.appointment_id`, `appointments.status` | SQL type not exposed | N/A | Appointment rows | Read only |
| User management | Name | `profiles.full_name` | SQL type not exposed | N/A | Profile | Read only |
| User management | Phone | `profiles.phone` | SQL type not exposed | N/A | Profile | Read only |
| User management | Role | `user_roles` -> `roles.name` | SQL type not exposed | N/A | Profile / role assignment | Read only |
| User management | Created | `profiles.created_at` | SQL type not exposed | N/A | Profile | Read only |
| Create/invite user | No active inputs | None | N/A | Disabled until a server-only service credential and safe role-assignment path exist | Auth user / `profiles` / `user_roles` | No |
| Patient management | Patient name/address/created | `patients.name`, `patients.address`, `patients.created_at` | SQL type not exposed | N/A | Patient | Read only |
| Patient management | Patient/profile link | `patients.profile_id` -> `profiles.id` | Same as existing `profiles.id` | Admin selects a profile already assigned the patient role; duplicate links are rejected | Patient / profile | Migration-gated update; live write not verified |
| Doctor management | Doctor name/specialization/created | `doctors.name`, `doctors.specialization`, `doctors.created_at` | SQL type not exposed | N/A | Doctor | Read only |
| Doctor management | Doctor/profile link | `doctors.profile_id` -> `profiles.id` | Same as existing `profiles.id` | Admin selects a profile already assigned the doctor role; duplicate links are rejected | Doctor / profile | Migration-gated update; live write not verified |
| Appointment management | Patient, doctor, date, reason, status | `appointments.patient_id`, `doctor_id`, `appointment_date`, `reason`, `status` | SQL type not exposed | N/A | Patient / doctor | Read only |
| Settings | Supabase/table status | Supabase Auth health and PostgREST relation existence probes | HTTP/API status | N/A | Project schema | Read only |

## Reception pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Patient registration | Patient name | `patients.name` | SQL type not exposed | Required; trimmed; max 200 characters in UI | Patient | Insert helper uses confirmed columns; depends on existing RLS/defaults and is not live-write verified |
| Patient registration | Address | `patients.address` | SQL type not exposed | Required; trimmed; max 1000 characters in UI | Patient | Insert helper uses confirmed columns; depends on existing RLS/defaults and is not live-write verified |
| Appointment booking | Patient selector | `appointments.patient_id` | SQL type not exposed | Required; selected from `patients.patient_id` | Patient | Reception inserts to the existing relation; DB authorization/live write not verified |
| Appointment booking | Doctor selector | `appointments.doctor_id` | SQL type not exposed | Required; selected from `doctors.doctor_id` | Doctor | Existing relation; DB authorization/live write not verified |
| Appointment booking | Appointment date | `appointments.appointment_date` | SQL type not exposed | Required; parsed before submission; migration preflight requires timestamp type | Appointment | Existing relation; DB authorization/live write not verified |
| Appointment booking | Reason | `appointments.reason` | SQL type not exposed | Required; max 1000 characters in UI | Appointment | Existing relation; DB authorization/live write not verified |
| Appointment booking | Status | `appointments.status` | SQL type not exposed | Not supplied; preflight requires an existing default or nullable column; allowed values remain unverified | Appointment | No client status value is guessed |

## Doctor pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Doctor appointments | Patient/doctor/date/reason/status | `appointments.patient_id`, `doctor_id`, `appointment_date`, `reason`, `status` | SQL type not exposed | N/A | Patient / doctor | Read only |
| Doctor patient list | Patient ID/name/address | `patients.patient_id`, `name`, `address` | SQL type not exposed | N/A | Patient | Read only |
| Medical records | Patient selector | `medical_records.patient_id` | SQL type not exposed | Required; selected from assigned patients | Patient | Existing-table insert helper; live RLS/write not verified |
| Medical records | Doctor selector | `medical_records.doctor_id` | SQL type not exposed | Required; selected from signed-in doctor record | Doctor | Existing-table insert helper; live RLS/write not verified |
| Medical records | Diagnosis | `medical_records.diagnosis` | SQL type not exposed | Required; trimmed; max 1000 characters in UI | Medical record | Existing-table insert helper; live write not verified |
| Medical records | Clinical notes | `medical_records.notes` | SQL type not exposed | Optional; max 5000 characters in UI | Medical record | Existing-table insert helper; live write not verified |
| Medical records | Treatment plan | `medical_records.treatment_plan` | SQL type not exposed | Optional; max 5000 characters in UI | Medical record | Existing-table insert helper; live write not verified |

`medical_records` remains the existing clinical/history relation and is not recreated. Encounter/consultation/diagnosis workflows are separate and migration-gated; no unsupported encounter relationship is inferred for historical rows.

## Patient pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Patient dashboard | Patient ID/name/address | `patients.profile_id`, `patients.patient_id`, `patients.name`, `patients.address` | Existing profile key type / SQL types not exposed | Profile link resolved from authenticated user; read requires RLS | Profile / patient | Read service implemented; migration-gated schema/RLS not verified |
| Patient appointments | Doctor/date/reason | `appointments.doctor_id`, `appointment_date`, `reason`; patient ID resolved inside `carepoint_request_appointment` from `patients.profile_id` | Existing SQL types not exposed | Required; patient identity is never accepted from the browser | Doctor / appointment / patient | Migration-gated RPC; live write not verified |
| Patient records | Diagnosis/notes/treatment plan | Existing `medical_records` fields plus new encounter/consultation/diagnosis/vital-sign relations | Existing fields confirmed; new schema proposed in migration | Scoped by authenticated patient mapping and RLS | Medical record / encounter | Existing query plus migration-gated clinical-history query; live RLS not verified |
| Patient bills | Bill ID, patient ID, total, status, created | `billing.bill_id`, `patient_id`, `total_amount`, `status`, `created_at` | SQL type not exposed | N/A | Patient / bill | Query scoped to linked patient and subject to RLS; live read not verified |
| Patient payments | Payment receipt, bill, amount, method, reference, paid time | `billing_payments.payment_id`, `bill_id`, `amount`, `payment_method`, `reference`, `paid_at` | Proposed SQL types | Derived from the patient's visible bill IDs and restricted by RLS | Bill / payment | Migration-gated; live read not verified |

## Laboratory pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Lab dashboard | Test ID/name/description | `lab_tests.test_id`, `name`, `description` | SQL type not exposed | N/A | Test catalog | Read only |
| Lab order | Order selector/result/units/reference/notes | `lab_results.lab_order_id`, `result_value`, `units`, `reference_range`, `result_notes` | `uuid`, `text` | Order and result required; others optional with length bounds | Lab order / encounter | Service calls transactional RPC after migration; live write not verified |

## Pharmacy pages

| Page | Field/value | Database target | Type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Pharmacy dashboard | Medication ID/name/description | `medications.medication_id`, `name`, `description` | SQL type not exposed | N/A | Medication catalog | Read only |
| Inventory | Medication / stock quantity | `medications.medication_id`, `stock_quantity` | Existing key type / `bigint` | Required; non-negative whole number | Medication | Service implemented; migration-gated; live write not verified |
| Dispensing | Prescription item / dispense quantity | `prescription_medications.prescription_medication_id`, `quantity`, `dispensed_quantity` | Existing key type / `integer` | Positive whole number; database rejects excess or insufficient stock | Prescription / medication | Atomic RPC implemented; migration-gated; live write not verified |

## Other displayed values

- Every data table value is read from the corresponding accepted database fields listed above.
- Empty states explicitly indicate that no visible records were returned; they do not imply successful writes.
- IDs are displayed where needed to disambiguate rows. Email is Auth-owned and not available from the confirmed `profiles` columns.
- Administrator and system activity values are not fabricated; an activity/audit relation was not confirmed.

## Migration-dependent workflow forms

The following forms are implemented, but their writes and reads remain disabled by the database until the migration is reviewed and applied. Types below are the proposed SQL types in that migration, not types verified from the live catalog.

| Page / form | Field label | Table.column | Proposed type | Required / validation | Related record | Persisted |
|---|---|---|---|---|---|---|
| Doctor assignments | Patient | `doctor_assignments.patient_id` | Same as `patients.patient_id` | Required; selected from live patient results | Patient | Yes after migration and authorized insert |
| Doctor assignments | Doctor | `doctor_assignments.doctor_id` | Same as `doctors.doctor_id` | Required; selected from live doctor results | Doctor | Yes after migration and authorized insert |
| Triage | Patient | `encounters.patient_id`, `vital_signs.patient_id` | Same as `patients.patient_id` | Required; selected from live patient results | Patient / encounter | Yes via `carepoint_record_triage` after migration |
| Triage | Assign doctor | `encounters.doctor_id`, `doctor_assignments.doctor_id` | Same as `doctors.doctor_id` | Required; selected from live doctor results; assignment is transactional | Doctor / encounter | Yes via `carepoint_record_triage` after migration |
| Triage | Systolic / diastolic BP | `vital_signs.systolic_bp`, `diastolic_bp` | `integer` | Optional; browser range 1–400 / 1–300 | Vital sign | Yes when supplied |
| Triage | Heart rate | `vital_signs.heart_rate` | `integer` | Optional; range 1–300 | Vital sign | Yes when supplied |
| Triage | Temperature | `vital_signs.temperature_c` | `numeric(5,2)` | Optional; range 25–45 °C | Vital sign | Yes when supplied |
| Triage | Respiratory rate | `vital_signs.respiratory_rate` | `integer` | Optional; range 1–100 | Vital sign | Yes when supplied |
| Triage | Oxygen saturation | `vital_signs.oxygen_saturation` | `numeric(5,2)` | Optional; range 0–100% | Vital sign | Yes when supplied |
| Triage | Weight / height | `vital_signs.weight_kg`, `height_cm` | `numeric(7,2)` | Optional; non-negative bounded inputs | Vital sign | Yes when supplied |
| Triage | Notes | `vital_signs.notes` | `text` | Optional; max 2,000 characters | Vital sign | Yes when supplied |
| Consultation | Encounter, patient, doctor | `consultations.encounter_id`, `patient_id`, `doctor_id` | `uuid` / existing key types | Required; database validates authorization and linkage | Encounter / patient / doctor | Yes after migration |
| Consultation | Chief complaint | `consultations.chief_complaint` | `text` | Required; max 2,000 characters | Consultation | Yes |
| Consultation | Clinical notes / treatment plan | `consultations.clinical_notes`, `treatment_plan` | `text` | Optional; max 5,000 characters each | Consultation | Yes when supplied |
| Diagnosis | Encounter, patient, doctor | `diagnoses.encounter_id`, `patient_id`, `doctor_id` | `uuid` / existing key types | Required; database validates authorization and linkage | Encounter / patient / doctor | Yes after migration |
| Diagnosis | Code / description / primary | `diagnoses.code`, `description`, `is_primary` | `text`, `text`, `boolean` | Description required; max 2,000 characters | Diagnosis | Yes |
| Lab order | Encounter, patient, doctor, test | `lab_orders.encounter_id`, `patient_id`, `ordered_by`, `test_id` | `uuid` / existing key types | Required; selects reference existing records | Encounter / patient / doctor / test | Yes after migration |
| Lab order | Priority / instructions | `lab_orders.priority`, `instructions` | `text`, `text` | Priority required (`routine` or `urgent`); instructions optional | Lab order | Yes |
| Lab result | Order / value / units / reference / notes | `lab_results.lab_order_id`, `result_value`, `units`, `reference_range`, `result_notes` | `uuid`, `text` | Order and result required; bounded text inputs | Lab order | Yes after migration |
| Prescription | Encounter / medication / dosage / instructions / quantity | `prescriptions.encounter_id`; `prescription_medications.medication_id`, `dosage`, `instructions`, `quantity` | `uuid`; existing medication key; `text`; `integer` | Required except instructions; quantity positive integer | Encounter / prescription / medication | Yes via `carepoint_create_prescription` after migration |
| Inventory | Medication / stock quantity | `medications.medication_id`, `stock_quantity` | Existing key; `bigint` | Required; stock is a non-negative whole number | Medication | Yes after migration; no opening-balance backfill is inferred |
| Dispensing | Prescription item / dispense quantity | `prescription_medications.prescription_medication_id`, `dispensed_quantity` | `uuid`, `integer` | Positive whole number; database rejects excess quantity or insufficient stock | Prescription item / medication | Yes atomically via `carepoint_dispense_prescription_item` after migration |
| Bill | Patient / encounter / total | `billing.patient_id`, `encounter_id`, `total_amount` | Existing key; `uuid`; existing amount type | Required; amount non-negative | Patient / encounter / bill | Yes after migration |
| Payment | Bill / amount / method / reference | `billing_payments.bill_id`, `amount`, `payment_method`, `reference` | Existing bill key; `numeric(12,2)`; `text`; `text` | Bill, positive amount, and method required | Bill / payment | Yes after migration and authorized insert |
| Patient dashboard | Profile-to-patient link | `patients.profile_id` -> `profiles.id` | Same as `profiles.id` | Resolved from authenticated user; never browser supplied | Profile / patient | Read only |

Reads on these pages are also explicit Supabase queries. Query/schema/RLS errors remain visible; the UI does not report a successful save unless the service receives the expected inserted row or successful RPC response.
