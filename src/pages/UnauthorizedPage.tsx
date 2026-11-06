import { ShieldAlert } from 'lucide-react';
import { Link } from 'react-router-dom';

export function UnauthorizedPage() {
  return (
    <div className="empty-state-card">
      <ShieldAlert size={42} />
      <h1>Access denied</h1>
      <p>Your account role does not have permission to view this page.</p>
      <Link to="/login" className="primary-button inline-button">Return to login</Link>
    </div>
  );
}
