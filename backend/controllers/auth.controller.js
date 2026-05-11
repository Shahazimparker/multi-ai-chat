// ============================================================
// FILE: backend/controllers/auth.controller.js
// PURPOSE: Handles login, logout, session verification
//          Returns JWT token on successful login
// ============================================================

const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const supabase = require('../config/supabase');

/**
 * POST /api/auth/login
 * Body: { username, password }
 */
const login = async (req, res) => {
  try {
    const { username, password } = req.body;
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Fetch user by username or email
    const { data: user, error } = await supabase
      .from('users')
      .select('*')
      .or(`username.ilike.${username},email.ilike.${username}`)
      .single();

    if (error || !user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Check account status
    if (!user.is_active) {
      return res.status(403).json({ error: 'Account is disabled' });
    }
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Account has expired' });
    }

    // Verify password
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create JWT — expires based on user's session_minutes setting
    const expiresInSeconds = (user.session_minutes || 60) * 60;
    const token = jwt.sign(
      { userId: user.id, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: expiresInSeconds }
    );

    // Return user info (no sensitive fields)
    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        email: user.email,
        role: user.role,
        total_tokens: user.total_tokens,
        used_tokens: user.used_tokens,
        per_query_limit: user.per_query_limit,
        expires_at: user.expires_at,
      },

    });
  } catch (err) {
    console.error('[Auth] Login error:', err.message);
    res.status(500).json({ error: 'Login failed' });
  }
};

/**
 * GET /api/auth/me — returns current user data (token stats refreshed)
 */
const getMe = async (req, res) => {
  const { data: user } = await supabase
    .from('users')
    .select('id, username, email, role, total_tokens, used_tokens, per_query_limit, expires_at')
    .eq('id', req.user.id)
    .single();

  res.json({ user });
};

/**
 * POST /api/auth/logout — client should discard JWT; we just confirm
 */
const logout = (req, res) => {
  res.json({ message: 'Logged out successfully' });
};

module.exports = { login, getMe, logout };
