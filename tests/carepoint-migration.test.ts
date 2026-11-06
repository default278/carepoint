import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import test from 'node:test';

const migrationPath = new URL('../supabase/migrations/carepoint_complete_migration.sql', import.meta.url);
const workflowPath = new URL('../supabase/migrations/20261105174500_carepoint_workflows.sql', import.meta.url);
const paymentPath = new URL('../supabase/migrations/20261105222000_carepoint_payment_idempotency.sql', import.meta.url);
const databaseServicesPath = new URL('../src/lib/db.ts', import.meta.url);
const migration = readFileSync(migrationPath, 'utf8');
const databaseServices = readFileSync(databaseServicesPath, 'utf8');

test('consolidated migration preserves the workflow API and candidate relations', () => {
  const historicalSql = `${readFileSync(workflowPath, 'utf8')}\n${readFileSync(paymentPath, 'utf8')}`;
  const historicalFunctions = [...historicalSql.matchAll(/CREATE (?:OR REPLACE )?FUNCTION public\.(carepoint_[a-z_]+)\(/g)]
    .map((match) => match[1]);
  const consolidatedFunctions = new Set(
    [...migration.matchAll(/CREATE FUNCTION public\.(carepoint_[a-z_]+)\(/g)]
      .map((match) => match[1]),
  );
  for (const functionName of historicalFunctions) {
    assert.ok(consolidatedFunctions.has(functionName), `Missing consolidated function ${functionName}`);
  }

  for (const relation of [
    'doctor_assignments',
    'encounters',
    'vital_signs',
    'consultations',
    'diagnoses',
    'lab_orders',
    'lab_results',
    'billing_payments',
    'carepoint_stock_movements',
    'carepoint_notifications',
  ]) {
    assert.match(migration, new RegExp(`public\\.${relation}\\b`));
  }
});

test('consolidated payment RPC keeps idempotency and does not restore the unsafe signature', () => {
  assert.match(migration, /idempotency_key uuid NOT NULL DEFAULT gen_random_uuid\(\)/);
  assert.match(migration, /CREATE UNIQUE INDEX billing_payments_idempotency_key_unique/);
  assert.match(migration, /pg_advisory_xact_lock\(hashtextextended\(request_key::text, 0\)\)/);
  assert.match(migration, /FOR UPDATE/);
  assert.match(migration, /existing_payment\.reference IS DISTINCT FROM normalized_reference/);
  assert.match(migration, /payment_amount > bill_total - amount_paid/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.carepoint_record_payment\(text, numeric, text, text, uuid\) FROM PUBLIC, anon/);
  assert.match(migration, /GRANT EXECUTE ON FUNCTION public\.carepoint_record_payment\(text, numeric, text, text, uuid\) TO authenticated/);
  assert.match(migration, /REVOKE ALL ON FUNCTION public\.carepoint_record_payment\(text,numeric,text,text\) FROM PUBLIC, anon, authenticated/);
  assert.doesNotMatch(migration, /GRANT EXECUTE ON FUNCTION public\.carepoint_record_payment\(text, numeric, text, text\) TO authenticated/);
  assert.doesNotMatch(migration, /CREATE FUNCTION public\.carepoint_record_payment\(target_bill text, payment_amount numeric, method_text text, reference_text text\)/);
});

test('consolidated migration is transactional, additive, and preserves existing role identifiers', () => {
  assert.match(migration, /\nBEGIN;\n/);
  assert.match(migration, /COMMIT;/);
  assert.match(migration, /COMMIT;\s*-- Refresh PostgREST after the committed schema changes\.\s*NOTIFY pgrst, 'reload schema';/);
  assert.doesNotMatch(migration, /^\s*(DROP TABLE|DROP SCHEMA|TRUNCATE|DELETE FROM)\b/im);
  assert.doesNotMatch(migration, /^\s*CREATE OR REPLACE FUNCTION\b/im);
  assert.match(migration, /proposed workflow relation\(s\) already exist/);
  assert.match(migration, /this migration will not replace them/);
  assert.doesNotMatch(migration, /USING \(true\)|WITH CHECK \(true\)/i);
  assert.doesNotMatch(migration, /'roles', 'true'/);
  for (const role of ['admin', 'receptionist', 'doctor', 'patient', 'lab_technician', 'pharmacist']) {
    assert.match(migration, new RegExp(`'${role}'`));
  }
  for (const forbiddenRole of ['super_admin', 'accountant', 'lab_specialist']) {
    assert.doesNotMatch(migration, new RegExp(`'${forbiddenRole}'`));
  }
});

test('services gate queries that depend on the workflow migration', () => {
  for (const serviceName of [
    'getPatients',
    'getMyDoctorId',
    'getMyPatient',
    'getLabOrders',
    'getLabResults',
  ]) {
    const start = databaseServices.indexOf(`function ${serviceName}(`);
    assert.notEqual(start, -1, `Missing database service ${serviceName}`);
    const nextService = databaseServices.indexOf('\nexport async function ', start + 1);
    const serviceBody = databaseServices.slice(start, nextService === -1 ? undefined : nextService);
    assert.match(serviceBody, /getClient\(true\)/, `${serviceName} must wait for the migration readiness check`);
  }
});
