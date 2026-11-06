# Carepoint consolidated migration runbook

## Status and scope

[`carepoint_complete_migration.sql`](../supabase/migrations/carepoint_complete_migration.sql) is the **only authoritative consolidated migration candidate**. It incorporates the workflow and payment-idempotency logic from the historical [`20261105174500_carepoint_workflows.sql`](../supabase/migrations/20261105174500_carepoint_workflows.sql) and [`20261105222000_carepoint_payment_idempotency.sql`](../supabase/migrations/20261105222000_carepoint_payment_idempotency.sql). Keep those historical files for provenance only; **never execute either one separately or together with the consolidated file**. [`carepoint_schema_preflight.sql`](../supabase/diagnostics/carepoint_schema_preflight.sql) is a separate read-only catalog inspection, not a migration.

See the [database schema reference](./DATABASE_SCHEMA_REFERENCE.md) for per-relation evidence classifications, accepted live fields, candidate-only definitions, and the limited relationship diagrams.

The consolidated candidate has **not** been compared with owner-verified live catalog output and has **not** been applied to production. Local validation against a representative fixture does not establish that it matches the live project's columns, foreign keys, existing policies, functions, grants, or triggers. Do not execute it until the owner-side preflight output has been reviewed and the candidate reconciled with the actual schema.

The migrations and preflight do not create or assume the optional admissions, beds, ambulances, AI intake, dental, audit-log, or payment-allocation schema. Those existing relations, if present, must be reviewed separately before implementing dependent workflows.

## Safe review and application order

1. Make or verify an appropriate database backup/restore point using the project's established process.
2. In Supabase SQL Editor, run the entire read-only [`carepoint_schema_preflight.sql`](../supabase/diagnostics/carepoint_schema_preflight.sql). Save all result sets. It reports existing public columns/defaults/types, relations, keys/constraints/FKs, indexes, RLS state/policies, triggers, function definitions/owners/settings/ACLs, and role rows. Catalog visibility and the `roles` table must be available to the owner running it.
3. Compare the output against every precondition and relation dependency in `carepoint_complete_migration.sql`, and against current application query fields. Resolve every mismatch with the database owner. The six required role names are `admin`, `receptionist`, `doctor`, `patient`, `lab_technician`, and `pharmacist`; the migration does not create or rename them. The physical existence and definitions of all ten workflow relations must be checked directly; `PGRST205` is not sufficient evidence. If any proposed workflow relation, candidate function, or guarded object name already exists, **stop and reconcile the candidate with its owner-reviewed definition**. Do not infer the schema from the local fixture or public anon key.
4. After the owner approves the exact schema assumptions and preflight output, execute the **single complete file** [`carepoint_complete_migration.sql`](../supabase/migrations/carepoint_complete_migration.sql) in the Supabase SQL Editor under an authorized migration/database-owner role. No prerequisite migration file is to be executed: the preflight is read-only, and the historical SQL files are not part of the execution order. Run the file as one script; its DDL transaction is followed by read-only verification queries.
5. Confirm the script reaches `COMMIT`, sends the PostgREST schema reload notification, and that the post-commit result sets show all ten workflow relations present; payment column/RPC checks true; legacy payment RPC not executable by `authenticated`; idempotent payment RPC executable by `authenticated`; and RLS enabled on all 22 protected relations listed in the result.
6. If the API still reports a schema-cache error after the migration, issue this notification manually in SQL Editor:

   ```sql
   NOTIFY pgrst, 'reload schema';
   ```

   Verify the ten relations with the application health endpoint and Supabase REST API. The health endpoint reports queryability, not physical absence; `PGRST205` only describes PostgREST's current schema cache. Use the owner-side preflight to determine whether a relation physically exists. Then perform authenticated tests under the intended role mappings before enabling dependent workflows.

## What the consolidated migration changes

- Creates the eight clinical workflow relations and the two Carepoint support relations: doctor assignments, encounters, vital signs, consultations, diagnoses, lab orders/results, billing payments, stock movements, and notifications.
- Derives new FK column types from existing core keys where the workflow migration does so, adds relationship constraints and indexes, and extends patients/doctors with nullable profile links. It adds encounter references and inventory/dispensing fields required by the existing application paths.
- Adds workflow RPCs, notification trigger behavior, RLS, scoped policies, and table/function grants. Existing policies are not dropped. It does not create admissions, AI, ambulance, beds, dental, audit-log, or payment-allocation tables.
- Adds `billing_payments.idempotency_key`, a unique index, and a five-argument payment RPC. It serializes same-key retries with an advisory transaction lock and serializes bill balance checks with a row lock. An identical retry returns its original payment ID, changed details using the same key fail, and distinct keys can create partial payments only up to the bill total. It revokes the old four-argument RPC from `PUBLIC`, `anon`, and `authenticated`; that old function is never granted by the consolidated file.
- Preserves existing data: no table/schema drops, truncation, record deletion, or automatic profile-link backfill. Legacy `NOT VALID` constraints require owner review before validation. Existing stock quantities are not fabricated.

## Payment idempotency verification

The migration prints a final status row for the payment column, five-argument RPC, legacy RPC privileges, and authenticated execution. After applying in an owner-approved environment, test via an authorized application test account:

1. Record a payment with one request UUID; retain its returned receipt ID.
2. Retry the identical bill, amount, method, reference, and request UUID; it must return the same receipt and must not add another row.
3. Reuse that UUID with a changed bill or detail; the call must fail.
4. Use a new UUID for a partial payment; it may succeed if balance remains.
5. Attempt concurrent payments whose sum exceeds the balance; the row lock should allow no overpayment.

Do not use a real payment integration or live financial record for this test.

## RLS verification

The final migration output reports whether RLS is enabled and policy counts for each of the 22 workflow/core relations. Counts alone do not prove policy correctness. Compare policies against the preflight output and test with separate authenticated accounts for each existing role, including:

- A patient can see only their mapped patient data and permitted linked clinical/billing records.
- A doctor can see only patients covered by an active assignment.
- Receptionist, lab technician, and pharmacist workflows are role-scoped.
- A non-admin cannot assign roles; a user cannot assign a privileged role to their own profile.
- Direct writes that are intended to use secured RPCs are denied by table policies.
- The legacy payment RPC cannot be executed by `authenticated`.

The owner must review existing policies before applying; this candidate adds restrictive policies but does not remove existing ones.

## Disposable fixture validation

The consolidated SQL was applied to a disposable local PostgreSQL 16 fixture with a representative baseline schema; it was not run against Supabase. Fixture checks passed for first application and all ten relation checks. A second application stopped before DDL because the workflow relations already existed. RLS checks showed a patient sees only the profile-linked patient row, a doctor sees only the assigned patient, and a patient cannot assign themselves the admin role. A mismatched encounter/patient pair was rejected by the composite foreign key. Payment checks confirmed identical retries return the same receipt, changed details using the same key fail, a valid partial payment succeeds, an over-balance payment fails, and two concurrent payments of 60 against a 100 balance cannot both succeed. The conditional revocation block was also tested with a fixture four-argument overload: authenticated and anon execution were removed while the five-argument RPC remained executable by authenticated. These fixture results are not evidence of live Supabase compatibility or production authorization.

## Failure and recovery

- The script is transactional. If a statement fails before `COMMIT`, inspect the SQL Editor error and verify the transaction rolled back before retrying. Do not manually run selected fragments.
- This candidate intentionally **does not support reapplication**: if a proposed workflow relation or guarded object already exists, it aborts rather than reusing or replacing it. If the editor disconnects around `COMMIT`, do not rerun it blindly. Run the preflight and final verification queries, inspect the catalog, and have the owner decide whether execution completed or the candidate needs reconciliation.
- Do not issue `DROP`, reset, or cleanup SQL to recover. Preserve all existing data and ask the database owner to reconcile any partially applied objects if the platform did not roll back.
- The migration uses explicit preflight checks to fail on relation, function, index, constraint, policy, and trigger name conflicts; this does not replace owner review of the definitions and dependencies of existing objects.

## Privileges, known schema facts, and blockers

Application code and PostgREST checks have confirmed some exposed field names, but owner-only catalog facts for the live database (SQL types, all keys/FKs, defaults, triggers, function owners/ACLs, and full RLS definitions) have not been returned in this workspace. The updated preflight is required to establish those facts. The consolidated SQL's compatibility assertions reflect the earlier implementation's explicit assumptions; they are not proof those assumptions match production.

Run the preflight as a database owner/catalog-authorized operator. Applying the candidate requires permission to alter the existing tables, create tables/indexes/constraints/functions/triggers, enable RLS, and grant/revoke privileges. Do not use the frontend anon key or an application admin role for DDL. No live migration has been run.

Staff provisioning remains disabled by default (`STAFF_PROVISIONING_ENABLED=false`) and is separate from role assignment. Do not enable it until the database and authorization prerequisites are owner-verified.
