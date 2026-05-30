// ============================================================
// FILE: backend/middleware/auth.js
// PURPOSE: Verifies JWT token on protected routes
//          Also checks session validity and account expiry
// ============================================================

const jwt      = require('jsonwebtoken');
const supabase = require('../config/supabase');
const AUTH_COOKIE_NAME = 'auth_token';

const getCookieValue = (cookieHeader, key) => {
  if (!cookieHeader) return null;
  const parts = String(cookieHeader).split(';');
  for (const part of parts) {
    const [rawKey, ...rest] = part.trim().split('=');
    if (rawKey === key) return decodeURIComponent(rest.join('='));
  }
  return null;
};

// ── Verify JWT + session + account expiry ──────────────────
const requireAuth = async (req, res, next) => {
  try {
    const authHeader = req.headers.authorization;
    const bearerToken = authHeader?.startsWith('Bearer ') ? authHeader.split(' ')[1] : null;
    const cookieToken = getCookieValue(req.headers.cookie, AUTH_COOKIE_NAME);
    const token = bearerToken || cookieToken;
    if (!token) {
      return res.status(401).json({ error: 'No token provided' });
    }
    const decoded = jwt.verify(token, process.env.JWT_SECRET);

    // Fetch fresh user data from DB (check is_active, expires_at)
    const { data: user, error } = await supabase
      .from('users')
      .select('id, email, username, role, is_active, expires_at, total_tokens, used_tokens, per_query_limit, session_minutes')
      .eq('id', decoded.userId)
      .single();

    if (error || !user) return res.status(401).json({ error: 'User not found' });
    if (!user.is_active)  return res.status(403).json({ error: 'Account disabled' });

    // Check account expiry
    if (user.expires_at && new Date(user.expires_at) < new Date()) {
      return res.status(403).json({ error: 'Account expired' });
    }

    req.user = user;  // attach user to request object
    next();
  } catch (err) {
    if (err.name === 'TokenExpiredError') {
      return res.status(401).json({ error: 'Session expired. Please login again.' });
    }
    return res.status(401).json({ error: 'Invalid token' });
  }
};

// ── Admin-only guard (use after requireAuth) ───────────────
const requireAdmin = (req, res, next) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ error: 'Admin access required' });
  }
  next();
};

module.exports = { requireAuth, requireAdmin };
