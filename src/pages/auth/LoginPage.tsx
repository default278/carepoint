import { useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { Eye, EyeOff, Lock, Mail } from 'lucide-react';
import { useAuth } from '../../contexts/AuthContext';
import { roleDashboardPath } from '../../types';

export function LoginPage() {
  const navigate = useNavigate();
  const { user, login, loading, error } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);

  if (user) {
    return <Navigate to={roleDashboardPath[user.role]} replace />;
  }

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault();
    const result = await login({ email, password });
    if (result) {
      navigate(roleDashboardPath[result.role]);
    }
  };

  return (
    <div className="auth-shell">
      <div className="auth-card">
        <div className="auth-header">
          <div className="brand-badge large">C</div>
          <h1>Carepoint</h1>
          <p>Secure patient and staff access</p>
        </div>

        <form onSubmit={handleSubmit} className="auth-form">
          {error && <div className="alert error">{error}</div>}

          <label className="field">
            <span>Email address</span>
            <div className="input-wrap">
              <Mail size={16} />
              <input value={email} onChange={(e) => setEmail(e.target.value)} type="email" required />
            </div>
          </label>

          <label className="field">
            <span>Password</span>
            <div className="input-wrap">
              <Lock size={16} />
              <input
                value={password}
                onChange={(e) => setPassword(e.target.value)}
                type={showPassword ? 'text' : 'password'}
                required
              />
              <button type="button" className="icon-button" onClick={() => setShowPassword((v) => !v)}>
                {showPassword ? <EyeOff size={16} /> : <Eye size={16} />}
              </button>
            </div>
          </label>

          <div className="row-between">
            <span />
            <Link to="/forgot-password">Forgot password?</Link>
          </div>

          <button type="submit" className="primary-button" disabled={loading}>
            {loading ? 'Signing in...' : 'Sign in'}
          </button>
        </form>

        <div className="auth-note">
          Sign in with your configured Supabase account. The app does not use demo credentials for live access.
        </div>
      </div>
    </div>
  );
}
