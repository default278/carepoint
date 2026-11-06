import cors from 'cors';
import dotenv from 'dotenv';
import express from 'express';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createClient } from '@supabase/supabase-js';
import { createAdminInvitationsRouter } from './admin-invitations.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

dotenv.config({ path: path.resolve(__dirname, '../.env') });

export const app = express();
const port = Number(process.env.BACKEND_PORT ?? process.env.PORT ?? 4000);
const frontendOrigin = process.env.VITE_FRONTEND_URL ?? 'http://localhost:5173';
const supabaseUrl = (process.env.VITE_SUPABASE_URL ?? '').trim();
const supabaseAnonKey = (process.env.VITE_SUPABASE_ANON_KEY ?? '').trim();
const supabaseServiceRoleKey = (process.env.SUPABASE_SERVICE_ROLE_KEY ?? '').trim();
const staffProvisioningEnabled = process.env.STAFF_PROVISIONING_ENABLED === 'true';
let supabaseConfigError = null;
try {
  const parsedUrl = new URL(supabaseUrl);
  if (!['http:', 'https:'].includes(parsedUrl.protocol) || !parsedUrl.hostname || parsedUrl.username || parsedUrl.password) {
    supabaseConfigError = 'VITE_SUPABASE_URL must be a valid HTTP(S) project URL.';
  }
} catch {
  supabaseConfigError = 'VITE_SUPABASE_URL must be a valid HTTP(S) project URL.';
}
if (!supabaseUrl) supabaseConfigError = 'Missing VITE_SUPABASE_URL.';
if (!supabaseAnonKey) supabaseConfigError = 'Missing VITE_SUPABASE_ANON_KEY.';

const supabase = !supabaseConfigError
  ? createClient(supabaseUrl, supabaseAnonKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;
const adminSupabase = supabase && supabaseServiceRoleKey
  ? createClient(supabaseUrl, supabaseServiceRoleKey, {
      auth: {
        persistSession: false,
        autoRefreshToken: false,
      },
    })
  : null;

export function relationProbeResult(error) {
  if (!error) return { queryable: true, status: 'queryable' };
  return {
    queryable: false,
    status: error.code === 'PGRST205' ? 'not_in_schema_cache' : 'error',
    code: error.code ?? null,
    error: error.message,
  };
}

app.use(
  cors({
    origin: [frontendOrigin, 'http://127.0.0.1:5173', 'http://localhost:5173'],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  }),
);
app.use(express.json());
app.use((req, res, next) => {
  const startedAt = Date.now();
  res.on('finish', () => {
    console.log(`[BACKEND] ${req.method} ${req.path} ${res.statusCode} ${Date.now() - startedAt}ms`);
  });
  next();
});

app.get('/api/health', async (_req, res) => {
  const requiredRelations = {
    profiles: 'id',
    roles: 'id',
    user_roles: 'user_id',
    patients: 'patient_id',
    doctors: 'doctor_id',
    appointments: 'appointment_id',
    medical_records: 'record_id',
    lab_tests: 'test_id',
    medications: 'medication_id',
    prescriptions: 'prescription_id',
    prescription_medications: 'prescription_medication_id',
    billing: 'bill_id',
  };
  const workflowRelations = {
    encounters: 'encounter_id',
    vital_signs: 'vital_sign_id',
    doctor_assignments: 'assignment_id',
    consultations: 'consultation_id',
    diagnoses: 'diagnosis_id',
    lab_orders: 'lab_order_id',
    lab_results: 'lab_result_id',
    billing_payments: 'payment_id',
    carepoint_stock_movements: 'movement_id',
    carepoint_notifications: 'notification_id',
  };
  const payload = {
    ok: true,
    service: 'carepoint-api',
    timestamp: new Date().toISOString(),
    supabase: {
      configured: Boolean(supabaseUrl && supabaseAnonKey),
    },
  };

  if (!supabase) {
    return res.status(500).json({
      ...payload,
      ok: false,
      error: supabaseConfigError ?? 'Supabase client is unavailable.',
    });
  }

  try {
    const checkRelations = async (relations) => Object.fromEntries(await Promise.all(
      Object.entries(relations).map(async ([table, primaryKey]) => {
        const { error } = await supabase.from(table).select(primaryKey).limit(0);
        return [table, relationProbeResult(error)];
      }),
    ));

    const authResponse = await fetch(`${supabaseUrl.replace(/\/$/, '')}/auth/v1/health`, {
      headers: {
        apikey: supabaseAnonKey,
        Authorization: `Bearer ${supabaseAnonKey}`,
      },
    });
    const [requiredTables, workflowTables] = await Promise.all([
      checkRelations(requiredRelations),
      checkRelations(workflowRelations),
    ]);
    const unavailableRequired = Object.entries(requiredTables).filter(([, result]) => !result.queryable).map(([name]) => name);
    const unavailableWorkflow = Object.entries(workflowTables).filter(([, result]) => !result.queryable).map(([name]) => name);
    const ready = authResponse.ok && unavailableRequired.length === 0 && unavailableWorkflow.length === 0;
    payload.supabase = {
      configured: true,
      authClient: authResponse.ok
        ? { ok: true, status: authResponse.status }
        : { ok: false, status: authResponse.status },
      requiredTables,
      workflowTables,
      unavailableRequired,
      unavailableWorkflow,
    };
    return res.status(ready ? 200 : 503).json({
      ...payload,
      ok: ready,
      error: ready ? undefined : 'Supabase is reachable, but one or more required relations are not queryable by the configured public client.',
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unable to reach Supabase.';
    return res.status(500).json({
      ...payload,
      error: message,
    });
  }
});

app.get('/api/ping', (_req, res) => {
  res.json({ ok: true, message: 'Carepoint backend is running.' });
});

app.use('/api/admin/invitations', createAdminInvitationsRouter({
  enabled: staffProvisioningEnabled && Boolean(adminSupabase),
  getUserByAccessToken: async (accessToken) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const { data, error } = await supabase.auth.getUser(accessToken);
    if (error) return null;
    return data.user;
  },
  isAdmin: async (userId, accessToken) => {
    if (!supabase) throw new Error('Supabase is not configured.');
    const callerClient = createClient(supabaseUrl, supabaseAnonKey, {
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
      auth: { persistSession: false, autoRefreshToken: false },
    });
    const { data, error } = await callerClient
      .from('user_roles')
      .select('roles(name)')
      .eq('user_id', userId);
    if (error) throw new Error(`Unable to authorize invitation request: ${error.message}`);
    const roles = (data ?? []).flatMap((assignment) => {
      const role = assignment.roles;
      if (Array.isArray(role)) return role.map((item) => item?.name);
      return role?.name ? [role.name] : [];
    });
    return roles.length === 1 && roles[0] === 'admin';
  },
  inviteUser: async (email) => {
    if (!adminSupabase) throw new Error('Missing SUPABASE_SERVICE_ROLE_KEY.');
    const { data, error } = await adminSupabase.auth.admin.inviteUserByEmail(email);
    if (error) throw new Error(`Unable to send Supabase Auth invitation: ${error.message}`);
    if (!data.user) throw new Error('Supabase Auth did not return the invited user.');
    return data.user.id;
  },
}));

app.use((_req, res) => {
  res.status(404).json({ ok: false, error: 'Not found' });
});

if (process.env.NODE_ENV !== 'test') {
  const server = app.listen(port, '0.0.0.0', () => {
    console.log(`[BACKEND] Carepoint API listening on http://localhost:${port}`);
    console.log(`[BACKEND] Supabase configured: ${Boolean(supabase)}`);
    if (supabaseConfigError) console.error(`[BACKEND] Supabase configuration error: ${supabaseConfigError}`);
  });

  const shutdown = () => {
    server.close(() => {
      console.log('[BACKEND] Carepoint API stopped.');
      process.exit(0);
    });
  };

  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);
}
