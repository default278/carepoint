import { ensureSupabaseReady, supabase } from './supabase';
import { extractAssignedRoles } from './role-mapping';
import type {
  Appointment,
  BillingRecord,
  Doctor,
  Encounter,
  LabTest,
  MedicalRecord,
  Medication,
  Patient,
  Role,
  RoleOption,
  UserRecord,
} from '../types';

async function getClient(requireWorkflowMigration = false) {
  await ensureSupabaseReady();
  if (!supabase) {
    throw new Error('Supabase client is not initialized.');
  }
  if (requireWorkflowMigration) {
    const { data, error } = await supabase.rpc('carepoint_schema_ready');
    if (error || data !== true) {
      throw new Error(
        `Database-backed workflow is unavailable until the reviewed Carepoint workflow migration is applied: ${error?.message ?? 'migration marker was not returned.'}`,
      );
    }
  }
  return supabase;
}

function throwDatabaseError(operation: string, error: { message: string; code?: string }) {
  throw new Error(`${operation} failed${error.code ? ` (${error.code})` : ''}: ${error.message}`);
}

export async function getPatients(): Promise<Patient[]> {
  let client = await getClient();
  let query = client
    .from('patients')
    .select('patient_id,name,address,created_at')
    .order('created_at', { ascending: false });
  const role = await getCurrentRole();
  if (role === 'patient') {
    const patient = await getMyPatient();
    return [patient];
  }
  if (role === 'doctor') {
    client = await getClient(true);
    const doctorId = await getMyDoctorId();
    const { data: assignments, error: assignmentError } = await client
      .from('doctor_assignments')
      .select('patient_id')
      .eq('doctor_id', doctorId)
      .eq('is_active', true);
    if (assignmentError) throwDatabaseError('Loading your patient assignments', assignmentError);
    const patientIds = [...new Set((assignments ?? []).map((assignment) => assignment.patient_id))];
    if (patientIds.length === 0) return [];
    query = query.in('patient_id', patientIds);
  } else if (role !== 'admin' && role !== 'receptionist') {
    return [];
  }
  const { data, error } = await query;
  if (error) throwDatabaseError('Loading patients', error);
  return data ?? [];
}

export async function createPatient(input: { name: string; address: string }): Promise<Patient> {
  const name = input.name.trim();
  const address = input.address.trim();
  if (!name || !address) {
    throw new Error('Patient name and address are required.');
  }

  const client = await getClient();
  const { data: possibleDuplicates, error: duplicateError } = await client
    .from('patients')
    .select('patient_id,name,address')
    .ilike('name', name)
    .ilike('address', address)
    .limit(1);
  if (duplicateError) throwDatabaseError('Checking for a possible duplicate patient', duplicateError);
  if (possibleDuplicates?.length) {
    throw new Error('A patient with the same name and address already exists. Review the existing patient before registering another.');
  }

  const { data, error } = await client
    .from('patients')
    .insert({ name, address })
    .select('patient_id,name,address,created_at')
    .single();
  if (error) throwDatabaseError('Registering patient', error);
  if (!data) throw new Error('Patient registration returned no saved record.');
  return data;
}

export async function getDoctors(): Promise<Doctor[]> {
  const client = await getClient();
  const { data, error } = await client
    .from('doctors')
    .select('doctor_id,name,specialization,created_at')
    .order('name');
  if (error) throwDatabaseError('Loading doctors', error);
  return data ?? [];
}

export async function getAppointments(): Promise<Appointment[]> {
  const client = await getClient();
  let query = client
    .from('appointments')
    .select('appointment_id,patient_id,doctor_id,appointment_date,status,reason,created_at,patients(name),doctors(name)')
    .order('appointment_date', { ascending: true });
  const role = await getCurrentRole();
  if (role === 'patient') {
    const patient = await getMyPatient();
    query = query.eq('patient_id', patient.patient_id);
  } else if (role === 'doctor') {
    const doctorId = await getMyDoctorId();
    query = query.eq('doctor_id', doctorId);
  } else if (role !== 'admin' && role !== 'receptionist') {
    return [];
  }
  const { data, error } = await query;
  if (error) throwDatabaseError('Loading appointments', error);
  return data ?? [];
}

export async function getEncounters(): Promise<Encounter[]> {
  const client = await getClient(true);
  let query = client
    .from('encounters')
    .select('encounter_id,patient_id,doctor_id,appointment_id,status,started_at,ended_at,patients(name),doctors(name)')
    .order('started_at', { ascending: false });
  const role = await getCurrentRole();
  if (role === 'patient') {
    const patient = await getMyPatient();
    query = query.eq('patient_id', patient.patient_id);
  } else if (role === 'doctor') {
    const doctorId = await getMyDoctorId();
    query = query.eq('doctor_id', doctorId);
  } else if (role !== 'admin' && role !== 'receptionist') {
    return [];
  }
  const { data, error } = await query;
  if (error) throwDatabaseError('Loading encounters', error);
  return data ?? [];
}

export async function createAppointment(input: {
  patient_id: string;
  doctor_id: string;
  appointment_date: string;
  reason: string;
}): Promise<Appointment> {
  const { patient_id, doctor_id, appointment_date, reason } = input;
  if (!patient_id || !doctor_id || !appointment_date || !reason.trim()) {
    throw new Error('Patient, doctor, appointment date, and reason are required.');
  }
  if (Number.isNaN(Date.parse(appointment_date))) {
    throw new Error('Appointment date is invalid.');
  }

  const client = await getClient();
  const { data, error } = await client
    .from('appointments')
    .insert({
      patient_id,
      doctor_id,
      appointment_date,
      reason: reason.trim(),
    })
    .select('appointment_id,patient_id,doctor_id,appointment_date,status,reason,created_at')
    .single();
  if (error) throwDatabaseError('Requesting appointment', error);
  if (!data) throw new Error('Appointment request returned no saved record.');
  return data;
}

async function getCurrentUserId(): Promise<string> {
  const client = await getClient();
  const { data, error } = await client.auth.getUser();
  if (error) throw new Error(`Unable to verify the authenticated user: ${error.message}`);
  if (!data.user) throw new Error('An authenticated user is required for this operation.');
  return data.user.id;
}

async function getCurrentRole(): Promise<Role> {
  const client = await getClient();
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('profiles')
    .select('user_roles(roles(name))')
    .eq('id', userId)
    .maybeSingle();
  if (error) throwDatabaseError('Checking the signed-in user role', error);
  const roles = extractAssignedRoles(data?.user_roles);
  if (roles.length !== 1) {
    throw new Error('A single valid database role is required for this operation.');
  }
  return roles[0];
}

async function getMyDoctorId(): Promise<string> {
  const client = await getClient(true);
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('doctors')
    .select('doctor_id')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throwDatabaseError('Loading your doctor record', error);
  if (!data) throw new Error('No doctor record is linked to the signed-in profile.');
  return data.doctor_id;
}

export async function getMyPatient(): Promise<Patient> {
  const client = await getClient(true);
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('patients')
    .select('patient_id,name,address,created_at')
    .eq('profile_id', userId)
    .maybeSingle();
  if (error) throwDatabaseError('Loading your patient record', error);
  if (!data) throw new Error('No patient record is linked to the signed-in profile.');
  return data;
}

export async function updateMyPatientProfile(input: { name: string; address: string }): Promise<Patient> {
  const patient = await getMyPatient();
  const name = input.name.trim();
  const address = input.address.trim();
  if (!name || !address) throw new Error('Patient name and address are required.');

  const client = await getClient();
  const { data, error } = await client
    .from('patients')
    .update({ name, address })
    .eq('patient_id', patient.patient_id)
    .select('patient_id,name,address,created_at')
    .single();
  if (error) throwDatabaseError('Updating your patient profile', error);
  if (!data) throw new Error('The patient profile update returned no saved record.');
  return data;
}

export async function getMyAppointments(): Promise<Appointment[]> {
  const patient = await getMyPatient();
  const client = await getClient();
  const { data, error } = await client
    .from('appointments')
    .select('appointment_id,patient_id,doctor_id,appointment_date,status,reason,created_at,patients(name),doctors(name)')
    .eq('patient_id', patient.patient_id)
    .order('appointment_date', { ascending: true });
  if (error) throwDatabaseError('Loading your appointments', error);
  return data ?? [];
}

export async function getMyMedicalRecords(): Promise<MedicalRecord[]> {
  const patient = await getMyPatient();
  const client = await getClient();
  const { data, error } = await client
    .from('medical_records')
    .select('record_id,patient_id,doctor_id,diagnosis,notes,treatment_plan,created_at')
    .eq('patient_id', patient.patient_id)
    .order('created_at', { ascending: false });
  if (error) throwDatabaseError('Loading your medical history', error);
  return data ?? [];
}

export async function getMyClinicalRecords() {
  const patient = await getMyPatient();
  const client = await getClient(true);
  const { data, error } = await client
    .from('encounters')
    .select('encounter_id,status,started_at,ended_at,vital_signs!vital_signs_encounter_patient_fkey(systolic_bp,diastolic_bp,heart_rate,temperature_c,respiratory_rate,oxygen_saturation,weight_kg,height_cm,notes,recorded_at),consultations!consultations_encounter_doctor_fkey(chief_complaint,clinical_notes,treatment_plan,created_at),diagnoses!diagnoses_encounter_doctor_fkey(code,description,is_primary,created_at)')
    .eq('patient_id', patient.patient_id)
    .order('started_at', { ascending: false });
  if (error) throwDatabaseError('Loading your encounter history', error);
  return data ?? [];
}

export async function getMyBillingRecords(): Promise<BillingRecord[]> {
  const patient = await getMyPatient();
  const client = await getClient();
  const { data, error } = await client
    .from('billing')
    .select('bill_id,patient_id,total_amount,status,created_at')
    .eq('patient_id', patient.patient_id)
    .order('created_at', { ascending: false });
  if (error) throwDatabaseError('Loading your bills', error);
  return data ?? [];
}

export async function getMyBillingPayments() {
  const bills = await getMyBillingRecords();
  if (!bills.length) return [];
  const client = await getClient(true);
  const { data, error } = await client
    .from('billing_payments')
    .select('payment_id,bill_id,amount,payment_method,reference,paid_at')
    .in('bill_id', bills.map((bill) => bill.bill_id))
    .order('paid_at', { ascending: false });
  if (error) throwDatabaseError('Loading your payment history', error);
  return data ?? [];
}

export async function getMyPrescriptions() {
  const patient = await getMyPatient();
  const client = await getClient(true);
  const { data, error } = await client
    .from('prescriptions')
    .select('prescription_id,status,created_at,prescription_medications(dosage,frequency,duration,instructions,quantity,dispensed_quantity,medications(name))')
    .eq('patient_id', patient.patient_id)
    .order('created_at', { ascending: false });
  if (error) throwDatabaseError('Loading your prescriptions', error);
  return data ?? [];
}

export async function getMyLabResults() {
  const patient = await getMyPatient();
  const client = await getClient(true);
  const { data, error } = await client
    .from('lab_results')
    .select('lab_result_id,result_value,units,reference_range,result_notes,status,performed_at,published_at,lab_orders!inner(patient_id,ordered_at,lab_tests(name))')
    .eq('lab_orders.patient_id', patient.patient_id)
    .eq('status', 'approved')
    .order('performed_at', { ascending: false });
  if (error) throwDatabaseError('Loading your published laboratory results', error);
  return data ?? [];
}

export async function getMyNotifications() {
  const client = await getClient(true);
  const userId = await getCurrentUserId();
  const { data, error } = await client
    .from('carepoint_notifications')
    .select('notification_id,event_type,message,created_at,read_at,patient_id,encounter_id,patients(name)')
    .eq('recipient_profile_id', userId)
    .order('created_at', { ascending: false })
    .limit(50);
  if (error) throwDatabaseError('Loading your notifications', error);
  return data ?? [];
}

export async function requestMyAppointment(input: {
  doctor_id: string;
  appointment_date: string;
  reason: string;
}): Promise<void> {
  if (!input.doctor_id || !input.reason.trim()) {
    throw new Error('Doctor, appointment date, and reason are required.');
  }
  const date = new Date(input.appointment_date);
  if (Number.isNaN(date.getTime())) throw new Error('Appointment date is invalid.');
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_request_appointment', {
    target_doctor: input.doctor_id,
    requested_date: date.toISOString(),
    reason_text: input.reason.trim(),
  });
  if (error) throwDatabaseError('Requesting appointment', error);
}

export async function updateAppointment(input: {
  appointment_id: string;
  appointment_date: string;
}): Promise<Appointment> {
  if (!input.appointment_id || Number.isNaN(Date.parse(input.appointment_date))) {
    throw new Error('Appointment date is invalid.');
  }
  const client = await getClient();
  const role = await getCurrentRole();
  if (role !== 'admin' && role !== 'receptionist') {
    throw new Error('Only reception staff or an administrator can reschedule appointments.');
  }
  const { data, error } = await client
    .from('appointments')
    .update({ appointment_date: input.appointment_date })
    .eq('appointment_id', input.appointment_id)
    .select('appointment_id,patient_id,doctor_id,appointment_date,status,reason,created_at')
    .maybeSingle();
  if (error) throwDatabaseError('Updating appointment', error);
  if (!data) throw new Error('No appointment was updated. It may have been removed or your role may not be permitted to change it.');
  return data;
}

export async function recordTriage(input: {
  patient_id: string;
  doctor_id?: string;
  appointment_id?: string;
  systolic_bp?: number;
  diastolic_bp?: number;
  heart_rate?: number;
  temperature_c?: number;
  respiratory_rate?: number;
  oxygen_saturation?: number;
  weight_kg?: number;
  height_cm?: number;
  notes?: string;
}): Promise<string> {
  if (!input.patient_id) throw new Error('Patient is required to record triage.');
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_record_triage', {
    target_patient: input.patient_id,
    target_doctor: input.doctor_id ?? '',
    measurements: input,
    target_appointment: input.appointment_id ?? '',
  });
  if (error) throwDatabaseError('Recording triage', error);
  if (!data) throw new Error('Triage returned no encounter identifier.');
  return data;
}

export async function assignDoctor(input: { patient_id: string; doctor_id: string }): Promise<void> {
  if (!input.patient_id || !input.doctor_id) throw new Error('Patient and doctor are required.');
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_assign_doctor', {
    target_patient: input.patient_id,
    target_doctor: input.doctor_id,
  });
  if (error) throwDatabaseError('Assigning doctor', error);
}

export async function createEncounter(input: {
  patient_id: string;
  doctor_id?: string;
  appointment_id?: string;
}): Promise<string> {
  if (!input.patient_id) throw new Error('Patient is required to open an encounter.');
  const client = await getClient(true);
  const { data, error } = await client
    .from('encounters')
    .insert({
      patient_id: input.patient_id,
      doctor_id: input.doctor_id || null,
      appointment_id: input.appointment_id || null,
      status: 'open',
    })
    .select('encounter_id')
    .single();
  if (error) throwDatabaseError('Opening encounter', error);
  if (!data) throw new Error('Encounter creation returned no saved encounter.');
  return data.encounter_id;
}

export async function createConsultation(input: {
  encounter_id: string;
  chief_complaint: string;
  clinical_notes: string;
  treatment_plan: string;
}): Promise<string> {
  if (!input.encounter_id || !input.chief_complaint.trim()) {
    throw new Error('Encounter and chief complaint are required.');
  }
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_complete_consultation', {
    target_encounter: input.encounter_id,
    complaint_text: input.chief_complaint.trim(),
    clinical_text: input.clinical_notes.trim(),
    plan_text: input.treatment_plan.trim(),
  });
  if (error) throwDatabaseError('Saving consultation', error);
  if (!data) throw new Error('Consultation save returned no saved record.');
  return data;
}

export async function recordDiagnosis(input: {
  encounter_id: string;
  code?: string;
  description: string;
  is_primary: boolean;
}): Promise<void> {
  if (!input.encounter_id || !input.description.trim()) {
    throw new Error('Encounter and diagnosis are required.');
  }
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_record_diagnosis', {
    target_encounter: input.encounter_id,
    diagnosis_code: input.code?.trim() || '',
    diagnosis_text: input.description.trim(),
    primary_diagnosis: input.is_primary,
  });
  if (error) throwDatabaseError('Recording diagnosis', error);
}

export async function createLabOrder(input: {
  encounter_id: string;
  test_id: string;
  priority: 'routine' | 'urgent';
  instructions?: string;
}): Promise<string> {
  if (!input.encounter_id || !input.test_id) {
    throw new Error('Encounter and test are required.');
  }
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_create_lab_order', {
    target_encounter: input.encounter_id,
    target_test: input.test_id,
    order_priority: input.priority,
    order_instructions: input.instructions?.trim() ?? '',
  });
  if (error) throwDatabaseError('Creating laboratory order', error);
  if (!data) throw new Error('Laboratory order creation returned no saved order.');
  return data;
}

export async function getLabOrders() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('lab_orders')
    .select('lab_order_id,encounter_id,patient_id,ordered_by,test_id,status,priority,instructions,ordered_at,patients(name),lab_tests(name)')
    .order('ordered_at', { ascending: true });
  if (error) throwDatabaseError('Loading laboratory orders', error);
  return data ?? [];
}

export async function markLabOrderInProgress(orderId: string): Promise<void> {
  if (!orderId) throw new Error('Laboratory order is required.');
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_set_lab_order_in_progress', {
    target_order: orderId,
  });
  if (error) throwDatabaseError('Accepting laboratory order', error);
}

export async function saveLabResult(input: {
  lab_order_id: string;
  result_value: string;
  units?: string;
  reference_range?: string;
  result_notes?: string;
}): Promise<void> {
  if (!input.lab_order_id || !input.result_value.trim()) {
    throw new Error('Laboratory order and result are required.');
  }
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_submit_lab_result', {
    target_order: input.lab_order_id,
    value_text: input.result_value.trim(),
    units_text: input.units?.trim() ?? '',
    reference_text: input.reference_range?.trim() ?? '',
    notes_text: input.result_notes?.trim() ?? '',
  });
  if (error) throwDatabaseError('Saving laboratory result', error);
  if (!data) throw new Error('Laboratory result submission returned no saved result.');
}

export async function getLabResults() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('lab_results')
    .select('lab_result_id,lab_order_id,result_value,units,reference_range,result_notes,status,performed_at,published_at,lab_orders(patient_id,patients(name),lab_tests(name))')
    .order('performed_at', { ascending: false });
  if (error) throwDatabaseError('Loading laboratory results', error);
  return data ?? [];
}

export async function reviewLabResult(result_id: string, decision: 'approved' | 'rejected'): Promise<void> {
  if (!result_id) throw new Error('Laboratory result is required.');
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_review_lab_result', {
    result_key: result_id,
    decision,
  });
  if (error) throwDatabaseError('Reviewing laboratory result', error);
}

export async function createPrescription(input: {
  encounter_id: string;
  medication_id: string;
  dosage: string;
  frequency: string;
  duration: string;
  instructions: string;
  quantity: number;
}): Promise<string> {
  if (!input.encounter_id || !input.medication_id || !input.dosage.trim()
      || !input.frequency.trim() || !input.duration.trim() || !input.quantity) {
    throw new Error('Encounter, medication, dosage, frequency, duration and quantity are required.');
  }
  if (!Number.isInteger(input.quantity) || input.quantity <= 0) {
    throw new Error('Prescription quantity must be a positive whole number.');
  }
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_create_prescription', {
    target_encounter: input.encounter_id,
    target_medication: input.medication_id,
    dosage_text: input.dosage.trim(),
    frequency_text: input.frequency.trim(),
    duration_text: input.duration.trim(),
    instructions_text: input.instructions.trim(),
    prescribed_quantity: input.quantity,
  });
  if (error) throwDatabaseError('Creating prescription', error);
  if (!data) throw new Error('Prescription creation returned no prescription identifier.');
  return data;
}

export async function dispensePrescriptionItem(item_id: string, quantity: number): Promise<void> {
  if (!item_id || !Number.isInteger(quantity) || quantity <= 0) {
    throw new Error('Prescription item and a positive whole dispense quantity are required.');
  }
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_dispense_prescription_item', {
    item_key: item_id,
    dispense_count: quantity,
  });
  if (error) throwDatabaseError('Dispensing medication', error);
}

export async function createBillingRecord(input: {
  encounter_id: string;
  total_amount: number;
}): Promise<string> {
  if (!input.encounter_id || !Number.isFinite(input.total_amount) || input.total_amount < 0) {
    throw new Error('Encounter and a valid non-negative bill total are required.');
  }
  const client = await getClient(true);
  const { data: encounter, error: encounterError } = await client
    .from('encounters')
    .select('encounter_id,patient_id')
    .eq('encounter_id', input.encounter_id)
    .maybeSingle();
  if (encounterError) throwDatabaseError('Verifying the encounter for billing', encounterError);
  if (!encounter) throw new Error('The selected encounter is unavailable or not visible to your account.');
  const { data, error } = await client
    .from('billing')
    .insert({
      patient_id: encounter.patient_id,
      encounter_id: encounter.encounter_id,
      total_amount: input.total_amount,
    })
    .select('bill_id')
    .single();
  if (error) throwDatabaseError('Creating billing record', error);
  if (!data) throw new Error('Billing record creation returned no saved bill.');
  return data.bill_id;
}

export async function recordBillingPayment(input: {
  bill_id: string;
  amount: number;
  payment_method: string;
  reference?: string;
  idempotency_key: string;
}): Promise<string> {
  if (!input.bill_id || !Number.isFinite(input.amount) || input.amount <= 0
      || !input.payment_method.trim()
      || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(input.idempotency_key)) {
    throw new Error('Bill, positive payment amount, payment method, and valid request key are required.');
  }
  const client = await getClient(true);
  const { data, error } = await client.rpc('carepoint_record_payment', {
    target_bill: input.bill_id,
    payment_amount: input.amount,
    method_text: input.payment_method.trim(),
    reference_text: input.reference?.trim() ?? '',
    request_key: input.idempotency_key,
  });
  if (error) throwDatabaseError('Recording payment', error);
  if (!data) throw new Error('Payment operation returned no saved receipt.');
  return String(data);
}

export async function getMedicalRecords(): Promise<MedicalRecord[]> {
  const client = await getClient();
  let query = client
    .from('medical_records')
    .select('record_id,patient_id,doctor_id,diagnosis,notes,treatment_plan,created_at')
    .order('created_at', { ascending: false });
  const role = await getCurrentRole();
  if (role === 'patient') {
    const patient = await getMyPatient();
    query = query.eq('patient_id', patient.patient_id);
  } else if (role === 'doctor') {
    const doctorId = await getMyDoctorId();
    query = query.eq('doctor_id', doctorId);
  } else if (role !== 'admin') {
    return [];
  }
  const { data, error } = await query;
  if (error) throwDatabaseError('Loading medical records', error);
  return data ?? [];
}

export async function createMedicalRecord(input: {
  patient_id: string;
  doctor_id: string;
  diagnosis: string;
  notes: string;
  treatment_plan: string;
}): Promise<MedicalRecord> {
  if (!input.patient_id || !input.doctor_id || !input.diagnosis.trim()) {
    throw new Error('Patient, doctor, and diagnosis are required.');
  }

  const client = await getClient();
  const { data, error } = await client
    .from('medical_records')
    .insert({
      patient_id: input.patient_id,
      doctor_id: input.doctor_id,
      diagnosis: input.diagnosis.trim(),
      notes: input.notes.trim(),
      treatment_plan: input.treatment_plan.trim(),
    })
    .select('record_id,patient_id,doctor_id,diagnosis,notes,treatment_plan,created_at')
    .single();
  if (error) throwDatabaseError('Saving medical record', error);
  if (!data) throw new Error('Saving the medical record returned no saved record.');
  return data;
}

export async function getLabTests(): Promise<LabTest[]> {
  const client = await getClient();
  const { data, error } = await client
    .from('lab_tests')
    .select('test_id,name,description,created_at')
    .order('name');
  if (error) throwDatabaseError('Loading laboratory test catalog', error);
  return data ?? [];
}

export async function getMedications(): Promise<Medication[]> {
  const client = await getClient();
  const { data, error } = await client
    .from('medications')
    .select('medication_id,name,description,created_at')
    .order('name');
  if (error) throwDatabaseError('Loading medication catalog', error);
  return data ?? [];
}

export async function getMedicationInventory() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('medications')
    .select('medication_id,name,description,stock_quantity')
    .order('name');
  if (error) throwDatabaseError('Loading medication inventory', error);
  return data ?? [];
}

export async function setMedicationStock(
  medication_id: string,
  stock_quantity: number,
  notes: string,
): Promise<void> {
  if (!medication_id || !Number.isSafeInteger(stock_quantity) || stock_quantity < 0) {
    throw new Error('Medication and a non-negative whole-number stock quantity are required.');
  }
  if (!notes.trim()) throw new Error('Enter a note explaining the stock adjustment.');
  const client = await getClient(true);
  const { error } = await client.rpc('carepoint_adjust_medication_stock', {
    target_medication: medication_id,
    target_stock: stock_quantity,
    notes_text: notes.trim(),
  });
  if (error) throwDatabaseError('Updating medication stock', error);
}

export async function getPrescriptionItems() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('prescription_medications')
    .select('prescription_medication_id,prescription_id,medication_id,dosage,frequency,duration,instructions,quantity,dispensed_quantity,prescriptions(status),medications(name,stock_quantity)')
    .order('prescription_medication_id');
  if (error) throwDatabaseError('Loading prescription items', error);
  return data ?? [];
}

export async function getMedicationStockMovements() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('carepoint_stock_movements')
    .select('movement_id,medication_id,prescription_medication_id,movement_type,quantity_before,quantity_after,notes,recorded_at,medications(name)')
    .order('recorded_at', { ascending: false });
  if (error) throwDatabaseError('Loading medication stock history', error);
  return data ?? [];
}

export async function getBillingRecords(): Promise<BillingRecord[]> {
  const client = await getClient();
  let query = client
    .from('billing')
    .select('bill_id,patient_id,total_amount,status,created_at')
    .order('created_at', { ascending: false });
  const role = await getCurrentRole();
  if (role === 'patient') {
    const patient = await getMyPatient();
    query = query.eq('patient_id', patient.patient_id);
  } else if (role !== 'admin' && role !== 'receptionist') {
    return [];
  }
  const { data, error } = await query;
  if (error) throwDatabaseError('Loading billing records', error);
  return data ?? [];
}

export async function getBillingPayments() {
  const client = await getClient(true);
  const { data, error } = await client
    .from('billing_payments')
    .select('payment_id,bill_id,amount,payment_method,reference,paid_at')
    .order('paid_at', { ascending: false });
  if (error) throwDatabaseError('Loading billing payment history', error);
  return data ?? [];
}

export async function getUsers(): Promise<UserRecord[]> {
  const client = await getClient();
  const { data, error } = await client
    .from('profiles')
    .select('id,full_name,phone,created_at,user_roles(roles(name))')
    .order('created_at', { ascending: false });
  if (error) throwDatabaseError('Loading users', error);

  return (data ?? []).map((profile) => {
    const roles = extractAssignedRoles(profile.user_roles);
    return {
      id: profile.id,
      full_name: profile.full_name ?? '',
      phone: profile.phone ?? undefined,
      role: roles.length === 0 ? 'unassigned' : roles.join(', '),
      created_at: profile.created_at,
    };
  });
}

export async function getPatientProfileMappings() {
  const client = await getClient(true);
  if (await getCurrentRole() !== 'admin') {
    throw new Error('Only an administrator can view patient account links.');
  }
  const { data, error } = await client
    .from('patients')
    .select('patient_id,name,profile_id')
    .order('name');
  if (error) throwDatabaseError('Loading patient account links', error);
  return data ?? [];
}

export async function getDoctorProfileMappings() {
  const client = await getClient(true);
  if (await getCurrentRole() !== 'admin') {
    throw new Error('Only an administrator can view doctor account links.');
  }
  const { data, error } = await client
    .from('doctors')
    .select('doctor_id,name,profile_id')
    .order('name');
  if (error) throwDatabaseError('Loading doctor account links', error);
  return data ?? [];
}

async function setLinkedProfile(
  table: 'patients' | 'doctors',
  idColumn: 'patient_id' | 'doctor_id',
  recordId: string,
  profileId: string,
  expectedRole: 'patient' | 'doctor',
): Promise<void> {
  if (!recordId) throw new Error(`Choose a ${expectedRole} record.`);
  const client = await getClient(true);
  if (await getCurrentRole() !== 'admin') {
    throw new Error('Only an administrator can link a user profile.');
  }
  if (profileId) {
    const { data: target, error: targetError } = await client
      .from('profiles')
      .select('id,user_roles(roles(name))')
      .eq('id', profileId)
      .maybeSingle();
    if (targetError) throwDatabaseError('Verifying the profile link', targetError);
    if (!target || !extractAssignedRoles(target.user_roles).includes(expectedRole)) {
      throw new Error(`The selected account must already have the ${expectedRole} role.`);
    }
  }
  const { data, error } = await client
    .from(table)
    .update({ profile_id: profileId || null })
    .eq(idColumn, recordId)
    .select(idColumn)
    .maybeSingle();
  if (error) throwDatabaseError(`Linking ${expectedRole} profile`, error);
  if (!data) throw new Error(`No ${expectedRole} record was linked.`);
}

export async function linkPatientProfile(patientId: string, profileId: string): Promise<void> {
  await setLinkedProfile('patients', 'patient_id', patientId, profileId, 'patient');
}

export async function linkDoctorProfile(doctorId: string, profileId: string): Promise<void> {
  await setLinkedProfile('doctors', 'doctor_id', doctorId, profileId, 'doctor');
}

export async function getRoleOptions(): Promise<RoleOption[]> {
  const client = await getClient();
  const { data, error } = await client
    .from('roles')
    .select('id,name,description')
    .order('name');
  if (error) throwDatabaseError('Loading database roles', error);
  return (data ?? []).flatMap((role) => {
    const name = extractAssignedRoles([{ roles: { name: role.name } }])[0];
    return name ? [{ id: role.id, name, description: role.description }] : [];
  });
}

export async function assignRoleToProfile(input: { user_id: string; role_id: string }): Promise<void> {
  if (!input.user_id || !input.role_id) throw new Error('Choose an existing user and database role.');
  const client = await getClient();
  if (await getCurrentRole() !== 'admin') {
    throw new Error('Only an administrator can assign database roles.');
  }
  const currentUserId = await getCurrentUserId();
  if (input.user_id === currentUserId) {
    throw new Error('You cannot assign roles to your own profile.');
  }

  const { data: targetRole, error: roleError } = await client
    .from('roles')
    .select('id,name')
    .eq('id', input.role_id)
    .maybeSingle();
  if (roleError) throwDatabaseError('Verifying the requested role', roleError);
  const roleName = extractAssignedRoles([{ roles: { name: targetRole?.name } }])[0];
  if (!targetRole || !roleName) throw new Error('The requested role is not one of the supported database roles.');

  const { data: targetProfile, error: profileError } = await client
    .from('profiles')
    .select('id')
    .eq('id', input.user_id)
    .maybeSingle();
  if (profileError) throwDatabaseError('Verifying the target profile', profileError);
  if (!targetProfile) throw new Error('The selected profile does not exist.');

  const { data: existing, error: existingError } = await client
    .from('user_roles')
    .select('user_id,role_id')
    .eq('user_id', input.user_id)
    .maybeSingle();
  if (existingError) throwDatabaseError('Checking existing role assignment', existingError);
  if (existing?.role_id === input.role_id) {
    throw new Error('This profile already has the selected role.');
  }
  if (existing) {
    const { error } = await client
      .from('user_roles')
      .update({ role_id: input.role_id })
      .eq('user_id', input.user_id);
    if (error) throwDatabaseError('Changing profile role', error);
    return;
  }

  const { error } = await client.from('user_roles').insert({
    user_id: input.user_id,
    role_id: input.role_id,
  });
  if (error) throwDatabaseError('Assigning role to profile', error);
}

export async function getStaffProvisioningStatus(): Promise<{ enabled: boolean; reason: string | null }> {
  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/api/admin/invitations/status`);
  const result = await response.json() as { enabled?: boolean; reason?: string | null };
  if (!response.ok || typeof result.enabled !== 'boolean') {
    throw new Error(`Unable to verify staff provisioning status (HTTP ${response.status}).`);
  }
  return { enabled: result.enabled, reason: result.reason ?? null };
}

export async function inviteUserByEmail(email: string): Promise<string> {
  const client = await getClient();
  const { data, error } = await client.auth.getSession();
  if (error) throw new Error(`Unable to verify the signed-in session: ${error.message}`);
  const accessToken = data.session?.access_token;
  if (!accessToken) throw new Error('A signed-in administrator session is required.');

  const apiBase = (import.meta.env.VITE_API_BASE_URL ?? '').replace(/\/$/, '');
  const response = await fetch(`${apiBase}/api/admin/invitations`, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ email }),
  });
  const result = await response.json() as { ok?: boolean; message?: string; error?: string };
  if (!response.ok || !result.ok) {
    throw new Error(result.error ?? `Invitation request failed with status ${response.status}.`);
  }
  return result.message ?? 'Invitation sent. Assign a database role after the invited account profile is available.';
}

export async function getDashboardData(role: Role) {
  const [patients, doctors, appointments, users] = await Promise.all([
    getPatients(),
    role === 'admin' ? getDoctors() : Promise.resolve([]),
    getAppointments(),
    role === 'admin' ? getUsers() : Promise.resolve([]),
  ]);

  return {
    totalPatients: patients.length,
    totalDoctors: doctors.length,
    totalAppointments: appointments.length,
    pendingAppointments: appointments.filter((item) => item.status === 'pending').length,
    completedAppointments: appointments.filter((item) => item.status === 'completed').length,
    totalUsers: users.length,
  };
}
