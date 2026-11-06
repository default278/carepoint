-- Read-only inspection for the owner/administrator before the Carepoint workflow migration.
-- Run this first in the Supabase SQL Editor and retain the output for review.

SELECT
  c.table_name,
  c.column_name,
  c.data_type,
  c.udt_name,
  c.is_nullable,
  c.column_default
FROM information_schema.columns c
WHERE c.table_schema = 'public'
ORDER BY c.table_name, c.ordinal_position;

SELECT relation_name, to_regclass(format('public.%I', relation_name)) AS resolved_relation
FROM unnest(ARRAY[
  'admissions', 'ai_assessments', 'ai_differential_candidates',
  'ai_followup_answers', 'ai_followup_questions', 'ai_triage_flags',
  'ambulance_dispatches', 'ambulance_shifts', 'ambulances', 'audit_logs',
  'bed_assignments', 'beds', 'clinical_notes', 'departments',
  'payment_allocations'
]) AS relations(relation_name)
ORDER BY relation_name;

-- A null result means the relation is not present in the visible public catalog.
-- PostgREST PGRST205 alone only proves it is absent from the current schema cache.
SELECT relation_name, to_regclass(format('public.%I', relation_name)) AS resolved_relation
FROM unnest(ARRAY[
  'encounters', 'vital_signs', 'doctor_assignments', 'consultations', 'diagnoses',
  'lab_orders', 'lab_results', 'billing_payments', 'carepoint_stock_movements',
  'carepoint_notifications'
]) AS workflow_relations(relation_name)
ORDER BY relation_name;

SELECT
  source.relname AS table_name,
  constraint_row.conname AS constraint_name,
  constraint_row.contype AS constraint_type,
  pg_get_constraintdef(constraint_row.oid, true) AS definition,
  target.relname AS referenced_table
FROM pg_constraint constraint_row
JOIN pg_class source ON source.oid = constraint_row.conrelid
JOIN pg_namespace source_schema ON source_schema.oid = source.relnamespace
LEFT JOIN pg_class target ON target.oid = constraint_row.confrelid
WHERE source_schema.nspname = 'public'
ORDER BY source.relname, constraint_row.conname;

SELECT tablename AS table_name, indexname, indexdef
FROM pg_indexes
WHERE schemaname = 'public'
ORDER BY tablename, indexname;

SELECT id, name, description
FROM public.roles
ORDER BY name;

SELECT schemaname, tablename, policyname, permissive, roles, cmd, qual, with_check
FROM pg_policies
WHERE schemaname = 'public'
ORDER BY tablename, policyname;

SELECT
  c.relname AS table_name,
  c.relrowsecurity AS rls_enabled,
  c.relforcerowsecurity AS rls_forced
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname;

SELECT
  table_row.relname AS table_name,
  trigger_row.tgname AS trigger_name,
  trigger_row.tgenabled AS enabled_state,
  pg_get_triggerdef(trigger_row.oid, true) AS definition,
  function_row.oid::regprocedure AS trigger_function,
  function_owner.rolname AS function_owner,
  function_row.prosecdef AS security_definer,
  function_row.proconfig AS function_settings,
  function_row.proacl AS execution_acl
FROM pg_trigger trigger_row
JOIN pg_class table_row ON table_row.oid = trigger_row.tgrelid
JOIN pg_namespace table_schema ON table_schema.oid = table_row.relnamespace
JOIN pg_proc function_row ON function_row.oid = trigger_row.tgfoid
JOIN pg_roles function_owner ON function_owner.oid = function_row.proowner
WHERE table_schema.nspname = 'public'
  AND NOT trigger_row.tgisinternal
ORDER BY table_row.relname, trigger_row.tgname;

SELECT
  function_schema.nspname AS schema_name,
  function_row.proname AS function_name,
  pg_get_function_identity_arguments(function_row.oid) AS argument_signature,
  pg_get_function_result(function_row.oid) AS return_type,
  function_owner.rolname AS function_owner,
  function_row.prosecdef AS security_definer,
  function_row.provolatile AS volatility,
  function_row.proconfig AS function_settings,
  function_row.proacl AS execution_acl,
  CASE WHEN to_regrole('anon') IS NOT NULL
    THEN has_function_privilege('anon', function_row.oid, 'EXECUTE') END AS anon_can_execute,
  CASE WHEN to_regrole('authenticated') IS NOT NULL
    THEN has_function_privilege('authenticated', function_row.oid, 'EXECUTE') END AS authenticated_can_execute,
  pg_get_functiondef(function_row.oid) AS definition
FROM pg_proc function_row
JOIN pg_namespace function_schema ON function_schema.oid = function_row.pronamespace
JOIN pg_roles function_owner ON function_owner.oid = function_row.proowner
WHERE function_schema.nspname = 'public'
ORDER BY function_row.proname, argument_signature;

SELECT
  c.relname AS table_name,
  a.column_name,
  pg_get_userbyid(c.relowner) AS table_owner,
  acl.grantee,
  acl.privilege_type,
  acl.is_grantable
FROM pg_class c
JOIN pg_namespace n ON n.oid = c.relnamespace
JOIN information_schema.columns a
  ON a.table_schema = n.nspname AND a.table_name = c.relname
CROSS JOIN LATERAL aclexplode(COALESCE(c.relacl, acldefault('r', c.relowner))) acl
WHERE n.nspname = 'public'
  AND c.relkind IN ('r', 'p')
ORDER BY c.relname, acl.grantee, acl.privilege_type;

SELECT
  relation.relname AS table_name,
  index_row.relname AS index_name,
  pg_get_indexdef(index_row.oid) AS definition,
  i.indisprimary AS is_primary,
  i.indisunique AS is_unique,
  i.indisvalid AS is_valid
FROM pg_index i
JOIN pg_class relation ON relation.oid = i.indrelid
JOIN pg_namespace n ON n.oid = relation.relnamespace
JOIN pg_class index_row ON index_row.oid = i.indexrelid
WHERE n.nspname = 'public'
ORDER BY relation.relname, index_row.relname;
