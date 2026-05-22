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
      // HTTP integration for Express
      new Sentry.Integrations.Http({ tracing: true }),
      // Express integration
      new Sentry.Integrations.Express({ app }),
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

const sentryRequestHandler = () => {
  if (!process.env.SENTRY_DSN) return (req, res, next) => next();
  return Sentry.Handlers.requestHandler();
};
const sentryTracingHandler = () => {
  if (!process.env.SENTRY_DSN) return (req, res, next) => next();
  return Sentry.Handlers.tracingHandler();
};
const sentryErrorHandler = () => {
  if (!process.env.SENTRY_DSN) return (err, req, res, next) => next();
  return Sentry.Handlers.errorHandler({
    shouldHandleError(error) {
      const status = error.status || error.statusCode || 500;
      return status >= 500;
    },
  });
};

module.exports = {
  initSentry,
  sentryRequestHandler,
  sentryTracingHandler,
  sentryErrorHandler,
  Sentry,
};
