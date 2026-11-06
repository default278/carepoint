import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function ForgotPasswordPage() {
  const { resetPassword } = useAuth();
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await resetPassword(email);
      setSent(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Unable to request a reset link.');
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card narrow">
        <h1>Recover access</h1>
        <p className="muted">Enter the email used for your Carepoint account.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert error">{error}</div>}
          {sent && <div className="alert success">A password reset email has been requested.</div>}

          <label className="field">
            <span>Email address</span>
            <div className="input-wrap">
              <Mail size={16} />
              <input type="email" value={email} onChange={(e) => setEmail(e.target.value)} required />
            </div>
          </label>

          <button type="submit" className="primary-button">Send reset link</button>
        </form>

        <Link className="inline-link" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
