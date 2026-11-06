import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Lock } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';

export function ResetPasswordPage() {
  const { updatePassword } = useAuth();
  const [password, setPassword] = useState('');
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    setError(null);
    try {
      await updatePassword(password);
      setDone(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Password reset failed.');
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card narrow">
        <h1>Set a new password</h1>
        <p className="muted">Choose a strong password for your Carepoint account.</p>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert error">{error}</div>}
          {done && <div className="alert success">Your password has been updated.</div>}

          <label className="field">
            <span>New password</span>
            <div className="input-wrap">
              <Lock size={16} />
              <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} required />
            </div>
          </label>

          <button type="submit" className="primary-button">Update password</button>
        </form>

        <Link className="inline-link" to="/login">Back to sign in</Link>
      </div>
    </div>
  );
}
