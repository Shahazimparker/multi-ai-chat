// ============================================================
// FILE: frontend/src/pages/LoginPage.jsx
// PURPOSE: Login form with "Continue Anonymously" option
// ============================================================

import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../context/AuthContext';
import ThemeToggle from '../components/layout/ThemeToggle';
import { Sparkles, Lock, User, Eye, EyeOff, Ghost } from 'lucide-react';
import './LoginPage.css';

const LoginPage = () => {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [form, setForm] = useState({ username: '', password: '' });
  const [showPwd, setShowPwd] = useState(false);
  const [remember, setRemember] = useState(false);
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(''); setLoading(true);
    try {
      const user = await login(form.username, form.password, remember);
      navigate(user.role === 'admin' ? '/admin' : '/chat');
    } catch (err) {
      setError(err.response?.data?.error || 'Login failed. Check credentials.');
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="login-root">
      {/* Theme toggle - top right */}
      <div style={{ position: 'absolute', top: '20px', right: '20px', zIndex: 100 }}>
        <ThemeToggle />
      </div>

      {/* Animated background orbs */}
      <div className="orb orb-1" /><div className="orb orb-2" />
      <div className="orb orb-3" /><div className="orb orb-4" />

      <div className="login-card">
        {/* Logo */}
        <div className="login-logo">
          <Sparkles size={32} className="logo-icon" />
          <span className="logo-text">Miles <span className="logo-accent">Intelligence</span></span>
        </div>
        <p className="login-sub">Unified AI models in one place</p>

        {/* AI model pills */}
        <div className="model-pills">
          {['Gemini', 'Groq', 'Mistral', 'Claude'].map(m => (
            <span key={m} className="pill">{m}</span>
          ))}
        </div>

        {error && <div className="login-error">{error}</div>}

        <form onSubmit={handleSubmit} className="login-form">
          <div className="input-group">
            <User size={16} className="input-icon" />
            <input
              type="text"
              placeholder="Username or Email"
              value={form.username}
              onChange={e => setForm(p => ({ ...p, username: e.target.value }))}
              required autoFocus
            />
          </div>

          <div className="input-group">
            <Lock size={16} className="input-icon" />
            <input
              type={showPwd ? 'text' : 'password'}
              placeholder="Password"
              value={form.password}
              onChange={e => setForm(p => ({ ...p, password: e.target.value }))}
              required
            />
            <button type="button" className="eye-btn" onClick={() => setShowPwd(p => !p)}>
              {showPwd ? <EyeOff size={14} /> : <Eye size={14} />}
            </button>
          </div>

          <label className="remember-label">
            <input type="checkbox" checked={remember} onChange={e => setRemember(e.target.checked)} />
            <span>Remember me</span>
          </label>

          <button type="submit" className="btn-login" disabled={loading}>
            {loading ? <span className="btn-spinner" /> : 'Sign In'}
          </button>
        </form>

        <div className="login-divider"><span>or</span></div>

        <button className="btn-anonymous" onClick={() => navigate('/anonymous')}>
          <Ghost size={16} />
          Continue Anonymously
          <span className="anon-note">No account needed · No history saved</span>
        </button>
      </div>
    </div>
  );
};

export default LoginPage;
