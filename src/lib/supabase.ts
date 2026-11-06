import { createClient, type SupabaseClient } from '@supabase/supabase-js';
import type { SupabaseHealth, SupabaseRelationProbe } from '../types';

const supabaseUrl = (import.meta.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (import.meta.env.VITE_SUPABASE_ANON_KEY ?? '').trim();

export function getSupabaseConfigError(): string | null {
  if (!supabaseUrl) return 'Missing VITE_SUPABASE_URL in the environment.';
  if (!supabaseAnonKey) return 'Missing VITE_SUPABASE_ANON_KEY in the environment.';
  try {
    const url = new URL(supabaseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname || url.username || url.password) {
      return 'VITE_SUPABASE_URL must be a valid HTTP(S) project URL.';
    }
  } catch {
    return 'VITE_SUPABASE_URL must be a valid HTTP(S) project URL.';
  }
  return null;
}

export const isSupabaseConfigured = getSupabaseConfigError() === null;

export const supabase: SupabaseClient | null = isSupabaseConfigured
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: true,
        autoRefreshToken: true,
        detectSessionInUrl: true,
      },
    })
  : null;

export async function ensureSupabaseReady(): Promise<void> {
  const configError = getSupabaseConfigError();
  if (configError) {
    throw new Error(
      `${configError} Add the values to the project .env file and restart the application.`,
    );
  }

  if (!supabase) {
    throw new Error('Supabase client is unavailable. The project configuration did not initialize correctly.');
  }

  try {
    const healthUrl = `${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`;
    const response = await fetch(healthUrl, {
      method: 'GET',
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });

    if (!response.ok) {
      throw new Error(`Supabase health check failed with status ${response.status}.`);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown Supabase connectivity error.';
    throw new Error(`Supabase connectivity check failed: ${message}`);
  }
}

export async function checkSupabaseHealth(): Promise<SupabaseHealth> {
  const configError = getSupabaseConfigError();
  if (configError) {
    return {
      configured: false,
      error: configError,
      tables: {},
    };
  }

  await ensureSupabaseReady();

  const tables: Record<string, string> = {
    profiles: 'id',
    roles: 'id',
    user_roles: 'user_id',
    patients: 'patient_id',
    doctors: 'doctor_id',
    appointments: 'appointment_id',
    medical_records: 'record_id',
    encounters: 'encounter_id',
    vital_signs: 'vital_sign_id',
    doctor_assignments: 'assignment_id',
    consultations: 'consultation_id',
    diagnoses: 'diagnosis_id',
    lab_tests: 'test_id',
    lab_orders: 'lab_order_id',
    lab_results: 'lab_result_id',
    medications: 'medication_id',
    prescriptions: 'prescription_id',
    prescription_medications: 'prescription_medication_id',
    billing: 'bill_id',
    billing_payments: 'payment_id',
    carepoint_stock_movements: 'movement_id',
    carepoint_notifications: 'notification_id',
  };
  const health: Record<string, SupabaseRelationProbe> = Object.fromEntries(await Promise.all(
    Object.entries(tables).map(async ([table, primaryKey]) => {
      if (!supabase) {
        return [table, {
          queryable: false,
          status: 'error' as const,
          error: 'Supabase client is not initialized.',
        }];
      }

      const { error } = await supabase.from(table).select(primaryKey).limit(0);
      if (!error) return [table, { queryable: true, status: 'queryable' as const }];
      return [table, {
        queryable: false,
        status: error.code === 'PGRST205' ? 'not_in_schema_cache' as const : 'error' as const,
        code: error.code,
        error: error.message,
      }];
    }),
  ));

  return {
    configured: true,
    error: null,
    tables: health,
  };
}
