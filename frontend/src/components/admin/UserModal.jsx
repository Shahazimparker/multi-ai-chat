// ============================================================
// FILE: frontend/src/components/admin/UserModal.jsx
// PURPOSE: Create/Edit user modal for admin panel
//          Handles all user fields: tokens, limits, expiry, role
// ============================================================

import React, { useState, useEffect } from 'react';
import { X, Save } from 'lucide-react';
import './UserModal.css';

const DEFAULT_FORM = {
  username: '', email: '', password: '', role: 'user',
  total_tokens: 100000, per_query_limit: 2000,
  session_minutes: 60, is_active: true, expires_at: '',
};

const UserModal = ({ user, onSave, onClose, saving }) => {
  const isEdit = !!user;
  const [form, setForm] = useState(DEFAULT_FORM);

  // Pre-fill when editing
  useEffect(() => {
    if (user) {
      setForm({
        ...DEFAULT_FORM, ...user,
        password: '',   // never pre-fill password
        expires_at: user.expires_at ? user.expires_at.slice(0, 10) : '',
      });
    }
  }, [user]);

  const set = (key, val) => setForm(p => ({ ...p, [key]: val }));

  const handleSubmit = (e) => {
    e.preventDefault();
    const payload = { ...form };
    if (!payload.password) delete payload.password;     // omit if empty (edit mode)
    if (!payload.expires_at) payload.expires_at = null; // null = never expire
    onSave(payload, isEdit);
  };

  return (
    <div className="modal-overlay" onClick={e => e.target === e.currentTarget && onClose()}>
      <div className="modal-box">
        <div className="modal-header">
          <h3>{isEdit ? 'Edit User' : 'Create User'}</h3>
          <button className="modal-close" onClick={onClose}><X size={16}/></button>
        </div>

        <form onSubmit={handleSubmit} className="modal-form">
          <div className="form-row">
            <label>Username *
              <input value={form.username} onChange={e => set('username', e.target.value)} required />
            </label>
            <label>Email *
              <input type="email" value={form.email} onChange={e => set('email', e.target.value)} required />
            </label>
          </div>

          <div className="form-row">
            <label>{isEdit ? 'New Password (leave blank to keep)' : 'Password *'}
              <input
                type="password" value={form.password}
                onChange={e => set('password', e.target.value)}
                required={!isEdit}
                placeholder={isEdit ? 'Leave blank to keep current' : ''}
              />
            </label>
            <label>Role
              <select value={form.role} onChange={e => set('role', e.target.value)}>
                <option value="user">User</option>
                <option value="admin">Admin</option>
              </select>
            </label>
          </div>

          <div className="form-row">
            <label>Total Token Quota
              <input type="number" min="0" value={form.total_tokens} onChange={e => set('total_tokens', +e.target.value)} />
            </label>
            <label>Per Query Limit (tokens)
              <input type="number" min="100" value={form.per_query_limit} onChange={e => set('per_query_limit', +e.target.value)} />
            </label>
          </div>

          <div className="form-row">
            <label>Session Duration (minutes)
              <input type="number" min="5" value={form.session_minutes} onChange={e => set('session_minutes', +e.target.value)} />
            </label>
            <label>Account Expiry (blank = never)
              <input type="date" value={form.expires_at} onChange={e => set('expires_at', e.target.value)} />
            </label>
          </div>

          <label className="checkbox-label">
            <input type="checkbox" checked={form.is_active} onChange={e => set('is_active', e.target.checked)} />
            Account is Active
          </label>

          <div className="modal-footer">
            <button type="button" className="btn-cancel" onClick={onClose} disabled={saving}>Cancel</button>
            <button type="submit" className="btn-save" disabled={saving}>
              <Save size={14}/> {saving ? 'Saving…' : (isEdit ? 'Save Changes' : 'Create User')}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
};

export default UserModal;
