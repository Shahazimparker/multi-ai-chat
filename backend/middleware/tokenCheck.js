// ============================================================
// FILE: backend/middleware/tokenCheck.js
// PURPOSE: Blocks requests if user has exceeded their token quota
// ============================================================

const tokenCheck = (req, res, next) => {
  const user = req.user;
  if (!user) return next(); // anonymous — skip

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
