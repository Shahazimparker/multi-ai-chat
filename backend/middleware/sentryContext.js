const { Sentry } = require('../config/sentry');

/**
 * Middleware to add user context to Sentry errors
 */
const sentryUserContext = (req, res, next) => {
  if (req.user && Sentry) {
    Sentry.setUser({
      id: req.user.id,
      username: req.user.username,
      email: req.user.email,
    });
  }
  next();
};

/**
 * Capture exception to Sentry with additional context
 */
const captureException = (error, context = {}) => {
  if (Sentry) {
    Sentry.captureException(error, {
      extra: context,
    });
  }
  console.error('[Sentry]', error.message, context);
};

/**
 * Capture message to Sentry
 */
const captureMessage = (message, level = 'info', context = {}) => {
  if (Sentry) {
    Sentry.captureMessage(message, {
      level,
      extra: context,
    });
  }
  console.log(`[Sentry] ${level.toUpperCase()}:`, message, context);
};

module.exports = {
  sentryUserContext,
  captureException,
  captureMessage,
};
