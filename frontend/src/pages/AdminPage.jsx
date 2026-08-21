// ============================================================
// FILE: frontend/src/pages/AdminPage.jsx
// PURPOSE: Admin dashboard — user CRUD, token management,
//          analytics charts (model usage, top queries, daily)
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, PieChart, Pie, Cell, Legend } from 'recharts';
import { Users, BarChart2, Plus, Trash2, Edit2, RefreshCw, LogOut, MessageSquare, Zap, ChevronLeft, Lock, Unlock, Sun, Moon } from 'lucide-react';
import { useAuth } from '../context/AuthContext';
import { useTheme } from '../context/ThemeContext';
import api from '../config/api';
import UserModal from '../components/admin/UserModal';
import { ToastStack, useToasts } from '../components/layout/Toast';
import './AdminPage.css';

const COLORS = ['#7c3aed', '#0ea5e9', '#10b981', '#f59e0b', '#ef4444', '#a78bfa'];

const AdminPage = () => {
  const { logout, refreshTokenStats } = useAuth();
  const { theme, toggleTheme } = useTheme();
  const navigate = useNavigate();
  const [tab, setTab] = useState('users');   // 'users' | 'analytics'
  const [users, setUsers] = useState([]);
  const [analytics, setAnalytics] = useState(null);
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [modal, setModal] = useState({ open: false, user: null }); // create/edit modal
  const [apiStatus, setApiStatus] = useState(null);
  const { toasts, showToast, dismissToast } = useToasts();

  // Load users
  useEffect(() => {
    if (tab === 'users') loadUsers();
    if (tab === 'analytics') loadAnalytics();
    if (tab === 'api-status') loadApiStatus();
  }, [tab]);

  const loadApiStatus = async () => {
    setLoading(true);
    try {
      const res = await api.get('/admin/api-status');
      setApiStatus(res.data);
    }
    catch { showToast('Failed to load API status'); }
    finally { setLoading(false); }
  };
  const loadUsers = async () => {
    setLoading(true);
    try { const res = await api.get('/admin/users'); setUsers(res.data.users || []); }
    catch { showToast('Failed to load users'); }
    finally { setLoading(false); }
  };

  const loadAnalytics = async () => {
    setLoading(true);
    try { const res = await api.get('/admin/analytics'); setAnalytics(res.data); }
    catch { showToast('Failed to load analytics'); }
    finally { setLoading(false); }
  };

  const handleSaveUser = async (userData, isEdit) => {
    if (saving) return; // prevent double-submit
    setSaving(true);
    try {
      if (isEdit) {
        await api.put(`/admin/users/${userData.id}`, userData);
      } else {
        await api.post('/admin/users', userData);
      }
      setModal({ open: false, user: null });
      loadUsers();
    } catch (err) {
      showToast(err.response?.data?.error || 'Save failed');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Delete this user? All their data will be lost.')) return;
    try { await api.delete(`/admin/users/${id}`); loadUsers(); }
    catch (err) { showToast(err.response?.data?.error || 'Delete failed'); }
  };

  const handleResetTokens = async (id) => {
    if (!window.confirm('Reset token usage to 0?')) return;
    try {
      await api.post(`/admin/users/${id}/reset-tokens`);
      loadUsers();
      // loadUsers() only refreshes this page's own table. If the admin just
      // reset their own account (self-service admin), the TokenBar in the
      // layout reads from AuthContext's `user`, which loadUsers() never
      // touches — refresh it too so the counter doesn't stay stale until the
      // next message or a reload.
      refreshTokenStats();
    }
    catch { showToast('Reset failed'); }
  };

  const handleUnlockLogin = async (id) => {
    try { await api.post(`/admin/users/${id}/unlock-login`); loadUsers(); }
    catch (err) { showToast(err.response?.data?.error || 'Unlock failed'); }
  };

  const handleLockLogin = async (id) => {
    if (!window.confirm('Lock this user\'s login (simulate 5 failed attempts)?')) return;
    try { await api.post(`/admin/users/${id}/lock-login`); loadUsers(); }
    catch (err) { showToast(err.response?.data?.error || 'Lock failed'); }
  };

  // Build pie data for model usage
  const modelPieData = analytics
    ? Object.entries(analytics.modelCounts).map(([name, value]) => ({ name, value }))
    : [];

  // Build daily bar data
  const dailyBarData = analytics
    ? (() => {
      const grouped = {};
      (analytics.dailyUsage || []).forEach(r => {
        const day = r.created_at?.slice(0, 10);
        if (!grouped[day]) grouped[day] = { day, queries: 0, tokens: 0 };
        grouped[day].queries++;
        grouped[day].tokens += r.tokens_used || 0;
      });
      return Object.values(grouped).slice(-7);
    })()
    : [];

  return (
    <div className="admin-root">
      {/* Sidebar */}
      <aside className="admin-sidebar">
        <div className="admin-brand">⚙ Admin</div>
        <nav className="admin-nav">
          <button className={tab === 'api-status' ? 'active' : ''} onClick={() => setTab('api-status')}>
            <Zap size={16} /> API Status
          </button>
          <button className={tab === 'users' ? 'active' : ''} onClick={() => setTab('users')}>
            <Users size={16} /> Users
          </button>
          <button className={tab === 'analytics' ? 'active' : ''} onClick={() => setTab('analytics')}>
            <BarChart2 size={16} /> Analytics
          </button>
        </nav>
        <div className="admin-footer-nav">
          <button onClick={() => navigate('/chat')}><ChevronLeft size={15} /> Back to Chat</button>
          <button onClick={toggleTheme} title={`Switch to ${theme === 'dark' ? 'light' : 'dark'} mode`}>
            {theme === 'dark' ? <Sun size={14} /> : <Moon size={14} />} {theme === 'dark' ? 'Light' : 'Dark'} Mode
          </button>
          <button onClick={() => { logout(); navigate('/login'); }} className="logout">
            <LogOut size={14} /> Logout
          </button>
        </div>
      </aside>

      {/* Main panel */}
      <main className="admin-main">
        {/* Mobile back button — visible only on small screens */}
        <button className="mobile-back-btn" onClick={() => navigate('/chat')}>
          <ChevronLeft size={16} /> Back to Chat
        </button>
        {/* ── USERS TAB ───────────────────────────────── */}
        {tab === 'users' && (
          <div className="admin-panel">
            <div className="panel-header">
              <h2><Users size={20} /> User Management</h2>
              <div className="panel-actions">
                <button className="btn-refresh" onClick={loadUsers}><RefreshCw size={14} /> Refresh</button>
                <button className="btn-create" onClick={() => setModal({ open: true, user: null })}>
                  <Plus size={14} /> Create User
                </button>
              </div>
            </div>

            {loading ? <div className="loading-text">Loading…</div> : (
              <div className="table-wrap">
                <table className="admin-table">
                  <thead>
                    <tr>
                      <th>Username</th><th>Email</th><th>Role</th>
                      <th>Status</th><th>Tokens Used</th><th>Total Tokens</th>
                      <th>Per Query</th><th>Session (min)</th><th>Expires</th>
                      <th>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {users.map(u => (
                      <tr key={u.id}>
                        <td className="td-bold">{u.username}</td>
                        <td className="td-muted">{u.email}</td>
                        <td><span className={`role-badge ${u.role}`}>{u.role}</span></td>
                        <td>
                          <span className={`status-dot ${u.is_active ? 'on' : 'off'}`}>{u.is_active ? 'Active' : 'Disabled'}</span>
                          {u.is_login_locked && <span className="lock-badge">🔒 Locked</span>}
                        </td>
                        <td>{(u.used_tokens || 0).toLocaleString()}</td>
                        <td>{(u.total_tokens || 0).toLocaleString()}</td>
                        <td>{u.per_query_limit}</td>
                        <td>{u.session_minutes}</td>
                        <td className="td-muted">{u.expires_at ? new Date(u.expires_at).toLocaleDateString() : 'Never'}</td>
                        <td>
                          <div className="td-actions">
                            <button title="Edit" onClick={() => setModal({ open: true, user: u })}><Edit2 size={13} /></button>
                            <button title="Lock Login" onClick={() => handleLockLogin(u.id)} className={u.is_login_locked ? 'lock-on' : ''}><Lock size={13} /></button>
                            <button title="Unlock Login" onClick={() => handleUnlockLogin(u.id)} className={!u.is_login_locked ? 'unlock-on' : ''}><Unlock size={13} /></button>
                            <button title="Reset Tokens" onClick={() => handleResetTokens(u.id)}><Zap size={13} /></button>
                            <button title="Delete" onClick={() => handleDelete(u.id)} className="del"><Trash2 size={13} /></button>
                          </div>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </div>
        )}

        {/* ── ANALYTICS TAB ───────────────────────────── */}
        {tab === 'analytics' && (
          <div className="admin-panel">
            <div className="panel-header">
              <h2><BarChart2 size={20} /> Analytics</h2>
              <button className="btn-refresh" onClick={loadAnalytics}><RefreshCw size={14} /> Refresh</button>
            </div>

            {loading || !analytics ? <div className="loading-text">Loading…</div> : (
              <>
                {/* Summary cards */}
                <div className="stat-cards">
                  {[
                    { label: 'Total Queries', value: analytics.summary.totalQueries.toLocaleString(), icon: <MessageSquare size={18} />, color: '#7c3aed' },
                    { label: 'Total Tokens', value: analytics.summary.totalTokens.toLocaleString(), icon: <Zap size={18} />, color: '#0ea5e9' },
                    { label: 'Cache Hits', value: analytics.summary.cacheHits.toLocaleString(), icon: <RefreshCw size={18} />, color: '#10b981' },
                    { label: 'Cache Hit Rate', value: `${analytics.summary.cacheHitRate}%`, icon: <BarChart2 size={18} />, color: '#f59e0b' },
                  ].map(c => (
                    <div key={c.label} className="stat-card" style={{ '--card-color': c.color }}>
                      <div className="stat-icon">{c.icon}</div>
                      <div className="stat-val">{c.value}</div>
                      <div className="stat-lbl">{c.label}</div>
                    </div>
                  ))}
                </div>

                {/* Charts row */}
                <div className="charts-row">
                  {/* Daily queries bar chart */}
                  <div className="chart-box">
                    <h3>Daily Queries (Last 7 Days)</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <BarChart data={dailyBarData}>
                        <XAxis dataKey="day" tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                        <YAxis tick={{ fill: 'rgba(255,255,255,0.4)', fontSize: 11 }} />
                        <Tooltip contentStyle={{ background: '#0f1629', border: '1px solid rgba(255,255,255,0.1)', borderRadius: '10px', color: '#fff' }} />
                        <Bar dataKey="queries" fill="#7c3aed" radius={[4, 4, 0, 0]} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>

                  {/* Model usage pie */}
                  <div className="chart-box">
                    <h3>Model Usage Distribution</h3>
                    <ResponsiveContainer width="100%" height={220}>
                      <PieChart>
                        <Pie
                          data={modelPieData}
                          cx="50%"
                          cy="50%"
                          outerRadius={80}
                          dataKey="value"
                          label={false}
                        >
                          {modelPieData.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
                        </Pie>
                        <Legend />
                        <Tooltip />
                      </PieChart>
                    </ResponsiveContainer>
                  </div>
                </div>
                {/* Top queries table */}
                <div className="top-queries">
                  <h3>Most Repeated Queries (Cache)</h3>
                  <table className="admin-table">
                    <thead><tr><th>#</th><th>Query</th><th>Model</th><th>Hit Count</th><th>Last Hit</th></tr></thead>
                    <tbody>
                      {analytics.topQueries.slice(0, 10).map((q, i) => (
                        <tr key={q.id || i}>
                          <td className="td-muted">{i + 1}</td>
                          <td>{q.query_text?.slice(0, 80)}{q.query_text?.length > 80 ? '…' : ''}</td>
                          <td className="td-muted">{q.model}</td>
                          <td><span className="hit-badge">{q.hit_count}×</span></td>
                          <td className="td-muted">{q.last_hit_at ? new Date(q.last_hit_at).toLocaleDateString() : '—'}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </>
            )}
          </div>
        )}
        {tab === 'api-status' && (
          <div className="admin-panel">
            <div className="panel-header">
              <h2><Zap size={20} /> API Status</h2>
              <button className="btn-refresh" onClick={loadApiStatus}><RefreshCw size={14} /> Refresh</button>
            </div>
            {loading || !apiStatus ? <div className="loading-text">Loading…</div> : (
              <div className="status-grid">
                {Object.entries(apiStatus).map(([key, value]) => (
                  <div key={key} className="status-card">
                    <div className={`status-indicator ${value === 'active' ? 'active' : 'inactive'}`}></div>
                    <span className="status-name">{key.toUpperCase()}</span>
                    <span className="status-value">{value}</span>
                  </div>
                ))}
              </div>
            )}
          </div>
        )}
      </main>

      {/* User create/edit modal */}
      {modal.open && (
        <UserModal
          user={modal.user}
          onSave={handleSaveUser}
          onClose={() => setModal({ open: false, user: null })}
          saving={saving}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
};

export default AdminPage;
