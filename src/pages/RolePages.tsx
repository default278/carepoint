import { useCallback, useEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { Plus, Search } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import {
  assignDoctor,
  assignRoleToProfile,
  createAppointment,
  createBillingRecord,
  createConsultation,
  createLabOrder,
  createMedicalRecord,
  createPatient,
  createPrescription,
  getAppointments,
  getBillingRecords,
  getBillingPayments,
  getDashboardData,
  getDoctors,
  getEncounters,
  getMedicationInventory,
  getMedicationStockMovements,
  getMyAppointments,
  getMyBillingRecords,
  getMyBillingPayments,
  getMyLabResults,
  getMyClinicalRecords,
  getMyMedicalRecords,
  getMyNotifications,
  getMyPatient,
  getMyPrescriptions,
  getLabOrders,
  getLabResults,
  getLabTests,
  getMedicalRecords,
  getMedications,
  getPatients,
  getPatientProfileMappings,
  getDoctorProfileMappings,
  getPrescriptionItems,
  getRoleOptions,
  getUsers,
  getStaffProvisioningStatus,
  inviteUserByEmail,
  markLabOrderInProgress,
  linkPatientProfile,
  linkDoctorProfile,
  recordBillingPayment,
  recordDiagnosis,
  recordTriage,
  requestMyAppointment,
  reviewLabResult,
  saveLabResult,
  dispensePrescriptionItem,
  setMedicationStock,
  updateAppointment,
  updateMyPatientProfile,
} from '../lib/db';
import { checkSupabaseHealth } from '../lib/supabase';
import type {
  Appointment,
  BillingRecord,
  Doctor,
  LabTest,
  MedicalRecord,
  Medication,
  Patient,
  UserRecord,
} from '../types';

function useRemote<T>(loader: () => Promise<T>) {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [revision, setRevision] = useState(0);

  const refresh = useCallback(() => {
    setLoading(true);
    setError(null);
    setRevision((value) => value + 1);
  }, []);

  useEffect(() => {
    let active = true;
    void loader()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((cause: unknown) => {
        if (active) setError(cause instanceof Error ? cause.message : 'The request failed.');
      })
      .finally(() => {
        if (active) setLoading(false);
      });

    return () => {
      active = false;
    };
  }, [loader, revision]);

  return { data, loading, error, refresh };
}

function PageHeader({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <div className="page-header">
      <div>
        <h1>{title}</h1>
        {subtitle && <p>{subtitle}</p>}
      </div>
    </div>
  );
}

function MetricCard({ label, value, hint }: { label: string; value: string | number; hint?: string }) {
  return (
    <div className="metric-card">
      <span>{label}</span>
      <strong>{value}</strong>
      {hint && <small>{hint}</small>}
    </div>
  );
}

function TableCard({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="panel">
      <div className="panel-header"><h2>{title}</h2></div>
      {children}
    </section>
  );
}

function StatusPill({ value }: { value: string }) {
  return <span className="status-pill">{value}</span>;
}

function formatKes(value: number | string) {
  return new Intl.NumberFormat('en-KE', { style: 'currency', currency: 'KES' }).format(Number(value));
}

function RequestState({ loading, error, empty }: { loading: boolean; error: string | null; empty?: string }) {
  if (loading) return <p className="empty-state">Loading records from Supabase…</p>;
  if (error) return <div className="alert error" role="alert">{error}</div>;
  if (empty) return <p className="empty-state">{empty}</p>;
  return null;
}

function DataTable({
  headers,
  rows,
  emptyMessage = 'No records returned by the database.',
}: {
  headers: string[];
  rows: (string | number | ReactNode)[][];
  emptyMessage?: string;
}) {
  return (
    <div className="table-wrap">
      <table>
        <thead><tr>{headers.map((header) => <th key={header}>{header}</th>)}</tr></thead>
        <tbody>
          {rows.length === 0
            ? <tr><td colSpan={headers.length}>{emptyMessage}</td></tr>
            : rows.map((row, index) => <tr key={String(row[0] ?? index)}>{row.map((cell, cellIndex) => <td key={cellIndex}>{cell}</td>)}</tr>)}
        </tbody>
      </table>
    </div>
  );
}

function Dashboard({ title, subtitle }: { title: string; subtitle: string }) {
  const { user } = useAuth();
  const role = user?.role ?? 'patient';
  const loadDashboard = useCallback(() => getDashboardData(role), [role]);
  const { data, loading, error } = useRemote(loadDashboard);
  return (
    <div className="page-shell">
      <PageHeader title={title} subtitle={subtitle} />
      {loading && <RequestState loading error={null} />}
      {error && <RequestState loading={false} error={error} />}
      {data && (
        <div className="metrics-grid">
          <MetricCard label="Patients" value={data.totalPatients} />
          <MetricCard label="Doctors" value={data.totalDoctors} />
          <MetricCard label="Appointments" value={data.totalAppointments} />
          <MetricCard label="Pending appointments" value={data.pendingAppointments} />
          {role === 'admin' && <MetricCard label="User profiles" value={data.totalUsers} />}
          {role === 'doctor' && <MetricCard label="Completed appointments" value={data.completedAppointments} />}
        </div>
      )}
      {!loading && !error && data && data.totalPatients + data.totalDoctors + data.totalAppointments === 0 && (
        <p className="empty-state">The permitted database queries returned no records.</p>
      )}
      <MyNotifications />
    </div>
  );
}

function MyNotifications() {
  const { data, loading, error } = useRemote(getMyNotifications);
  return (
    <TableCard title="Notifications">
      <RequestState loading={loading} error={error} />
      {!loading && !error && data && (
        <DataTable headers={['Received', 'Type', 'Patient', 'Message', 'Status']} rows={data.map((notification) => [
          notification.created_at,
          notification.event_type,
          notification.patients?.[0]?.name ?? '—',
          notification.message,
          notification.read_at ? 'Read' : 'Unread',
        ])} emptyMessage="No notifications have been delivered to this account." />
      )}
    </TableCard>
  );
}

function PatientTable({ loader }: { loader: () => Promise<Patient[]> }) {
  const { data, loading, error } = useRemote(loader);
  return (
    <>
      <RequestState loading={loading} error={error} />
      {!loading && !error && data && (
        <DataTable
          headers={['Patient ID', 'Patient', 'Address', 'Created']}
          rows={data.map((patient) => [patient.patient_id, patient.name, patient.address, patient.created_at ?? '—'])}
        />
      )}
    </>
  );
}

function DoctorTable({ loader }: { loader: () => Promise<Doctor[]> }) {
  const { data, loading, error } = useRemote(loader);
  return (
    <>
      <RequestState loading={loading} error={error} />
      {!loading && !error && data && (
        <DataTable headers={['Doctor ID', 'Doctor', 'Specialization', 'Created']} rows={data.map((doctor) => [
          doctor.doctor_id, doctor.name, doctor.specialization, doctor.created_at ?? '—',
        ])} />
      )}
    </>
  );
}

function AppointmentTable({ loader }: { loader: () => Promise<Appointment[]> }) {
  const { data, loading, error } = useRemote(loader);
  return (
    <>
      <RequestState loading={loading} error={error} />
      {!loading && !error && data && (
        <DataTable headers={['Appointment ID', 'Patient', 'Doctor', 'Date', 'Reason', 'Status']} rows={data.map((item) => [
          item.appointment_id,
          item.patients?.[0]?.name ?? item.patient_id,
          item.doctors?.[0]?.name ?? item.doctor_id,
          item.appointment_date,
          item.reason,
          <StatusPill key={item.appointment_id} value={item.status} />,
        ])} />
      )}
    </>
  );
}

function UnavailableWorkflow({ title, reason }: { title: string; reason: string }) {
  return (
    <div className="page-shell">
      <PageHeader title={title} />
      <div className="alert error" role="status">{reason}</div>
    </div>
  );
}

type WorkflowField = {
  name: string;
  label: string;
  type?: 'text' | 'email' | 'number' | 'date' | 'datetime-local' | 'textarea' | 'select' | 'checkbox';
  required?: boolean;
  min?: number;
  max?: number;
  step?: number;
  maxLength?: number;
  options?: { value: string; label: string }[];
};

function WorkflowForm({
  title,
  fields,
  submitLabel,
  onSubmit,
  onSuccess,
}: {
  title: string;
  fields: WorkflowField[];
  submitLabel: string;
  onSubmit: (values: Record<string, string>) => Promise<string | void>;
  onSuccess?: () => void;
}) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState<string | null>(null);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const formElement = event.currentTarget;
    setSaving(true);
    setError(null);
    setSuccess(null);
    try {
      const values = Object.fromEntries(
        Array.from(new FormData(formElement).entries(), ([key, value]) => [key, String(value)]),
      );
      const message = await onSubmit(values);
      formElement.reset();
      setSuccess(message ?? 'Saved to the database.');
      onSuccess?.();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : `${title} failed.`);
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="panel form-panel">
      <div className="panel-header"><h2>{title}</h2></div>
      <form className="form-grid" onSubmit={(event) => void submit(event)}>
        {fields.map((field) => (
          <label className="field" key={field.name}>
            <span>{field.label}</span>
            {field.type === 'textarea'
              ? <textarea name={field.name} required={field.required} maxLength={field.maxLength} rows={3} />
              : field.type === 'select'
                ? <select name={field.name} required={field.required} defaultValue="">
                    <option value="" disabled={field.required}>Select {field.label.toLowerCase()}</option>
                    {(field.options ?? []).map((option) => (
                      <option key={option.value} value={option.value}>{option.label}</option>
                    ))}
                  </select>
                : field.type === 'checkbox'
                  ? <input name={field.name} type="checkbox" />
                : <input
                    name={field.name}
                    type={field.type ?? 'text'}
                    required={field.required}
                    min={field.min}
                    max={field.max}
                    step={field.step}
                    maxLength={field.maxLength}
                  />}
          </label>
        ))}
        {error && <div className="alert error" role="alert">{error}</div>}
        {success && <div className="alert success" role="status">{success}</div>}
        <button className="primary-button" type="submit" disabled={saving}>
          {saving ? 'Saving…' : submitLabel}
        </button>
      </form>
    </section>
  );
}

export function AdminDashboardPage() {
  return <Dashboard title="Admin dashboard" subtitle="Counts from permitted Supabase queries" />;
}

export function AdminUsersPage() {
  const { data, loading, error } = useRemote(getUsers);
  const [search, setSearch] = useState('');
  const normalizedSearch = search.trim().toLowerCase();
  const filteredUsers = (data ?? []).filter((user) => [
    user.id,
    user.full_name,
    user.phone,
    user.role,
  ].some((value) => value?.toLowerCase().includes(normalizedSearch)));

  return (
    <div className="page-shell">
      <PageHeader title="User management" subtitle="Profiles and assigned database roles" />
      <div className="toolbar-row">
        <div className="search-box"><Search size={15} /><input
          aria-label="Search users"
          placeholder="Search users"
          value={search}
          onChange={(event) => setSearch(event.target.value)}
        /></div>
        <Link to="/admin/users/create" className="primary-button inline-button"><Plus size={16} /> Assign role</Link>
      </div>
      <TableCard title="Registered users">
        <RequestState loading={loading} error={error} />
        {!loading && !error && data && (
          <DataTable headers={['User ID', 'Name', 'Phone', 'Role', 'Created']} emptyMessage="No users match this search." rows={filteredUsers.map((user: UserRecord) => [
            user.id, user.full_name, user.phone ?? '—', user.role, user.created_at ?? '—',
          ])} />
        )}
      </TableCard>
    </div>
  );
}

export function CreateUserPage() {
  const { user: signedInUser } = useAuth();
  const users = useRemote(getUsers);
  const roles = useRemote(getRoleOptions);
  const provisioning = useRemote(getStaffProvisioningStatus);
  const loadError = users.error ?? roles.error;
  const loading = users.loading || roles.loading;
  return (
    <div className="page-shell">
      <PageHeader title="Assign a role" subtitle="Role changes are written to user_roles and authorized by database RLS" />
      {provisioning.loading && <RequestState loading error={null} />}
      {provisioning.error && <div className="alert error" role="alert">Could not verify the server provisioning gate; invitations remain unavailable. {provisioning.error}</div>}
      {!provisioning.loading && !provisioning.error && provisioning.data?.enabled && (
        <>
          <div className="alert" role="note">
            Invitations use the protected backend and do not grant a hospital role. Assign a role below after the invited account profile is available.
          </div>
          <WorkflowForm
            title="Invite a user"
            submitLabel="Send invitation"
            fields={[
              { name: 'email', label: 'Email address', type: 'email', required: true, maxLength: 254 },
            ]}
            onSubmit={async (values) => inviteUserByEmail(values.email)}
          />
        </>
      )}
      {!provisioning.loading && !provisioning.error && !provisioning.data?.enabled && (
        <div className="alert" role="note">
          {provisioning.data?.reason ?? 'Staff invitations are disabled until database and authorization prerequisites are verified.'}
        </div>
      )}
      {loading && <RequestState loading error={null} />}
      {loadError && <RequestState loading={false} error={loadError} />}
      {!loading && !loadError && (
        <WorkflowForm
          title="Role assignment"
          submitLabel="Assign role"
          onSuccess={users.refresh}
          fields={[
            {
              name: 'user_id',
              label: 'Existing profile',
              type: 'select',
              required: true,
              options: (users.data ?? []).filter((profile) => profile.id !== signedInUser?.id).map((user) => ({
                value: user.id,
                label: `${user.full_name || 'Unnamed profile'} — ${user.id}`,
              })),
            },
            {
              name: 'role_id',
              label: 'Database role',
              type: 'select',
              required: true,
              options: (roles.data ?? []).map((role) => ({
                value: role.id,
                label: `${role.name}${role.description ? ` — ${role.description}` : ''}`,
              })),
            },
          ]}
          onSubmit={async (values) => {
            await assignRoleToProfile({ user_id: values.user_id, role_id: values.role_id });
            return 'Role assignment saved.';
          }}
        />
      )}
      {!loading && !loadError && (!users.data?.length || !roles.data?.length) && (
        <p className="empty-state">An existing profile and supported database role are required.</p>
      )}
    </div>
  );
}

export function AdminPatientsPage() {
  const mappings = useRemote(getPatientProfileMappings);
  const users = useRemote(getUsers);
  const error = mappings.error ?? users.error;
  const loading = mappings.loading || users.loading;
  const patientProfiles = (users.data ?? []).filter((profile) => profile.role.split(', ').includes('patient'));
  return (
    <div className="page-shell">
      <PageHeader title="Patient management" subtitle="Link verified patient-role profiles to patient records after migration application" />
      {loading && <RequestState loading error={null} />}
      {error && <RequestState loading={false} error={error} />}
      {!loading && !error && (
        <WorkflowForm
          title="Link patient account"
          submitLabel="Save account link"
          onSuccess={mappings.refresh}
          fields={[
            { name: 'patient_id', label: 'Patient record', type: 'select', required: true, options: (mappings.data ?? []).map((patient) => ({ value: patient.patient_id, label: patient.name })) },
            { name: 'profile_id', label: 'Patient-role profile (blank to unlink)', type: 'select', options: patientProfiles.map((profile) => ({ value: profile.id, label: `${profile.full_name || 'Unnamed profile'} — ${profile.id}` })) },
          ]}
          onSubmit={async (values) => {
            await linkPatientProfile(values.patient_id, values.profile_id);
            return 'Patient account link saved.';
          }}
        />
      )}
      {!loading && !error && !patientProfiles.length && (
        <p className="empty-state">Assign the patient role to an existing profile before linking it to a patient record.</p>
      )}
      <TableCard title="Patient account links">
        <RequestState loading={mappings.loading} error={mappings.error} />
        {!mappings.loading && !mappings.error && mappings.data && (
          <DataTable headers={['Patient ID', 'Patient', 'Profile ID']} rows={mappings.data.map((patient) => [
            patient.patient_id, patient.name, patient.profile_id ?? 'Not linked',
          ])} />
        )}
      </TableCard>
      <TableCard title="Patients"><PatientTable loader={getPatients} /></TableCard>
    </div>
  );
}

export function AdminDoctorsPage() {
  const mappings = useRemote(getDoctorProfileMappings);
  const users = useRemote(getUsers);
  const error = mappings.error ?? users.error;
  const loading = mappings.loading || users.loading;
  const doctorProfiles = (users.data ?? []).filter((profile) => profile.role.split(', ').includes('doctor'));
  return (
    <div className="page-shell">
      <PageHeader title="Doctor management" subtitle="Link verified doctor-role profiles to doctor records after migration application" />
      {loading && <RequestState loading error={null} />}
      {error && <RequestState loading={false} error={error} />}
      {!loading && !error && (
        <WorkflowForm
          title="Link doctor account"
          submitLabel="Save account link"
          onSuccess={mappings.refresh}
          fields={[
            { name: 'doctor_id', label: 'Doctor record', type: 'select', required: true, options: (mappings.data ?? []).map((doctor) => ({ value: doctor.doctor_id, label: doctor.name })) },
            { name: 'profile_id', label: 'Doctor-role profile (blank to unlink)', type: 'select', options: doctorProfiles.map((profile) => ({ value: profile.id, label: `${profile.full_name || 'Unnamed profile'} — ${profile.id}` })) },
          ]}
          onSubmit={async (values) => {
            await linkDoctorProfile(values.doctor_id, values.profile_id);
            return 'Doctor account link saved.';
          }}
        />
      )}
      {!loading && !error && !doctorProfiles.length && (
        <p className="empty-state">Assign the doctor role to an existing profile before linking it to a doctor record.</p>
      )}
      <TableCard title="Doctor account links">
        <RequestState loading={mappings.loading} error={mappings.error} />
        {!mappings.loading && !mappings.error && mappings.data && (
          <DataTable headers={['Doctor ID', 'Doctor', 'Profile ID']} rows={mappings.data.map((doctor) => [
            doctor.doctor_id, doctor.name, doctor.profile_id ?? 'Not linked',
          ])} />
        )}
      </TableCard>
      <TableCard title="Doctors"><DoctorTable loader={getDoctors} /></TableCard>
    </div>
  );
}

export function AdminDoctorAssignmentsPage() {
  const patients = useRemote(getPatients);
  const doctors = useRemote(getDoctors);
  const error = patients.error ?? doctors.error;
  return (
    <div className="page-shell">
      <PageHeader title="Doctor assignments" subtitle="Assign a doctor to a patient using an authenticated database write" />
      {error && <RequestState loading={false} error={error} />}
      {(patients.loading || doctors.loading) && <RequestState loading error={null} />}
      {!patients.loading && !doctors.loading && !error && (
        <WorkflowForm
          title="New assignment"
          submitLabel="Assign doctor"
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'select', required: true, options: (patients.data ?? []).map((p) => ({ value: p.patient_id, label: p.name })) },
            { name: 'doctor_id', label: 'Doctor', type: 'select', required: true, options: (doctors.data ?? []).map((d) => ({ value: d.doctor_id, label: `${d.name} — ${d.specialization}` })) },
          ]}
          onSubmit={async (values) => {
            await assignDoctor({ patient_id: values.patient_id, doctor_id: values.doctor_id });
            return 'Doctor assignment saved.';
          }}
        />
      )}
      {!patients.loading && !doctors.loading && !error && (!patients.data?.length || !doctors.data?.length) && (
        <p className="empty-state">A patient and a doctor must be available before creating an assignment.</p>
      )}
    </div>
  );
}

export function AdminAppointmentsPage() {
  const appointments = useRemote(getAppointments);
  return (
    <div className="page-shell">
      <PageHeader title="Appointment management" subtitle="Appointments visible under the current RLS policies" />
      <TableCard title="Appointments">
        <RequestState loading={appointments.loading} error={appointments.error} />
        {!appointments.loading && !appointments.error && appointments.data && (
          <AppointmentManagementTable rows={appointments.data} onChange={appointments.refresh} />
        )}
      </TableCard>
    </div>
  );
}

export function AdminSettingsPage() {
  const { data, loading, error } = useRemote(checkSupabaseHealth);
  return (
    <div className="page-shell">
      <PageHeader title="System settings" subtitle="Supabase connection and PostgREST queryability checks" />
      <section className="panel form-panel">
        <RequestState loading={loading} error={error} />
        {data && (
          <div className="settings-list">
            <div><b>Supabase</b><p>{data.configured ? 'Configured; health check succeeded' : data.error}</p></div>
            {Object.entries(data.tables).map(([table, result]) => (
              <div key={table}>
                <b>{table}</b>
                <p>{result.status === 'queryable'
                  ? 'Queryable with the current public client'
                  : result.status === 'not_in_schema_cache'
                    ? `Not found in the current PostgREST schema cache${result.code ? ` (${result.code})` : ''}; physical presence is unverified.`
                    : result.error}</p>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}

export function ReceptionDashboardPage() {
  return <Dashboard title="Reception dashboard" subtitle="Current patient and appointment counts" />;
}

export function ReceptionPatientsPage() {
  const { data, loading, error, refresh } = useRemote(getPatients);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await createPatient({
        name: String(form.get('name') ?? ''),
        address: String(form.get('address') ?? ''),
      });
      event.currentTarget.reset();
      refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Patient registration failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader title="Patient registration" subtitle="Only fields confirmed in the live patients table are submitted" />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Patient name</span><input name="name" required maxLength={200} /></label>
          <label className="field wide"><span>Address</span><textarea name="address" required maxLength={1000} rows={3} /></label>
          {formError && <div className="alert error" role="alert">{formError}</div>}
          <button className="primary-button" type="submit" disabled={saving}>{saving ? 'Saving…' : 'Register patient'}</button>
        </form>
      </section>
      <TableCard title="Patients">
        <RequestState loading={loading} error={error} />
        {!loading && !error && data &&         <DataTable headers={['Patient ID', 'Patient', 'Address', 'Created']} rows={data.map((patient) => [
          patient.patient_id, patient.name, patient.address, patient.created_at ?? '—',
        ])} />}
      </TableCard>
    </div>
  );
}

export function ReceptionAppointmentsPage() {
  const patients = useRemote(getPatients);
  const doctors = useRemote(getDoctors);
  const appointments = useRemote(getAppointments);
  const [search, setSearch] = useState('');
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await createAppointment({
        patient_id: String(form.get('patient_id') ?? ''),
        doctor_id: String(form.get('doctor_id') ?? ''),
        appointment_date: String(form.get('appointment_date') ?? ''),
        reason: String(form.get('reason') ?? ''),
      });
      event.currentTarget.reset();
      appointments.refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Appointment request failed.');
    } finally {
      setSaving(false);
    }
  };

  const loadError = patients.error ?? doctors.error;
  const loading = patients.loading || doctors.loading;
  return (
    <div className="page-shell">
      <PageHeader title="Appointment list" subtitle="Create and reschedule appointments using the existing database relation" />
      <section className="panel form-panel">
        {loading && <RequestState loading error={null} />}
        {loadError && <RequestState loading={false} error={loadError} />}
        {!loading && !loadError && (
          <form className="form-grid" onSubmit={(event) => void submit(event)}>
            <label className="field"><span>Patient</span><select name="patient_id" required defaultValue="">
              <option value="" disabled>Select patient</option>
              {(patients.data ?? []).map((patient) => <option key={patient.patient_id} value={patient.patient_id}>{patient.name}</option>)}
            </select></label>
            <label className="field"><span>Doctor</span><select name="doctor_id" required defaultValue="">
              <option value="" disabled>Select doctor</option>
              {(doctors.data ?? []).map((doctor) => <option key={doctor.doctor_id} value={doctor.doctor_id}>{doctor.name} — {doctor.specialization}</option>)}
            </select></label>
            <label className="field"><span>Appointment date</span><input type="date" name="appointment_date" required /></label>
            <label className="field wide"><span>Reason</span><textarea name="reason" required maxLength={1000} rows={3} /></label>
            {formError && <div className="alert error" role="alert">{formError}</div>}
            <button className="primary-button" type="submit" disabled={saving || !patients.data?.length || !doctors.data?.length}>
              {saving ? 'Saving…' : 'Book appointment'}
            </button>
          </form>
        )}
        {!loading && !loadError && (!patients.data?.length || !doctors.data?.length) && (
          <p className="empty-state">A patient and a doctor must exist before an appointment can be booked.</p>
        )}
      </section>
      <TableCard title="Appointments">
        <div className="toolbar-row">
          <div className="search-box"><Search size={15} /><input
            aria-label="Search appointments"
            placeholder="Search patient, doctor, reason, or status"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
          /></div>
        </div>
        <RequestState loading={appointments.loading} error={appointments.error} />
        {!appointments.loading && !appointments.error && appointments.data && (
          <AppointmentManagementTable
            rows={appointments.data.filter((item) => [
              item.appointment_id,
              item.patients?.[0]?.name,
              item.doctors?.[0]?.name,
              item.reason,
              item.status,
            ].some((value) => value?.toLowerCase().includes(search.trim().toLowerCase())))}
            onChange={appointments.refresh}
          />
        )}
      </TableCard>
    </div>
  );
}

export function ReceptionTriagePage() {
  const patients = useRemote(getPatients);
  const doctors = useRemote(getDoctors);
  const appointments = useRemote(getAppointments);
  const loading = patients.loading || doctors.loading || appointments.loading;
  const loadError = patients.error ?? doctors.error ?? appointments.error;
  return (
    <div className="page-shell">
      <PageHeader title="Triage and vital signs" subtitle="A triage submission creates an encounter and its vital-sign record transactionally" />
      {loading && <RequestState loading error={null} />}
      {loadError && <RequestState loading={false} error={loadError} />}
      {!loading && !loadError && (
        <WorkflowForm
          title="Record triage"
          submitLabel="Save triage"
          onSuccess={appointments.refresh}
          fields={[
            { name: 'patient_id', label: 'Patient', type: 'select', required: true, options: (patients.data ?? []).map((p) => ({ value: p.patient_id, label: p.name })) },
            { name: 'doctor_id', label: 'Assign doctor', type: 'select', required: true, options: (doctors.data ?? []).map((d) => ({ value: d.doctor_id, label: `${d.name} — ${d.specialization}` })) },
            { name: 'appointment_id', label: 'Scheduled appointment (optional)', type: 'select', options: (appointments.data ?? []).map((appointment) => ({
              value: appointment.appointment_id,
              label: `${appointment.patients?.[0]?.name ?? appointment.patient_id} · ${appointment.appointment_date} · ${appointment.status}`,
            })) },
            { name: 'systolic_bp', label: 'Systolic blood pressure (mmHg)', type: 'number', min: 1, max: 400 },
            { name: 'diastolic_bp', label: 'Diastolic blood pressure (mmHg)', type: 'number', min: 1, max: 300 },
            { name: 'heart_rate', label: 'Heart rate (bpm)', type: 'number', min: 1, max: 300 },
            { name: 'temperature_c', label: 'Temperature (°C)', type: 'number', min: 25, max: 45, step: 0.1 },
            { name: 'respiratory_rate', label: 'Respiratory rate (/min)', type: 'number', min: 1, max: 100 },
            { name: 'oxygen_saturation', label: 'Oxygen saturation (%)', type: 'number', min: 0, max: 100, step: 0.1 },
            { name: 'weight_kg', label: 'Weight (kg)', type: 'number', min: 0, max: 1000, step: 0.1 },
            { name: 'height_cm', label: 'Height (cm)', type: 'number', min: 0, max: 300, step: 0.1 },
            { name: 'notes', label: 'Triage notes', type: 'textarea', maxLength: 2000 },
          ]}
          onSubmit={async (values) => {
            const encounterId = await recordTriage({
              patient_id: values.patient_id,
              doctor_id: values.doctor_id,
              appointment_id: values.appointment_id,
              systolic_bp: values.systolic_bp ? Number(values.systolic_bp) : undefined,
              diastolic_bp: values.diastolic_bp ? Number(values.diastolic_bp) : undefined,
              heart_rate: values.heart_rate ? Number(values.heart_rate) : undefined,
              temperature_c: values.temperature_c ? Number(values.temperature_c) : undefined,
              respiratory_rate: values.respiratory_rate ? Number(values.respiratory_rate) : undefined,
              oxygen_saturation: values.oxygen_saturation ? Number(values.oxygen_saturation) : undefined,
              weight_kg: values.weight_kg ? Number(values.weight_kg) : undefined,
              height_cm: values.height_cm ? Number(values.height_cm) : undefined,
              notes: values.notes,
            });
            return `Triage and encounter saved. Encounter ID: ${encounterId}`;
          }}
        />
      )}
    </div>
  );
}

function AppointmentTableRows({ rows }: { rows: Appointment[] }) {
  return <DataTable headers={['Appointment ID', 'Patient', 'Doctor', 'Date', 'Reason', 'Status']} rows={rows.map((item) => [
    item.appointment_id,
    item.patients?.[0]?.name ?? item.patient_id,
    item.doctors?.[0]?.name ?? item.doctor_id,
    item.appointment_date,
    item.reason,
    <StatusPill key={item.appointment_id} value={item.status} />,
  ])} />;
}

function AppointmentManagementTable({ rows, onChange }: { rows: Appointment[]; onChange: () => void }) {
  return (
    <DataTable
      headers={['Appointment ID', 'Patient', 'Doctor', 'Date', 'Reason', 'Status', 'Actions']}
      emptyMessage="No appointments match the current view."
      rows={rows.map((item) => [
        item.appointment_id,
        item.patients?.[0]?.name ?? item.patient_id,
        item.doctors?.[0]?.name ?? item.doctor_id,
        item.appointment_date,
        item.reason,
        <StatusPill key={`${item.appointment_id}-status`} value={item.status} />,
        <AppointmentActions key={item.appointment_id} appointment={item} onChange={onChange} />,
      ])}
    />
  );
}

function AppointmentActions({ appointment, onChange }: { appointment: Appointment; onChange: () => void }) {
  const initialDate = new Date(appointment.appointment_date);
  const [date, setDate] = useState(Number.isNaN(initialDate.getTime()) ? '' : initialDate.toISOString().slice(0, 16));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);

  const reschedule = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const newDate = new Date(date);
      if (!date || Number.isNaN(newDate.getTime())) throw new Error('Choose a valid appointment date and time.');
      await updateAppointment({
        appointment_id: appointment.appointment_id,
        appointment_date: newDate.toISOString(),
      });
      setMessage('Rescheduled.');
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Appointment rescheduling failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="appointment-actions">
      <form className="inline-form" onSubmit={(event) => void reschedule(event)}>
        <label className="field">
          <span className="sr-only">New appointment date and time</span>
          <input
            aria-label="New appointment date and time"
            type="datetime-local"
            value={date}
            onChange={(event) => setDate(event.target.value)}
            required
          />
        </label>
        <button className="secondary-button" type="submit" disabled={saving}>Reschedule</button>
      </form>
      {error && <span className="action-error" role="alert">{error}</span>}
      {message && <span className="action-success" role="status">{message}</span>}
    </div>
  );
}

export function DoctorDashboardPage() {
  return <Dashboard title="Doctor dashboard" subtitle="Counts are restricted by the active database policies" />;
}

export function DoctorAppointmentsPage() {
  return (
    <div className="page-shell">
      <PageHeader title="My appointments" subtitle="Appointments visible to the authenticated doctor" />
      <TableCard title="Visits"><AppointmentTable loader={getAppointments} /></TableCard>
    </div>
  );
}

export function DoctorPatientsPage() {
  return (
    <div className="page-shell">
      <PageHeader title="My patients" subtitle="Patients visible to the authenticated doctor" />
      <TableCard title="Patients"><PatientTable loader={getPatients} /></TableCard>
    </div>
  );
}

export function DoctorRecordsPage() {
  const patients = useRemote(getPatients);
  const doctors = useRemote(getDoctors);
  const records = useRemote(getMedicalRecords);
  const [formError, setFormError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    setFormError(null);
    setSaving(true);
    const form = new FormData(event.currentTarget);
    try {
      await createMedicalRecord({
        patient_id: String(form.get('patient_id') ?? ''),
        doctor_id: String(form.get('doctor_id') ?? ''),
        diagnosis: String(form.get('diagnosis') ?? ''),
        notes: String(form.get('notes') ?? ''),
        treatment_plan: String(form.get('treatment_plan') ?? ''),
      });
      event.currentTarget.reset();
      records.refresh();
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Medical record save failed.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-shell">
      <PageHeader title="Medical records" subtitle="Diagnosis and treatment plan fields map to medical_records" />
      <section className="panel form-panel">
        <form className="form-grid" onSubmit={(event) => void submit(event)}>
          <label className="field"><span>Patient</span><select name="patient_id" required defaultValue="">
            <option value="" disabled>Select patient</option>
            {(patients.data ?? []).map((patient) => <option key={patient.patient_id} value={patient.patient_id}>{patient.name}</option>)}
          </select></label>
          <label className="field"><span>Doctor</span><select name="doctor_id" required defaultValue="">
            <option value="" disabled>Select doctor</option>
            {(doctors.data ?? []).map((doctor) => <option key={doctor.doctor_id} value={doctor.doctor_id}>{doctor.name}</option>)}
          </select></label>
          <label className="field"><span>Diagnosis</span><input name="diagnosis" required maxLength={1000} /></label>
          <label className="field wide"><span>Clinical notes</span><textarea name="notes" maxLength={5000} rows={4} /></label>
          <label className="field wide"><span>Treatment plan</span><textarea name="treatment_plan" maxLength={5000} rows={4} /></label>
          {(patients.error || doctors.error || formError) && <div className="alert error" role="alert">{patients.error ?? doctors.error ?? formError}</div>}
          <button className="primary-button" type="submit" disabled={saving || patients.loading || doctors.loading}>{saving ? 'Saving…' : 'Save record'}</button>
        </form>
      </section>
      <TableCard title="Medical records">
        <RequestState loading={records.loading} error={records.error} />
        {!records.loading && !records.error && records.data && <DataTable headers={['Record', 'Patient', 'Doctor', 'Diagnosis', 'Created']} rows={records.data.map((record: MedicalRecord) => [
          record.record_id, record.patient_id, record.doctor_id, record.diagnosis, record.created_at ?? '—',
        ])} />}
      </TableCard>
    </div>
  );
}

export function DoctorConsultationsPage() {
  const encounters = useRemote(getEncounters);
  return (
    <div className="page-shell">
      <PageHeader title="Consultations and diagnoses" subtitle="Clinical entries are linked to an encounter, patient, and assigned doctor" />
      <RequestState loading={encounters.loading} error={encounters.error} />
      {!encounters.loading && !encounters.error && (
        <>
          <WorkflowForm
            title="Consultation"
            submitLabel="Save consultation"
            fields={[
              { name: 'encounter_id', label: 'Open encounter', type: 'select', required: true, options: (encounters.data ?? []).filter((item) => item.status !== 'completed').map((item) => ({
                value: item.encounter_id,
                label: `${item.patients?.[0]?.name ?? item.patient_id} · ${new Date(item.started_at).toLocaleString()}`,
              })) },
              { name: 'chief_complaint', label: 'Chief complaint', type: 'textarea', required: true, maxLength: 2000 },
              { name: 'clinical_notes', label: 'Clinical notes', type: 'textarea', maxLength: 5000 },
              { name: 'treatment_plan', label: 'Treatment plan', type: 'textarea', maxLength: 5000 },
            ]}
            onSuccess={encounters.refresh}
            onSubmit={async (values) => {
              const consultationId = await createConsultation({
                encounter_id: values.encounter_id,
                chief_complaint: values.chief_complaint,
                clinical_notes: values.clinical_notes,
                treatment_plan: values.treatment_plan,
              });
              return `Consultation saved. Record ID: ${consultationId}`;
            }}
          />
          <WorkflowForm
            title="Diagnosis"
            submitLabel="Save diagnosis"
            fields={[
              { name: 'encounter_id', label: 'Encounter', type: 'select', required: true, options: (encounters.data ?? []).filter((item) => item.doctor_id).map((item) => ({
                value: item.encounter_id,
                label: `${item.patients?.[0]?.name ?? item.patient_id} · ${new Date(item.started_at).toLocaleString()}`,
              })) },
              { name: 'code', label: 'Diagnosis code' },
              { name: 'description', label: 'Diagnosis', type: 'textarea', required: true, maxLength: 2000 },
              { name: 'is_primary', label: 'Primary diagnosis', type: 'checkbox' },
            ]}
            onSubmit={async (values) => {
              await recordDiagnosis({
                encounter_id: values.encounter_id,
                code: values.code,
                description: values.description,
                is_primary: values.is_primary === 'on',
              });
              return 'Diagnosis saved.';
            }}
          />
          <DoctorLabResultsReview />
        </>
      )}
    </div>
  );
}

function DoctorLabResultsReview() {
  const results = useRemote(getLabResults);
  return (
    <TableCard title="Review laboratory results">
      <RequestState loading={results.loading} error={results.error} />
      {!results.loading && !results.error && results.data && (
        <DataTable headers={['Result', 'Patient', 'Test', 'Value', 'Status', 'Review']} rows={results.data.map((result) => [
          result.lab_result_id,
          result.lab_orders?.[0]?.patients?.[0]?.name ?? result.lab_orders?.[0]?.patient_id ?? '—',
          result.lab_orders?.[0]?.lab_tests?.[0]?.name ?? '—',
          `${result.result_value ?? ''} ${result.units ?? ''}`.trim(),
          <StatusPill key={result.lab_result_id} value={result.status} />,
          <WorkflowForm
            key={result.lab_result_id}
            title="Review"
            submitLabel="Save review"
            onSuccess={results.refresh}
            fields={[{
              name: 'decision',
              label: 'Decision',
              type: 'select',
              required: true,
              options: [{ value: 'approved', label: 'Approve and publish' }, { value: 'rejected', label: 'Reject' }],
            }]}
            onSubmit={async (values) => {
              await reviewLabResult(result.lab_result_id, values.decision as 'approved' | 'rejected');
              return values.decision === 'approved' ? 'Result approved and published.' : 'Result rejected.';
            }}
          />,
        ])} />
      )}
    </TableCard>
  );
}

export function DoctorLabOrdersPage() {
  const encounters = useRemote(getEncounters);
  const tests = useRemote(getLabTests);
  const loadError = encounters.error ?? tests.error;
  const loading = encounters.loading || tests.loading;
  return (
    <div className="page-shell">
      <PageHeader title="Laboratory requests" subtitle="Place an encounter-linked request for a catalog test" />
      {loading && <RequestState loading error={null} />}
      {loadError && <RequestState loading={false} error={loadError} />}
      {!loading && !loadError && (
        <WorkflowForm
          title="New laboratory order"
          submitLabel="Place order"
          fields={[
            { name: 'encounter_id', label: 'Encounter', type: 'select', required: true, options: (encounters.data ?? []).filter((item) => item.doctor_id).map((item) => ({
              value: item.encounter_id,
              label: `${item.patients?.[0]?.name ?? item.patient_id} · ${new Date(item.started_at).toLocaleString()}`,
            })) },
            { name: 'test_id', label: 'Test', type: 'select', required: true, options: (tests.data ?? []).map((t) => ({ value: t.test_id, label: t.name })) },
            { name: 'priority', label: 'Priority', type: 'select', required: true, options: [{ value: 'routine', label: 'Routine' }, { value: 'urgent', label: 'Urgent' }] },
            { name: 'instructions', label: 'Instructions', type: 'textarea', maxLength: 2000 },
          ]}
          onSubmit={async (values) => {
            const orderId = await createLabOrder({
              encounter_id: values.encounter_id,
              test_id: values.test_id,
              priority: values.priority as 'routine' | 'urgent',
              instructions: values.instructions,
            });
            return `Laboratory order saved. Order ID: ${orderId}`;
          }}
        />
      )}
    </div>
  );
}

export function DoctorPrescriptionsPage() {
  const encounters = useRemote(getEncounters);
  const medications = useRemote(getMedications);
  const loadError = encounters.error ?? medications.error;
  const loading = encounters.loading || medications.loading;
  return (
    <div className="page-shell">
      <PageHeader title="Prescriptions" subtitle="Create a prescription for an existing encounter" />
      {loading && <RequestState loading error={null} />}
      {loadError && <RequestState loading={false} error={loadError} />}
      {!loading && !loadError && (
        <WorkflowForm
          title="New prescription"
          submitLabel="Create prescription"
          fields={[
            { name: 'encounter_id', label: 'Encounter', type: 'select', required: true, options: (encounters.data ?? []).filter((item) => item.doctor_id).map((item) => ({
              value: item.encounter_id,
              label: `${item.patients?.[0]?.name ?? item.patient_id} · ${new Date(item.started_at).toLocaleString()} · ${item.status}`,
            })) },
            { name: 'medication_id', label: 'Medication', type: 'select', required: true, options: (medications.data ?? []).map((m) => ({ value: m.medication_id, label: m.name })) },
            { name: 'dosage', label: 'Dosage', required: true, maxLength: 500 },
            { name: 'frequency', label: 'Frequency', required: true, maxLength: 200 },
            { name: 'duration', label: 'Duration', required: true, maxLength: 200 },
            { name: 'instructions', label: 'Instructions', type: 'textarea', maxLength: 2000 },
            { name: 'quantity', label: 'Quantity', type: 'number', required: true, min: 1, step: 1 },
          ]}
          onSubmit={async (values) => {
            const id = await createPrescription({
              encounter_id: values.encounter_id,
              medication_id: values.medication_id,
              dosage: values.dosage,
              frequency: values.frequency,
              duration: values.duration,
              instructions: values.instructions,
              quantity: Number(values.quantity),
            });
            return `Prescription saved. Prescription ID: ${id}`;
          }}
        />
      )}
    </div>
  );
}

export function PatientDashboardUnavailablePage() {
  return <UnavailableWorkflow title="Patient dashboard" reason="The current patients table has no verified profile-to-patient foreign key, and patient-scoped RLS policies are not inspectable with the configured public key. Personal dashboard data is withheld until that mapping and policy are verified." />;
}

export function PatientDashboardPage() {
  const patient = useRemote(getMyPatient);
  return (
    <div className="page-shell">
      <PageHeader title="Patient dashboard" subtitle="Your patient record is resolved from the authenticated Supabase profile" />
      <RequestState loading={patient.loading} error={patient.error} />
      {patient.data && (
        <>
          <section className="panel form-panel">
            <h2>{patient.data.name}</h2>
            <p>Patient ID: {patient.data.patient_id}</p>
            <p>Address: {patient.data.address || 'Not provided'}</p>
          </section>
          <WorkflowForm
            title="Update permitted profile details"
            submitLabel="Save profile"
            onSuccess={patient.refresh}
            fields={[
              { name: 'name', label: 'Name', required: true, maxLength: 200 },
              { name: 'address', label: 'Address', type: 'textarea', required: true, maxLength: 1000 },
            ]}
            onSubmit={async (values) => {
              await updateMyPatientProfile({ name: values.name, address: values.address });
              return 'Profile saved.';
            }}
          />
        </>
      )}
    </div>
  );
}

export function PatientAppointmentsUnavailablePage() {
  return <UnavailableWorkflow title="My appointments" reason="The live schema has no verified link from the signed-in profile to a patient_id. The patient self-service request form remains disabled rather than accepting a browser-supplied patient identity." />;
}

export function PatientAppointmentsPage() {
  const doctors = useRemote(getDoctors);
  const appointments = useRemote(getMyAppointments);
  return (
    <div className="page-shell">
      <PageHeader title="My appointments" subtitle="Requests use the patient linked to your authenticated profile" />
      {doctors.loading && <RequestState loading error={null} />}
      {doctors.error && <RequestState loading={false} error={doctors.error} />}
      {!doctors.loading && !doctors.error && (
        <WorkflowForm
          title="Request an appointment"
          submitLabel="Request appointment"
          onSuccess={appointments.refresh}
          fields={[
            { name: 'doctor_id', label: 'Doctor', type: 'select', required: true, options: (doctors.data ?? []).map((d) => ({ value: d.doctor_id, label: `${d.name} — ${d.specialization}` })) },
            { name: 'appointment_date', label: 'Appointment date and time', type: 'datetime-local', required: true },
            { name: 'reason', label: 'Reason', type: 'textarea', required: true, maxLength: 1000 },
          ]}
          onSubmit={async (values) => {
            const appointmentDate = new Date(values.appointment_date);
            if (Number.isNaN(appointmentDate.getTime())) throw new Error('Appointment date and time are invalid.');
            await requestMyAppointment({
              doctor_id: values.doctor_id,
              appointment_date: appointmentDate.toISOString(),
              reason: values.reason,
            });
            return 'Appointment request saved.';
          }}
        />
      )}
      <TableCard title="Appointments visible to your account">
        <RequestState loading={appointments.loading} error={appointments.error} />
        {!appointments.loading && !appointments.error && appointments.data && (
          <AppointmentTableRows rows={appointments.data} />
        )}
      </TableCard>
    </div>
  );
}

export function PatientRecordsUnavailablePage() {
  return <UnavailableWorkflow title="My records" reason="Patient identity mapping and row-level access policies could not be verified. Records are not queried until the database can enforce patient-only access." />;
}

export function PatientRecordsPage() {
  const records = useRemote(getMyMedicalRecords);
  const clinicalRecords = useRemote(getMyClinicalRecords);
  const prescriptions = useRemote(getMyPrescriptions);
  const labResults = useRemote(getMyLabResults);
  const prescriptionRows = (prescriptions.data ?? []).flatMap((prescription) =>
    prescription.prescription_medications.map((item) => [
      prescription.prescription_id,
      item.medications?.[0]?.name ?? '—',
      item.dosage,
      item.frequency ?? '—',
      item.duration ?? '—',
      item.instructions ?? '—',
      <StatusPill key={`${prescription.prescription_id}-${item.dosage}`} value={prescription.status ?? 'unknown'} />,
    ]),
  );
  return (
    <div className="page-shell">
      <PageHeader title="My records" subtitle="Queries are scoped to the patient record linked to your authenticated profile and also subject to database RLS" />
      <TableCard title="Medical history">
        <RequestState loading={records.loading} error={records.error} />
        {!records.loading && !records.error && records.data && (
          <DataTable headers={['Record', 'Diagnosis', 'Notes', 'Treatment plan', 'Created']} rows={records.data.map((record) => [
            record.record_id, record.diagnosis, record.notes, record.treatment_plan, record.created_at ?? '—',
          ])} />
        )}
      </TableCard>
      <TableCard title="Encounters, consultations, diagnoses, and vital signs">
        <RequestState loading={clinicalRecords.loading} error={clinicalRecords.error} />
        {!clinicalRecords.loading && !clinicalRecords.error && clinicalRecords.data && (
          <DataTable headers={['Encounter', 'Started', 'Status', 'Consultations', 'Diagnoses', 'Vital signs']} rows={clinicalRecords.data.map((encounter) => [
            encounter.encounter_id,
            encounter.started_at,
            encounter.status,
            encounter.consultations.map((consultation) => [
              consultation.chief_complaint,
              consultation.clinical_notes,
              consultation.treatment_plan,
            ].filter(Boolean).join(' · ') || '—').join('; ') || '—',
            encounter.diagnoses.map((diagnosis) => `${diagnosis.is_primary ? 'Primary: ' : ''}${diagnosis.code ? `${diagnosis.code} — ` : ''}${diagnosis.description}`).join('; ') || '—',
            encounter.vital_signs.map((vitals) => [
              vitals.systolic_bp && vitals.diastolic_bp ? `BP ${vitals.systolic_bp}/${vitals.diastolic_bp}` : '',
              vitals.heart_rate ? `HR ${vitals.heart_rate}` : '',
              vitals.temperature_c ? `${vitals.temperature_c} °C` : '',
              vitals.oxygen_saturation ? `O₂ ${vitals.oxygen_saturation}%` : '',
              vitals.weight_kg ? `${vitals.weight_kg} kg` : '',
              vitals.height_cm ? `${vitals.height_cm} cm` : '',
              vitals.notes ?? '',
            ].filter(Boolean).join(' · ')).join('; ') || '—',
          ])} emptyMessage="No encounter-based clinical records have been recorded." />
        )}
      </TableCard>
      <TableCard title="Prescriptions">
        <RequestState loading={prescriptions.loading} error={prescriptions.error} />
        {!prescriptions.loading && !prescriptions.error && prescriptions.data && (
          <DataTable headers={['Prescription', 'Medication', 'Dosage', 'Frequency', 'Duration', 'Instructions', 'Status']} rows={prescriptionRows} />
        )}
      </TableCard>
      <TableCard title="Published laboratory results">
        <RequestState loading={labResults.loading} error={labResults.error} />
        {!labResults.loading && !labResults.error && labResults.data && (
          <DataTable headers={['Test', 'Result', 'Units', 'Reference range', 'Notes', 'Performed']} rows={labResults.data.map((result) => [
            result.lab_orders?.[0]?.lab_tests?.[0]?.name ?? '—',
            result.result_value ?? '—',
            result.units ?? '—',
            result.reference_range ?? '—',
            result.result_notes ?? '—',
            result.performed_at ?? '—',
          ])} />
        )}
      </TableCard>
    </div>
  );
}

export function PatientBillsPage() {
  const { data, loading, error } = useRemote(getMyBillingRecords);
  const payments = useRemote(getMyBillingPayments);
  return (
    <div className="page-shell">
      <PageHeader title="My bills" subtitle="Billing records returned under the current database policies" />
      <TableCard title="Invoices">
        <RequestState loading={loading} error={error} />
        {!loading && !error && data && <DataTable headers={['Bill', 'Patient', 'Total', 'Status', 'Created']} rows={data.map((bill: BillingRecord) => [
          bill.bill_id, bill.patient_id, bill.total_amount, <StatusPill key={bill.bill_id} value={bill.status} />, bill.created_at ?? '—',
        ])} />}
      </TableCard>
      <TableCard title="Payments">
        <RequestState loading={payments.loading} error={payments.error} />
        {!payments.loading && !payments.error && payments.data && (
          <DataTable headers={['Receipt', 'Bill', 'Amount', 'Method', 'Reference', 'Paid']} rows={payments.data.map((payment) => [
            payment.payment_id,
            payment.bill_id,
            payment.amount,
            payment.payment_method,
            payment.reference ?? '—',
            payment.paid_at,
          ])} emptyMessage="No payments have been recorded for your bills." />
        )}
      </TableCard>
    </div>
  );
}

export function LabDashboardPage() {
  const orders = useRemote(getLabOrders);
  const tests = useRemote(getLabTests);
  const loading = orders.loading || tests.loading;
  const error = orders.error ?? tests.error;
  return (
    <div className="page-shell">
      <PageHeader title="Laboratory dashboard" subtitle="Live requests and the configured test catalog" />
      <div className="metrics-grid">
        <MetricCard label="Pending requests" value={orders.data?.filter((item) => item.status === 'requested').length ?? '—'} />
        <MetricCard label="In progress" value={orders.data?.filter((item) => item.status === 'in_progress').length ?? '—'} />
        <MetricCard label="Completed" value={orders.data?.filter((item) => item.status === 'completed').length ?? '—'} />
        <MetricCard label="Available test catalog" value={tests.data?.length ?? '—'} />
      </div>
      <TableCard title="Incoming laboratory requests">
        <RequestState loading={loading} error={error} />
        {!loading && !error && orders.data && <DataTable headers={['Order', 'Patient', 'Test', 'Priority', 'Status', 'Requested']} rows={orders.data.map((order) => [
          order.lab_order_id,
          order.patients?.[0]?.name ?? order.patient_id,
          order.lab_tests?.[0]?.name ?? order.test_id,
          order.priority,
          <StatusPill key={order.lab_order_id} value={order.status} />,
          order.ordered_at,
        ])} />}
      </TableCard>
      <TableCard title="Available tests">
        <RequestState loading={tests.loading} error={tests.error} />
        {!tests.loading && !tests.error && tests.data && <DataTable headers={['Test ID', 'Test', 'Description']} rows={tests.data.map((test: LabTest) => [
          test.test_id, test.name, test.description,
        ])} />}
      </TableCard>
    </div>
  );
}

export function LabPendingUnavailablePage() {
  return <UnavailableWorkflow title="Pending laboratory tests" reason="The live database has no lab_orders relation. Order processing is disabled until the migration is applied and verified." />;
}

export function LabPendingPage() {
  const orders = useRemote(getLabOrders);
  return (
    <div className="page-shell">
      <PageHeader title="Pending laboratory tests" subtitle="Visible orders and real result submission" />
      {orders.loading && <RequestState loading error={null} />}
      {orders.error && <RequestState loading={false} error={orders.error} />}
      {!orders.loading && !orders.error && (
        <WorkflowForm
          title="Enter laboratory result"
          submitLabel="Save result"
          onSuccess={orders.refresh}
          fields={[
            { name: 'lab_order_id', label: 'Laboratory order', type: 'select', required: true, options: (orders.data ?? []).map((order) => ({ value: order.lab_order_id, label: `${order.lab_order_id} — ${order.lab_tests?.[0]?.name ?? order.test_id}` })) },
            { name: 'result_value', label: 'Result', type: 'textarea', required: true, maxLength: 5000 },
            { name: 'units', label: 'Units', maxLength: 100 },
            { name: 'reference_range', label: 'Reference range', maxLength: 200 },
            { name: 'result_notes', label: 'Notes', type: 'textarea', maxLength: 2000 },
          ]}
          onSubmit={async (values) => {
            await saveLabResult({
              lab_order_id: values.lab_order_id,
              result_value: values.result_value,
              units: values.units,
              reference_range: values.reference_range,
              result_notes: values.result_notes,
            });
            return 'Laboratory result saved for doctor review.';
          }}
        />
      )}
      <TableCard title="Laboratory orders">
        <RequestState loading={orders.loading} error={orders.error} />
        {!orders.loading && !orders.error && orders.data && (
          <DataTable headers={['Order', 'Patient', 'Test', 'Priority', 'Status', 'Ordered', 'Action']} rows={orders.data.map((order) => [
            order.lab_order_id,
            order.patients?.[0]?.name ?? order.patient_id,
            order.lab_tests?.[0]?.name ?? order.test_id,
            order.priority,
            <StatusPill key={order.lab_order_id} value={order.status} />,
            order.ordered_at,
            order.status === 'requested'
              ? <LabOrderAction key={`${order.lab_order_id}-action`} orderId={order.lab_order_id} onChange={orders.refresh} />
              : '—',
          ])} />
        )}
      </TableCard>
    </div>
  );
}

function LabOrderAction({ orderId, onChange }: { orderId: string; onChange: () => void }) {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const accept = async () => {
    setSaving(true);
    setError(null);
    try {
      await markLabOrderInProgress(orderId);
      onChange();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Unable to accept laboratory order.');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div>
      <button className="secondary-button" type="button" disabled={saving} onClick={() => void accept()}>
        {saving ? 'Accepting…' : 'Accept'}
      </button>
      {error && <span className="action-error" role="alert">{error}</span>}
    </div>
  );
}

export function LabReportsUnavailablePage() {
  return <UnavailableWorkflow title="Laboratory results" reason="The live database has no lab_results relation. Result entry and publishing are disabled until the migration is applied and verified." />;
}

export function LabReportsPage() {
  const results = useRemote(getLabResults);
  return (
    <div className="page-shell">
      <PageHeader title="Laboratory results" subtitle="Results are published only after doctor review" />
      <TableCard title="Reports">
        <RequestState loading={results.loading} error={results.error} />
        {!results.loading && !results.error && results.data && (
          <DataTable headers={['Result', 'Patient', 'Test', 'Value', 'Status', 'Performed', 'Published']} rows={results.data.map((result) => [
            result.lab_result_id,
            result.lab_orders?.[0]?.patients?.[0]?.name ?? result.lab_orders?.[0]?.patient_id ?? '—',
            result.lab_orders?.[0]?.lab_tests?.[0]?.name ?? '—',
            `${result.result_value ?? ''} ${result.units ?? ''}`.trim(),
            <StatusPill key={result.lab_result_id} value={result.status} />,
            result.performed_at ?? '—',
            result.published_at ?? '—',
          ])} />
        )}
      </TableCard>
    </div>
  );
}

export function PharmacyDashboardPage() {
  const items = useRemote(getPrescriptionItems);
  const inventory = useRemote(getMedicationInventory);
  const loading = items.loading || inventory.loading;
  const error = items.error ?? inventory.error;
  return (
    <div className="page-shell">
      <PageHeader title="Pharmacy dashboard" subtitle="Prescription queue and database-backed medication stock" />
      <div className="metrics-grid">
        <MetricCard label="Pending prescription items" value={items.data?.filter((item) => item.dispensed_quantity !== item.quantity).length ?? '—'} />
        <MetricCard label="Medications" value={inventory.data?.length ?? '—'} />
        <MetricCard label="Low stock (≤ 10)" value={inventory.data?.filter((item) => item.stock_quantity != null && item.stock_quantity <= 10).length ?? '—'} />
        <MetricCard label="Unrecorded stock balances" value={inventory.data?.filter((item) => item.stock_quantity == null).length ?? '—'} />
      </div>
      <TableCard title="Prescription queue">
        <RequestState loading={loading} error={error} />
        {!loading && !error && items.data && <DataTable headers={['Item', 'Medication', 'Dosage', 'Prescribed', 'Dispensed', 'Status']} rows={items.data.filter((item) => item.dispensed_quantity !== item.quantity).map((item) => [
          item.prescription_medication_id,
          item.medications?.[0]?.name ?? item.medication_id,
          [item.dosage, item.frequency, item.duration].filter(Boolean).join(' / '),
          item.quantity ?? 'Unknown',
          item.dispensed_quantity ?? 'Unknown',
          <StatusPill key={item.prescription_medication_id} value={item.prescriptions?.[0]?.status ?? 'unknown'} />,
        ])} />}
      </TableCard>
      <TableCard title="Medication stock">
        <RequestState loading={inventory.loading} error={inventory.error} />
        {!inventory.loading && !inventory.error && inventory.data && <DataTable headers={['Medication', 'Description', 'Stock']} rows={inventory.data.map((medication: Medication & { stock_quantity: number | null }) => [
          medication.name, medication.description, medication.stock_quantity ?? 'Not recorded',
        ])} />}
      </TableCard>
    </div>
  );
}

export function PharmacyInventoryPage() {
  const inventory = useRemote(getMedicationInventory);
  return (
    <div className="page-shell">
      <PageHeader title="Medication inventory" subtitle="Stock is stored in the migration-managed medications.stock_quantity field" />
      {inventory.loading && <RequestState loading error={null} />}
      {inventory.error && <RequestState loading={false} error={inventory.error} />}
      {!inventory.loading && !inventory.error && (
        <WorkflowForm
          title="Set stock quantity"
          submitLabel="Update stock"
          onSuccess={inventory.refresh}
          fields={[
            { name: 'medication_id', label: 'Medication', type: 'select', required: true, options: (inventory.data ?? []).map((item) => ({ value: item.medication_id, label: `${item.name} — current stock: ${item.stock_quantity}` })) },
            { name: 'stock_quantity', label: 'New stock quantity', type: 'number', required: true, min: 0, step: 1 },
            { name: 'notes', label: 'Reason for adjustment', type: 'textarea', required: true, maxLength: 1000 },
          ]}
          onSubmit={async (values) => {
            await setMedicationStock(values.medication_id, Number(values.stock_quantity), values.notes);
            return 'Inventory quantity updated.';
          }}
        />
      )}
      <TableCard title="Current stock">
        <RequestState loading={inventory.loading} error={inventory.error} />
        {!inventory.loading && !inventory.error && inventory.data && (
          <DataTable headers={['Medication', 'Description', 'Stock']} rows={inventory.data.map((item) => [
            item.name, item.description, item.stock_quantity ?? 'Not recorded',
          ])} />
        )}
      </TableCard>
      <MedicationStockHistory />
    </div>
  );
}

function MedicationStockHistory() {
  const movements = useRemote(getMedicationStockMovements);
  return (
    <TableCard title="Stock movement history">
      <RequestState loading={movements.loading} error={movements.error} />
      {!movements.loading && !movements.error && movements.data && (
        <DataTable headers={['Recorded', 'Medication', 'Movement', 'Before', 'After', 'Notes']} rows={movements.data.map((movement) => [
          movement.recorded_at,
          movement.medications?.[0]?.name ?? movement.medication_id,
          movement.movement_type,
          movement.quantity_before ?? 'Unknown',
          movement.quantity_after,
          movement.notes ?? '—',
        ])} />
      )}
    </TableCard>
  );
}

export function PharmacyPrescriptionsUnavailablePage() {
  return <UnavailableWorkflow title="Prescription dispensing" reason="The existing prescription item relation has no verified quantity or dispensing fields. Inventory deduction uses an atomic function in the unapplied migration and is disabled until that migration is verified." />;
}

export function PharmacyPrescriptionsPage() {
  const items = useRemote(getPrescriptionItems);
  return (
    <div className="page-shell">
      <PageHeader title="Prescription dispensing" subtitle="Dispensing atomically deducts medication stock and updates the prescription item" />
      <TableCard title="Prescription items">
        <RequestState loading={items.loading} error={items.error} />
        {!items.loading && !items.error && items.data && (
          <DataTable headers={['Item', 'Medication', 'Dosage', 'Instructions', 'Dispensed', 'Stock', 'Action']} rows={items.data.map((item) => [
            item.prescription_medication_id,
            item.medications?.[0]?.name ?? item.medication_id,
            [item.dosage, item.frequency, item.duration].filter(Boolean).join(' / '),
            item.instructions ?? '—',
            `${item.dispensed_quantity ?? 'Unknown'}/${item.quantity ?? 'Unknown'}`,
            item.medications?.[0]?.stock_quantity ?? 'Unknown',
            <WorkflowForm
              key={item.prescription_medication_id}
              title="Dispense"
              submitLabel="Dispense"
              onSuccess={items.refresh}
              fields={[{ name: 'quantity', label: 'Quantity to dispense', type: 'number', required: true, min: 1, step: 1 }]}
              onSubmit={async (values) => {
                await dispensePrescriptionItem(item.prescription_medication_id, Number(values.quantity));
                return 'Dispensing and stock deduction completed.';
              }}
            />,
          ])} />
        )}
      </TableCard>
    </div>
  );
}

export function AdminBillingPage() {
  return <BillingWorkflowPage title="Billing and payments" />;
}

export function ReceptionBillingPage() {
  return <BillingWorkflowPage title="Reception billing" />;
}

function BillingWorkflowPage({ title }: { title: string }) {
  const encounters = useRemote(getEncounters);
  const bills = useRemote(getBillingRecords);
  const payments = useRemote(getBillingPayments);
  const paymentRequestKey = useRef<string | null>(null);
  return (
    <div className="page-shell">
      <PageHeader title={title} subtitle="Bills and payment receipts are written to Supabase" />
      {encounters.loading && <RequestState loading error={null} />}
      {encounters.error && <RequestState loading={false} error={encounters.error} />}
      {!encounters.loading && !encounters.error && (
        <WorkflowForm
          title="Create bill"
          submitLabel="Create bill"
          onSuccess={bills.refresh}
          fields={[
            { name: 'encounter_id', label: 'Encounter', type: 'select', required: true, options: (encounters.data ?? []).map((encounter) => ({
              value: encounter.encounter_id,
              label: `${encounter.patients?.[0]?.name ?? encounter.patient_id} · ${new Date(encounter.started_at).toLocaleString()} · ${encounter.status}`,
            })) },
            { name: 'total_amount', label: 'Total amount', type: 'number', required: true, min: 0, step: 0.01 },
          ]}
          onSubmit={async (values) => {
            const billId = await createBillingRecord({
              encounter_id: values.encounter_id,
              total_amount: Number(values.total_amount),
            });
            return `Bill created: ${billId}`;
          }}
        />
      )}
      <TableCard title="Record a payment">
        <RequestState loading={bills.loading} error={bills.error} />
        {!bills.loading && !bills.error && bills.data && (
          <WorkflowForm
            title="Payment"
            submitLabel="Record payment"
            onSuccess={() => {
              bills.refresh();
              payments.refresh();
            }}
            fields={[
              { name: 'bill_id', label: 'Bill', type: 'select', required: true, options: bills.data.map((bill) => ({ value: bill.bill_id, label: `${bill.bill_id} — ${formatKes(bill.total_amount)} (${bill.status})` })) },
              { name: 'amount', label: 'Amount received', type: 'number', required: true, min: 0.01, step: 0.01 },
              { name: 'payment_method', label: 'Payment method', required: true, maxLength: 100 },
              { name: 'reference', label: 'Receipt/reference', maxLength: 200 },
            ]}
            onSubmit={async (values) => {
              paymentRequestKey.current ??= crypto.randomUUID();
              const paymentId = await recordBillingPayment({
                bill_id: values.bill_id,
                amount: Number(values.amount),
                payment_method: values.payment_method,
                reference: values.reference,
                idempotency_key: paymentRequestKey.current,
              });
              paymentRequestKey.current = null;
              return `Payment receipt saved: ${paymentId}.`;
            }}
          />
        )}
      </TableCard>
      <TableCard title="Bills">
        <RequestState loading={bills.loading} error={bills.error} />
        {!bills.loading && !bills.error && bills.data && (
          <DataTable headers={['Bill', 'Patient', 'Total', 'Status', 'Created']} rows={bills.data.map((bill) => [
            bill.bill_id, bill.patient_id, formatKes(bill.total_amount), <StatusPill key={bill.bill_id} value={bill.status} />, bill.created_at ?? '—',
          ])} />
        )}
      </TableCard>
      <TableCard title="Payment history">
        <RequestState loading={payments.loading} error={payments.error} />
        {!payments.loading && !payments.error && payments.data && (
          <DataTable headers={['Receipt', 'Bill', 'Amount (KES)', 'Method', 'Reference', 'Paid']} rows={payments.data.map((payment) => [
            payment.payment_id,
            payment.bill_id,
            formatKes(payment.amount),
            payment.payment_method,
            payment.reference ?? '—',
            new Date(payment.paid_at).toLocaleString(),
          ])} emptyMessage="No payment receipts have been recorded." />
        )}
      </TableCard>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuth();
  return (
    <div className="page-shell">
      <PageHeader title="Profile" subtitle="Authenticated account and database role" />
      <section className="panel form-panel">
        <div className="profile-card">
          <div className="profile-avatar">{user?.full_name?.slice(0, 2).toUpperCase() ?? 'CU'}</div>
          <div>
            <h2>{user?.full_name ?? 'Carepoint user'}</h2>
            <p>{user?.email ?? 'Email supplied by Supabase Auth'}</p>
            <p>Role: {user?.role ?? 'unassigned'}</p>
          </div>
        </div>
      </section>
    </div>
  );
}
