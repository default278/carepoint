import { BrowserRouter, Navigate, Route, Routes } from 'react-router-dom';
import { AuthProvider } from './contexts/AuthContext';
import { AppLayout } from './components/Layout';
import { ProtectedRoute } from './components/ProtectedRoute';
import { LoginPage } from './pages/auth/LoginPage';
import { ForgotPasswordPage } from './pages/auth/ForgotPasswordPage';
import { ResetPasswordPage } from './pages/auth/ResetPasswordPage';
import {
  AdminAppointmentsPage,
  AdminBillingPage,
  AdminDoctorAssignmentsPage,
  AdminDashboardPage,
  AdminDoctorsPage,
  AdminPatientsPage,
  AdminSettingsPage,
  AdminUsersPage,
  CreateUserPage,
  DoctorAppointmentsPage,
  DoctorConsultationsPage,
  DoctorDashboardPage,
  DoctorLabOrdersPage,
  DoctorPatientsPage,
  DoctorPrescriptionsPage,
  DoctorRecordsPage,
  LabDashboardPage,
  LabPendingPage,
  LabReportsPage,
  PatientAppointmentsPage,
  PatientBillsPage,
  PatientDashboardPage,
  PatientRecordsPage,
  PharmacyDashboardPage,
  PharmacyInventoryPage,
  PharmacyPrescriptionsPage,
  ProfilePage,
  ReceptionAppointmentsPage,
  ReceptionBillingPage,
  ReceptionDashboardPage,
  ReceptionPatientsPage,
  ReceptionTriagePage,
} from './pages/RolePages';
import { NotFoundPage } from './pages/NotFoundPage';
import { UnauthorizedPage } from './pages/UnauthorizedPage';

function App() {
  return (
    <BrowserRouter>
      <AuthProvider>
        <Routes>
          <Route path="/login" element={<LoginPage />} />
          <Route path="/forgot-password" element={<ForgotPasswordPage />} />
          <Route path="/reset-password" element={<ResetPasswordPage />} />
          <Route path="/unauthorized" element={<UnauthorizedPage />} />
          <Route path="/" element={<Navigate to="/login" replace />} />

          <Route element={<ProtectedRoute><AppLayout /></ProtectedRoute>}>
            <Route path="/admin" element={<ProtectedRoute role="admin"><AdminDashboardPage /></ProtectedRoute>} />
            <Route path="/admin/users" element={<ProtectedRoute role="admin"><AdminUsersPage /></ProtectedRoute>} />
            <Route path="/admin/users/create" element={<ProtectedRoute role="admin"><CreateUserPage /></ProtectedRoute>} />
            <Route path="/admin/patients" element={<ProtectedRoute role="admin"><AdminPatientsPage /></ProtectedRoute>} />
            <Route path="/admin/doctors" element={<ProtectedRoute role="admin"><AdminDoctorsPage /></ProtectedRoute>} />
            <Route path="/admin/doctor-assignments" element={<ProtectedRoute role="admin"><AdminDoctorAssignmentsPage /></ProtectedRoute>} />
            <Route path="/admin/appointments" element={<ProtectedRoute role="admin"><AdminAppointmentsPage /></ProtectedRoute>} />
            <Route path="/admin/billing" element={<ProtectedRoute role="admin"><AdminBillingPage /></ProtectedRoute>} />
            <Route path="/admin/settings" element={<ProtectedRoute role="admin"><AdminSettingsPage /></ProtectedRoute>} />

            <Route path="/reception" element={<ProtectedRoute role="receptionist"><ReceptionDashboardPage /></ProtectedRoute>} />
            <Route path="/reception/patients" element={<ProtectedRoute role="receptionist"><ReceptionPatientsPage /></ProtectedRoute>} />
            <Route path="/reception/appointments" element={<ProtectedRoute role="receptionist"><ReceptionAppointmentsPage /></ProtectedRoute>} />
            <Route path="/reception/triage" element={<ProtectedRoute role="receptionist"><ReceptionTriagePage /></ProtectedRoute>} />
            <Route path="/reception/billing" element={<ProtectedRoute role="receptionist"><ReceptionBillingPage /></ProtectedRoute>} />

            <Route path="/doctor" element={<ProtectedRoute role="doctor"><DoctorDashboardPage /></ProtectedRoute>} />
            <Route path="/doctor/appointments" element={<ProtectedRoute role="doctor"><DoctorAppointmentsPage /></ProtectedRoute>} />
            <Route path="/doctor/patients" element={<ProtectedRoute role="doctor"><DoctorPatientsPage /></ProtectedRoute>} />
            <Route path="/doctor/records" element={<ProtectedRoute role="doctor"><DoctorRecordsPage /></ProtectedRoute>} />
            <Route path="/doctor/consultations" element={<ProtectedRoute role="doctor"><DoctorConsultationsPage /></ProtectedRoute>} />
            <Route path="/doctor/lab-orders" element={<ProtectedRoute role="doctor"><DoctorLabOrdersPage /></ProtectedRoute>} />
            <Route path="/doctor/prescriptions" element={<ProtectedRoute role="doctor"><DoctorPrescriptionsPage /></ProtectedRoute>} />

            <Route path="/patient" element={<ProtectedRoute role="patient"><PatientDashboardPage /></ProtectedRoute>} />
            <Route path="/patient/appointments" element={<ProtectedRoute role="patient"><PatientAppointmentsPage /></ProtectedRoute>} />
            <Route path="/patient/records" element={<ProtectedRoute role="patient"><PatientRecordsPage /></ProtectedRoute>} />
            <Route path="/patient/bills" element={<ProtectedRoute role="patient"><PatientBillsPage /></ProtectedRoute>} />

            <Route path="/lab" element={<ProtectedRoute role="lab_technician"><LabDashboardPage /></ProtectedRoute>} />
            <Route path="/lab/pending" element={<ProtectedRoute role="lab_technician"><LabPendingPage /></ProtectedRoute>} />
            <Route path="/lab/reports" element={<ProtectedRoute role="lab_technician"><LabReportsPage /></ProtectedRoute>} />
            <Route path="/pharmacy" element={<ProtectedRoute role="pharmacist"><PharmacyDashboardPage /></ProtectedRoute>} />
            <Route path="/pharmacy/inventory" element={<ProtectedRoute role="pharmacist"><PharmacyInventoryPage /></ProtectedRoute>} />
            <Route path="/pharmacy/prescriptions" element={<ProtectedRoute role="pharmacist"><PharmacyPrescriptionsPage /></ProtectedRoute>} />

            <Route path="/profile" element={<ProtectedRoute><ProfilePage /></ProtectedRoute>} />
          </Route>

          <Route path="*" element={<NotFoundPage />} />
        </Routes>
      </AuthProvider>
    </BrowserRouter>
  );
}

export default App;
