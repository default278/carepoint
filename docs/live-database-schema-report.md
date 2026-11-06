# Carepoint live Supabase schema report

## Inspection method and limits

Inspection used the configured Supabase project URL and public anon key via its Auth health endpoint and PostgREST schema routes. Queries selected metadata/columns with `limit=0` or `HEAD`; no patient or account row values were retrieved. The REST OpenAPI endpoint returned `401` because this project allows only the `service_role` key to access it. The GraphQL endpoint reported that `pg_graphql` is not enabled. The environment has no PostgreSQL connection string or service-role key.

Therefore this report distinguishes facts exposed by PostgREST from catalog details that cannot be verified with the configured credential. It does not claim inspection of SQL data types, primary/unique/check constraints, indexes, triggers, functions, or RLS policy definitions.

## Connection and row visibility

- Supabase Auth health endpoint: HTTP 200.
- REST API: reachable.
- Metadata-only `HEAD` checks succeeded for the listed existing relations; `Content-Range` reported `*/0` for each checked relation under the current anon role. This is not sufficient to distinguish an empty relation from rows filtered by RLS.
- The tables and fields below are accepted by PostgREST. Column data types and nullability are not exposed by these checks.
- Existing profile-to-role, appointment-to-patient/doctor, and medical-record-to-patient/doctor PostgREST relationships parsed successfully.

## Confirmed relations and accepted columns

| Relation | Confirmed fields | Application significance |
|---|---|---|
| `profiles` | `id`, `full_name`, `phone`, `created_at` | Does not expose `email`, `role`, `is_active`, or `updated_at` under those names. |
| `roles` | `id`, `name`, `description` | Role names must be read from `roles.name`. |
| `user_roles` | `user_id`, `role_id`, `assigned_at` | Profile role assignment is a relation, not a `profiles.role` field. |
| `patients` | `patient_id`, `name`, `address`, `created_at` | `id`, first/last name, email, phone, DOB, and gender were not accepted under those names. |
| `doctors` | `doctor_id`, `name`, `specialization`, `created_at` | `id`, `full_name`, `specialty`, email, and phone were not accepted under those names. |
| `appointments` | `appointment_id`, `patient_id`, `doctor_id`, `appointment_date`, `status`, `reason`, `created_at` | `id`, `scheduled_at`, `appointment_time`, `type`, `notes`, and `updated_at` were not accepted under those names. |
| `medical_records` | `record_id`, `patient_id`, `doctor_id`, `diagnosis`, `notes`, `treatment_plan`, `created_at` | `id`, `appointment_id`, `encounter_id`, `prescription`, and `updated_at` were not accepted under those names. |
| `lab_tests` | `test_id`, `name`, `description`, `created_at` | This is a catalog relation; no order/result relation exists among the expected names. |
| `medications` | `medication_id`, `name`, `description`, `created_at` | No `stock`, `quantity_in_stock`, `unit`, or `price` field was accepted under those names. |
| `prescriptions` | `prescription_id`, `created_at` | Patient, doctor, encounter, status, medication, dosage, frequency, duration, quantity, and notes fields were not accepted under the probed names. |
| `prescription_medications` | `prescription_medication_id`, `prescription_id`, `medication_id`, `dosage`, `instructions` | `frequency`, `duration`, `quantity`, `created_at`, and `id` were not accepted under those names. |
| `billing` | `bill_id`, `patient_id`, `total_amount`, `status`, `created_at` | `id`, `billing_id`, `invoice_id`, `appointment_id`, `amount`, `balance`, and `payment_status` were not accepted under those names. |

“Accepted” means PostgREST accepted the requested field name; it does not prove a SQL type, requiredness, or write policy.

## Relations unavailable from the current PostgREST schema cache

The latest read-only application health check returned `PGRST205` (“table not found in schema cache”) for:

- `encounters`
- `vital_signs`
- `doctor_assignments`
- `consultations`
- `diagnoses`
- `lab_orders`
- `lab_results`
- `billing_payments`
- `carepoint_stock_movements`
- `carepoint_notifications`

`prescription_medications` exists, so it must not be recreated. The ten `PGRST205` results do **not** establish physical absence; run the owner-side preflight below to distinguish missing relations from a stale or inaccessible schema cache.

## Manual migration package and execution order

The historical workflow and payment-idempotency migrations are retained as source records. The consolidated [`carepoint_complete_migration.sql`](../supabase/migrations/carepoint_complete_migration.sql) is the single candidate for owner review; do not execute the historical migrations in addition to it. There are no prerequisite DDL migrations. First run the read-only [`carepoint_schema_preflight.sql`](../supabase/diagnostics/carepoint_schema_preflight.sql) and review its owner-visible output, then follow the exact order in the [migration runbook](./carepoint-migration-runbook.md). Do not apply DDL if actual columns, types, key constraints, FKs, RLS policies, or roles do not match its preconditions.

The migration proposes the eight clinical relations above plus `carepoint_stock_movements` and `carepoint_notifications` (ten relations currently unavailable from PostgREST). It adds profile mappings to `patients` and `doctors`, encounter/patient/doctor references to existing prescriptions, medication inventory/dispensing fields, and an encounter reference to existing billing. It also adds indexes and relationship constraints, transactional workflow functions, triggers, grants, and restrictive RLS policies. It contains no `DROP`, `DELETE`, `TRUNCATE`, reset, or existing-record overwrite operation. It does not backfill patient/doctor profile mappings or infer legacy inventory quantities; those values remain unknown until reconciled.

### Confirmed versus unverified dependencies

The confirmed PostgREST schema provides the existing relation and accepted field names listed above, including candidate referenced key fields and the existing `prescription_medications` relation. It does **not** prove which fields are primary or unique keys. The migration derives its new foreign-key column SQL types from those live key columns and aborts unless each referenced key exists and has a valid, single-column unique index. This check is a migration-time precondition, not independent verification with the public key.

The live report does **not** establish actual SQL types, nullability, defaults, unique/FK/check constraints, indexes, existing policies, triggers, or functions. The migration expects `profiles.id`, `roles.id`, `patients.patient_id`, `doctors.doctor_id`, `appointments.appointment_id`, `lab_tests.test_id`, `medications.medication_id`, `prescriptions.prescription_id`, `prescription_medications.prescription_medication_id`, and `billing.bill_id` to be valid unique referenced keys; the migration aborts otherwise. It verifies the existing `user_roles`/`auth.users` relations, required existing FKs, insert defaults, numeric billing amount, timestamp appointment date, `auth.uid()`, Supabase roles `anon`/`authenticated`, and the six existing Carepoint role rows. Any mismatch requires inspecting and adapting the SQL against the actual owner-visible catalog before application—do not guess a replacement column or target.

### Required privileges and post-application checks

Use an authorized Supabase database-owner/migration role with catalog visibility and permission to alter the existing tables, create tables/indexes/constraints/functions/triggers/policies, enable RLS, and grant/revoke table and function privileges. A Carepoint application `admin` role or the anon key is not sufficient. No project service-role key is required or should be placed in the frontend.

After applying, the project's health endpoint checks whether all ten relations are queryable by the public client; it does not determine physical presence or validate account mappings, policies, or end-to-end workflows. Patient and doctor profile mappings remain unpopulated until an administrator links existing role-bearing profiles in the app, so patient/doctor-specific portal functions depend on that administrative data step. Auth-user creation/invitation still requires a protected Auth administrator credential and is not provided by this SQL migration.

## Application mismatches addressed

- Auth previously selected `profiles.role` and trusted a cached profile in local storage. The live schema uses `user_roles` joined to `roles`; cached authorization is removed.
- User listing previously expected profile email and role columns. It now reads role assignments through `user_roles`/`roles`; email remains an Auth-owned value and is not included in the public profile query.
- Patient, doctor, appointment, medical-record, lab-test, medication, prescription, and billing queries formerly assumed `id` and guessed columns. The app now uses only the accepted field names above.
- Hardcoded example patients, doctors, appointments, metrics, and bills were removed from the workflow pages.
- Patient registration now submits only `patients.name` and `patients.address`.
- Reception appointment creation uses the confirmed `patient_id`, `doctor_id`, `appointment_date`, and `reason` fields. Patient self-service uses a migration-gated RPC that derives the patient ID from the authenticated profile. No appointment status value is guessed or submitted.
- Medical-record creation submits the confirmed patient/doctor IDs, diagnosis, notes, and treatment plan.
- Encounter, triage, assignment, consultation, diagnosis, lab-order/result/review, prescription, stock/dispensing, and billing/payment forms and services use Supabase operations. Migration-dependent reads and writes are gated by `carepoint_schema_ready` or return an explicit database error; they cannot succeed until the reviewed migration exists.
- Consultation, diagnosis, and lab-order writes use database functions that derive patient/doctor links from the selected encounter and enforce the assigned-doctor rule. The frontend no longer accepts manually mismatched patient/doctor IDs for these operations.
- Reception triage can check in a patient against an optional matching appointment; the migration RPC creates the encounter, doctor assignment, and vitals together and rejects mismatched or duplicate check-ins.
- Admin pages link only profiles that already carry the matching patient/doctor role. Role changes replace a single existing role rather than creating multiple dashboard roles; database RLS rejects self-role assignment.
- Patient views include linked encounter history and published lab results, bills, payments, and notifications; payment and lab notifications are sent only to linked patient profiles.
- Reception staff have an integrated billing/payment page. Doctor, laboratory, and pharmacy actions use role-checked transactional RPCs and do not depend on a service-role key.
- The backend health endpoint checks existing and workflow relations for public-client queryability. It returns HTTP 503 when one or more relations are unavailable; `PGRST205` is labeled as not present in the current PostgREST schema cache and is not reported as proof of physical absence.

## Database metadata still required

The following cannot be determined with the configured anon key:

- SQL types, nullability, defaults, primary keys, unique constraints, check constraints, indexes, and exact FK definitions.
- Trigger definitions, SQL functions, and all existing RLS policies.
- Whether a successful zero-row read means the table is empty or rows are hidden by RLS.
- Admin Auth user existence, profile mapping, and role assignment. No password was supplied, and Auth admin APIs require a privileged server-side key.

The consolidated migration candidate in `supabase/migrations/carepoint_complete_migration.sql` is additive and is not applied. Review and apply it through a database-owner session only after reviewing the actual schema, policies, and backups. It preserves current rows and does not disable RLS. It sends `NOTIFY pgrst, 'reload schema'` after commit; the runbook includes a manual retry if the API cache does not refresh.

## Verification status

| Check | Result |
|---|---|
| Supabase project/Auth reachability | Passed (HTTP 200 Auth health) |
| Public REST relation/column parsing | Passed for confirmed columns above |
| Workflow relation checks | Passed; all ten return `PGRST205` from PostgREST. Physical presence/absence remains unverified without owner catalog access. |
| Combined frontend/backend development startup | Passed on unused alternate ports; frontend returned HTTP 200, `/api/ping` returned HTTP 200, and live health returned HTTP 503 |
| Workflow schema health status | Correctly reports degraded (HTTP 503); all ten workflow relations return `PGRST205` and are unavailable from the current cache. Physical status remains UNKNOWN. |
| Full SQL catalog / policy inspection | Blocked: anon key lacks catalog/OpenAPI privileges |
| Admin Auth/profile/role verification | Not run: no password or privileged Auth access |
| Patient/appointment/clinical write tests | Not run: no authenticated test account/policies; avoid unauthorized live writes |
| Automated project tests | Passed: 14 tests, including workflow migration gating and schema-cache error classification. |
| `npm run lint` | Passed with one pre-existing Fast Refresh warning in `AuthContext.tsx` |
| `npm run build` | Passed TypeScript and production build; Vite reports a >500 kB chunk advisory |
| Isolated migration fixture | Current migration parsed, applied to a clean local PostgreSQL schema, and re-applied successfully |
| Isolated workflow checks | Passed patient/doctor RLS scoping, self-role-assignment denial, encounter/triage/consultation/diagnosis/lab/prescription/payment/stock RPCs, and dispensing against the local fixture |
| Migration application | Not applied; requires database-owner approval |
