import { NavLink, Outlet } from 'react-router-dom';
import {
  Activity,
  CalendarDays,
  CreditCard,
  FileText,
  FlaskConical,
  HeartPulse,
  Pill,
  Settings,
  ShieldCheck,
  Stethoscope,
  Users,
} from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import type { Role } from '../types';

const navByRole: Record<Role, { label: string; to: string; icon: typeof Activity }[]> = {
  admin: [
    { label: 'Dashboard', to: '/admin', icon: Activity },
    { label: 'Users', to: '/admin/users', icon: Users },
    { label: 'Patients', to: '/admin/patients', icon: HeartPulse },
    { label: 'Doctors', to: '/admin/doctors', icon: Stethoscope },
    { label: 'Doctor assignments', to: '/admin/doctor-assignments', icon: Users },
    { label: 'Appointments', to: '/admin/appointments', icon: CalendarDays },
    { label: 'Billing', to: '/admin/billing', icon: CreditCard },
    { label: 'Settings', to: '/admin/settings', icon: Settings },
  ],
  receptionist: [
    { label: 'Dashboard', to: '/reception', icon: Activity },
    { label: 'Patients', to: '/reception/patients', icon: Users },
    { label: 'Appointments', to: '/reception/appointments', icon: CalendarDays },
    { label: 'Triage', to: '/reception/triage', icon: HeartPulse },
    { label: 'Billing', to: '/reception/billing', icon: CreditCard },
    { label: 'Profile', to: '/profile', icon: FileText },
  ],
  doctor: [
    { label: 'Dashboard', to: '/doctor', icon: Activity },
    { label: 'Appointments', to: '/doctor/appointments', icon: CalendarDays },
    { label: 'Patients', to: '/doctor/patients', icon: HeartPulse },
    { label: 'Records', to: '/doctor/records', icon: FileText },
    { label: 'Consultations', to: '/doctor/consultations', icon: Stethoscope },
    { label: 'Lab orders', to: '/doctor/lab-orders', icon: FlaskConical },
    { label: 'Prescriptions', to: '/doctor/prescriptions', icon: Pill },
  ],
  patient: [
    { label: 'Dashboard', to: '/patient', icon: Activity },
    { label: 'Appointments', to: '/patient/appointments', icon: CalendarDays },
    { label: 'Records', to: '/patient/records', icon: FileText },
    { label: 'Bills', to: '/patient/bills', icon: CreditCard },
    { label: 'Profile', to: '/profile', icon: Settings },
  ],
  lab_technician: [
    { label: 'Dashboard', to: '/lab', icon: Activity },
    { label: 'Pending tests', to: '/lab/pending', icon: FlaskConical },
    { label: 'Reports', to: '/lab/reports', icon: FileText },
  ],
  pharmacist: [
    { label: 'Dashboard', to: '/pharmacy', icon: Activity },
    { label: 'Inventory', to: '/pharmacy/inventory', icon: Pill },
    { label: 'Prescriptions', to: '/pharmacy/prescriptions', icon: FileText },
  ],
};

export function AppLayout() {
  const { user, logout } = useAuth();
  const role = user?.role ?? 'patient';
  const links = navByRole[role];

  return (
    <div className="app-shell">
      <aside className="sidebar">
        <div className="brand-block">
          <div className="brand-badge">C</div>
          <div>
            <div className="brand-title">Carepoint</div>
            <div className="brand-subtitle">Hospital management</div>
          </div>
        </div>

        <nav className="nav-list">
          {links.map(({ label, to, icon: Icon }) => (
            <NavLink key={to} to={to} className={({ isActive }) => `nav-item ${isActive ? 'active' : ''}`}>
              <Icon size={16} />
              <span>{label}</span>
            </NavLink>
          ))}
        </nav>

        <div className="user-card">
          <div className="user-badge"><ShieldCheck size={16} /></div>
          <div>
            <strong>{user?.full_name ?? 'Carepoint User'}</strong>
            <small>{role}</small>
          </div>
        </div>

        <button className="logout-button" type="button" onClick={() => void logout()}>
          Sign out
        </button>
      </aside>

      <main className="content-panel">
        <Outlet />
      </main>
    </div>
  );
}
