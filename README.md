# Carepoint

Carepoint is a hospital management application scaffold built with React, TypeScript, Vite, and Supabase-ready authentication. It includes role-based navigation for administrators, reception staff, doctors, patients, lab technicians, and pharmacists.

## Stack

- React + TypeScript
- Vite frontend
- Express backend API
- Supabase client for auth and database access
- React Router for protected frontend routes
- Lucide icons for UI elements

## Environment setup

Copy the sample environment file and set your Supabase values:

```bash
cp -n .env.example .env
```

Then populate:

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-anon-key
# Backend only; never expose or prefix with VITE_.
SUPABASE_SERVICE_ROLE_KEY=your-server-only-service-role-key
# Must remain false until database and authorization prerequisites are verified.
STAFF_PROVISIONING_ENABLED=false
VITE_API_BASE_URL=http://localhost:4000
BACKEND_PORT=4000
VITE_FRONTEND_URL=http://localhost:5173
```

Do not commit real credentials. The project intentionally ignores `.env` files in Git.

## Run locally

From the Carepoint directory, run one command to start both services together:

```bash
npm run dev
```

This starts:

- Frontend: http://localhost:5173
- Backend: http://localhost:4000

The command uses `concurrently` so both processes stay in one terminal and log with `[FRONTEND]` and `[BACKEND]` prefixes.

## Backend health checks

The API exposes a health endpoint:

```bash
curl http://localhost:4000/api/health
```

## Production build

```bash
npm run build
```

## Tests

```bash
npm test
```

The tests cover role extraction, invitation authorization/validation and disabled provisioning, migration-content invariants, and the Express backend's ping, health-configuration error, and 404 responses. They do not replace authenticated workflow integration tests against the configured database.

## Live database alignment

The public Supabase key confirms the exposed field names but does not permit reading the SQL catalog or RLS policy definitions. See:

- [Live database schema report](./docs/live-database-schema-report.md)
- [Database schema reference and evidence classifications](./docs/DATABASE_SCHEMA_REFERENCE.md)
- [Database field mapping](./docs/database-field-mapping.md)
- [Consolidated migration runbook and manual SQL order](./docs/carepoint-migration-runbook.md)
- [Read-only owner schema preflight](./supabase/diagnostics/carepoint_schema_preflight.sql)
- [Consolidated migration candidate](./supabase/migrations/carepoint_complete_migration.sql)
- Historical migrations retained for reference: [workflow migration](./supabase/migrations/20261105174500_carepoint_workflows.sql) and [payment idempotency migration](./supabase/migrations/20261105222000_carepoint_payment_idempotency.sql).

The latest read-only health check found the existing core relations available and all ten workflow relations returning PostgREST `PGRST205`. That response means they are absent from the current PostgREST schema cache; it does not prove they are physically absent from PostgreSQL. [`carepoint_complete_migration.sql`](./supabase/migrations/carepoint_complete_migration.sql) is the **single authoritative migration candidate**; historical migrations are retained for reference and must not be executed separately. The candidate has **not** been reconciled with owner-verified live schema output or applied to production. Run and review the owner-only schema preflight before considering its use, and follow the [migration runbook](./docs/carepoint-migration-runbook.md) for the exact review and execution order. The candidate sends a PostgREST schema reload notification after commit and deliberately aborts if it finds an existing workflow relation or guarded object; it is not safe to rerun after success. Do not expose the optional `SUPABASE_SERVICE_ROLE_KEY` to frontend code; it is read only by the backend invitation endpoint. `STAFF_PROVISIONING_ENABLED` defaults to `false` and must remain false until database and authorization prerequisites are verified. Invitations do not assign a database role. Consolidated migration tests use a representative isolated local PostgreSQL fixture only; that is not proof of live schema compatibility.

## Available roles

- admin
- receptionist
- doctor
- patient
- lab_technician
- pharmacist

## Notes

This project remains separate from CampusGig. Reads and baseline writes use the live schema fields confirmed through PostgREST; unavailable schema-dependent workflows are explicitly surfaced instead of showing sample records or false success. Live clinical writes, patient-only access, administrator login, and production RLS verification require the owner-applied migration and an authorized test account; they have not been claimed as passed.
