// ============================================================
// FILE: backend/middleware/tokenCheck.js
// PURPOSE: Blocks requests if user has exceeded their token quota
// ============================================================

const tokenCheck = (req, res, next) => {
  const user = req.user;

  // Every route mounting this runs requireAuth first, so a missing req.user
  // here means the auth guard was skipped, not that the caller is
  // legitimately anonymous — fail closed instead of granting quota.
  if (!user) {
    return res.status(401).json({ error: 'Authentication required' });
  }

  const remaining = user.total_tokens - user.used_tokens;

  if (remaining <= 0) {
    return res.status(429).json({
      error: 'Token quota exhausted. Contact admin for renewal.',
      used: user.used_tokens,
      total: user.total_tokens,
    });
  }

  req.tokenRemaining = remaining;
  next();
};

module.exports = { tokenCheck };
