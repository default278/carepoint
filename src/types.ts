export type Role =
  | 'admin'
  | 'receptionist'
  | 'doctor'
  | 'patient'
  | 'lab_technician'
  | 'pharmacist';

export type SupabaseRelationProbe =
  | { queryable: true; status: 'queryable' }
  | {
      queryable: false;
      status: 'not_in_schema_cache' | 'error';
      code?: string;
      error: string;
    };

export type SupabaseHealth = {
  configured: boolean;
  error: string | null;
  tables: Record<string, SupabaseRelationProbe>;
};

export const roleDashboardPath: Record<Role, string> = {
  admin: '/admin',
  receptionist: '/reception',
  doctor: '/doctor',
  patient: '/patient',
  lab_technician: '/lab',
  pharmacist: '/pharmacy',
};

export type UserProfile = {
  id: string;
  email: string;
  full_name: string;
  phone: string | null;
  role: Role;
};

export type Patient = {
  patient_id: string;
  name: string;
  address: string;
  created_at?: string;
};

export type Doctor = {
  doctor_id: string;
  name: string;
  specialization: string;
  created_at?: string;
};

export type Appointment = {
  appointment_id: string;
  patient_id: string;
  doctor_id: string;
  appointment_date: string;
  status: string;
  reason: string;
  created_at?: string;
  patients?: { name: string }[] | null;
  doctors?: { name: string }[] | null;
};

export type Encounter = {
  encounter_id: string;
  patient_id: string;
  doctor_id: string | null;
  appointment_id: string | null;
  status: string;
  started_at: string;
  ended_at: string | null;
  patients?: { name: string }[] | null;
  doctors?: { name: string }[] | null;
};

export type MedicalRecord = {
  record_id: string;
  patient_id: string;
  doctor_id: string;
  diagnosis: string;
  notes: string;
  treatment_plan: string;
  created_at?: string;
};

export type LabTest = {
  test_id: string;
  name: string;
  description: string;
  created_at?: string;
};

export type Medication = {
  medication_id: string;
  name: string;
  description: string;
  created_at?: string;
};

export type BillingRecord = {
  bill_id: string;
  patient_id: string;
  total_amount: number;
  status: string;
  created_at?: string;
};

export type UserRecord = {
  id: string;
  full_name: string;
  email?: string;
  phone?: string;
  role: string;
  created_at?: string;
};

export type RoleOption = {
  id: string;
  name: Role;
  description: string | null;
};
