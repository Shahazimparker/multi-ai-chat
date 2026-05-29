// ============================================================
// FILE: backend/middleware/tokenCheck.js
// PURPOSE: Blocks requests if user has exceeded their token quota
// ============================================================

const ANONYMOUS_TOKEN_LIMIT = parseInt(process.env.ANONYMOUS_TOKEN_LIMIT, 10) || 10000;

const tokenCheck = (req, res, next) => {
  const user = req.user;

  if (!user) {
    // Anonymous users get a hard token cap per request session
    req.tokenRemaining = ANONYMOUS_TOKEN_LIMIT;
    return next();
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
