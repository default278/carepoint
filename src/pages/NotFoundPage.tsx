import { SearchX } from 'lucide-react';
import { Link } from 'react-router-dom';

export function NotFoundPage() {
  return (
    <div className="empty-state-card">
      <SearchX size={42} />
      <h1>Page not found</h1>
      <p>The route you requested does not exist in Carepoint.</p>
      <Link to="/login" className="primary-button inline-button">Go home</Link>
    </div>
  );
}
