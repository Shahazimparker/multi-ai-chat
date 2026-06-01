const Sentry = require('@sentry/node');

const initSentry = (app) => {
  if (!process.env.SENTRY_DSN) {
    console.log('Sentry DSN not configured - error tracking disabled');
    return;
  }

  Sentry.init({
    dsn: process.env.SENTRY_DSN,
    environment: process.env.NODE_ENV || 'development',
    integrations: [
      Sentry.expressIntegration(),
      Sentry.captureConsoleIntegration({ levels: ['error', 'warn'] }),
    ],
    // Performance Monitoring
    tracesSampleRate: process.env.NODE_ENV === 'production' ? 0.1 : 1.0,
    // Release tracking
    release: process.env.npm_package_version,
    // Filter out sensitive data
    beforeSend(event, hint) {
      // Remove sensitive headers
      if (event.request?.headers) {
        delete event.request.headers.authorization;
        delete event.request.headers.cookie;
      }
      return event;
    },
  });

  console.log('✅ Sentry initialized for error tracking');
};

// v8: expressIntegration() handles request/tracing automatically
const sentryRequestHandler = () => (req, res, next) => next();
const sentryTracingHandler = () => (req, res, next) => next();
const sentryErrorHandler = () => {
  if (!process.env.SENTRY_DSN) return (err, req, res, next) => next();
  return (err, req, res, next) => {
    Sentry.captureException(err);
    next(err);
  };
};

module.exports = {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
  Sentry,
};
