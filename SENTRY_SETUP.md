# Sentry Integration Guide

Sentry error tracking has been integrated into both frontend and backend of your multi-ai-chat application.

## What Was Added

### Backend (`backend/`)
1. **Dependencies** (`package.json`)
   - `@sentry/node` - Core Sentry SDK for Node.js
   - `@sentry/profiling-node` - Performance profiling

2. **Configuration** (`config/sentry.js`)
   - Sentry initialization with Express integration
   - Request/tracing handlers
   - Error filtering and data sanitization
   - Environment-based sampling rates

3. **Server Integration** (`server.js`)
   - Sentry middleware (request, tracing, error handlers)
   - Global exception capturing
   - Unhandled rejection tracking

4. **Middleware** (`middleware/sentryContext.js`)
   - User context tracking
   - Helper functions for manual error capturing

### Frontend (`frontend/`)
1. **Dependencies** (`package.json`)
   - `@sentry/react` - Sentry SDK for React applications

2. **Initialization** (`src/index.jsx`)
   - Browser error tracking
   - Performance monitoring
   - Session replay for debugging

## Setup Instructions

### 1. Create Sentry Account
1. Go to [sentry.io](https://sentry.io)
2. Sign up for a free account
3. Create a new project

### 2. Get Your DSN
1. After creating a project, copy the DSN (Data Source Name)
2. It looks like: `https://xxxxx@xxxxx.ingest.sentry.io/xxxxx`

### 3. Configure Environment Variables

#### Backend (`backend/.env`)
```bash
SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
NODE_ENV=production  # or development
```

#### Frontend (`frontend/.env.local`)
```bash
REACT_APP_SENTRY_DSN=https://xxxxx@xxxxx.ingest.sentry.io/xxxxx
```

### 4. Install Dependencies

```bash
# Backend
cd backend
npm install

# Frontend
cd frontend
npm install
```

### 5. Test the Integration

The integration will automatically track:

#### Backend Errors:
- API errors (500+ status codes)
- Database failures
- AI service errors
- Authentication issues
- Unhandled exceptions

#### Frontend Errors:
- React component errors
- Network failures
- JavaScript exceptions
- Performance issues

## What Gets Tracked

### Backend
- **Errors**: All errors with status >= 500
- **Performance**: API response times, database queries
- **Context**: User info, request details (sanitized)
- **Profiling**: CPU usage, memory allocation

### Frontend
- **Errors**: JavaScript exceptions, React errors
- **Performance**: Page loads, API calls
- **Replay**: Session recordings for errors (10% sample rate)
- **User Actions**: Clicks, navigation (breadcrumbs)

## Manual Error Tracking (Optional)

### Backend
```javascript
const { captureException, captureMessage } = require('./middleware/sentryContext');

// Capture custom error
try {
  // your code
} catch (error) {
  captureException(error, { 
    userId: user.id, 
    action: 'custom_action' 
  });
}

// Log custom message
captureMessage('Important event occurred', 'warning', { 
  details: 'additional context' 
});
```

### Frontend
```javascript
import * as Sentry from '@sentry/react';

// Capture error
Sentry.captureException(error);

// Log message
Sentry.captureMessage('User performed action');

// Add user context
Sentry.setUser({ id: user.id, email: user.email });
```

## Privacy & Security

### Data Sanitization
- Authorization headers are removed
- Cookies are filtered out
- Sensitive user data is masked

### Sample Rates (Production)
- Error tracking: 100%
- Performance monitoring: 10%
- Session replay: 10% (100% on errors)

## Monitoring Dashboard

After deployment, visit your Sentry dashboard to:
- View real-time errors
- Track performance metrics
- Watch session replays
- Set up alert notifications
- Analyze error trends

## Cost Optimization

Free tier includes:
- 5,000 errors/month
- 10,000 performance units/month
- 50 replays/month

For production apps, adjust sample rates in:
- `backend/config/sentry.js`
- `frontend/src/index.jsx`

## Troubleshooting

### Backend not sending errors?
1. Check `SENTRY_DSN` is set in `.env`
2. Verify `NODE_ENV` is set
3. Look for "✅ Sentry initialized" in console

### Frontend not tracking?
1. Check `REACT_APP_SENTRY_DSN` in `.env.local`
2. Rebuild app after adding env vars
3. Check browser console for Sentry logs

### No errors showing up?
- Test by throwing an error intentionally
- Check Sentry project filters
- Verify DSN matches your project

## Next Steps

1. Set up email/Slack notifications in Sentry
2. Configure release tracking for deployments
3. Set up custom alerts for critical errors
4. Review performance bottlenecks
5. Use session replays to debug user issues

---

**Note**: Sentry will only activate if `SENTRY_DSN` environment variables are set. This allows running the app without Sentry during development if desired.
