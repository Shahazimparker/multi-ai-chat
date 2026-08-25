# E2E Test Coverage Summary

## Overview
This document provides a comprehensive overview of all E2E tests (mock and real) for the Multi-AI Chat application.

---

## Test Statistics

### Mock Tests (in-memory mock API)
- **Directory**: `e2e/`
- **Total**: 17 tests across 5 spec files
- **Status**: ALL PASSING

### Real Tests (live backend + frontend)
- **Directory**: `e2e-real/`
- **Total**: 17 tests across 5 spec files
- **Status**: Live test suite for real API validation

---

## Mock E2E Tests (`e2e/`)

### `auth.spec.ts` (4 tests)
1. Redirects protected routes to login when unauthenticated
2. Shows login error for invalid credentials
3. Logs in as user and logs out back to login
4. Logs in as admin and lands on admin page

**Coverage**: Authentication, route protection, login/logout

---

### `chat.spec.ts` (4 tests)
1. Sends a normal chat message using deepseek-v4-flash
2. Shows clarification form for vague artifact requests
3. Approves generated artifact from approval prompt
4. Starts a new chat from the sidebar

**Coverage**: Chat messaging, clarification forms, approval flow, sidebar navigation

---

### `artifacts.spec.ts` (3 tests)
1. Uploads a file and sends a chat message with deepseek-v4-flash selected
2. Shows and filters artifacts in the sidebar
3. Deletes an artifact from the sidebar

**Coverage**: File uploads, artifact sidebar, filtering, deletion

---

### `admin.spec.ts` (4 tests)
1. Loads admin tabs and analytics
2. Creates a user from admin
3. Edits and manages an existing user
4. Deletes a user from admin

**Coverage**: Admin user management, CRUD operations, analytics dashboard

---

### `model-selector.spec.ts` (2 tests)
1. Model picker sits under the composer and picks model + effort together
2. Mobile sheet expands the levels inline

**Coverage**: Model selection modal, effort levels, responsive drawer

---

## Real E2E Tests (`e2e-real/`)

### `auth.real.spec.ts` (3 tests)
1. Redirects unauthenticated users to login
2. Logs in as configured real user and can log out
3. Configured admin user can reach admin page

**Coverage**: Real backend authentication, login/logout, admin route validation

---

### `artifacts.real.spec.ts` (2 tests)
1. Uploads a real text file and receives a non-error assistant response
2. Artifacts sidebar opens and search input is usable

**Coverage**: Real file uploads, sidebar operations

---

### `chat.real.spec.ts` (5 tests)
1. Chat screen uses deepseek-v4-flash by default
2. Sends a real chat message and receives a live response
3. Vague PPT request shows clarification box
4. Approval prompt can be rejected cleanly
5. Existing chats can be opened and new chat can be started

**Coverage**: Real chat messaging, default model, streaming, topic switching

---

### `admin.real.spec.ts` (2 tests)
1. Admin tabs load against the real backend
2. Destructive admin mutation flow is opt-in only

**Coverage**: Real admin dashboard operations and mutation safety

---

### `approval.real.spec.ts` (5 tests)
1. Approval prompt appears for image generation request
2. Can provide instructions via "Other" button
3. Can approve after instructions (revised approval)
4. Can reject approval request
5. Approval prompt shows correct tool labels

**Coverage**: Complete approval flow with instructions, revisions, tool labels, and rejection

---

## Features Tested by Category

### Authentication & Authorization
- Login/logout with JWT cookie session
- Double-submit CSRF protection
- Protected route redirection
- Invalid credentials handling
- Admin role validation

### Chat Functionality
- Real token streaming
- 17 models with default model selection (`ministral-8b`)
- Reasoning effort levels and collapsible Thought Process panel
- Per-chat web search toggle and KB collection selector
- Sidebar chat history and topic switching

### Knowledge Base & File Handling
- File uploads and artifact management
- Artifact filtering and deletion
- Collection attachment and citation retrieval
- OCR and vision extraction pipelines

### Approval Flow
- Clarification form for vague artifact prompts
- Inline approval prompt card (Yes / Other / No)
- User instructions via "Other" button
- Revised approval after instruction submission
- Rejection of approval
- Tool-specific labels (Image, PPT, PDF, Excel, DOCX, CSV, Chart, HTML, JSON, Markdown)

### Admin Dashboard
- SQL-aggregated analytics totals
- User creation, editing, quota updates, and deletion
- Provider API status

---

## Setup Instructions

### Running Mock Tests
```bash
npm run e2e:mock
```

### Running Real Tests
```bash
# Set credentials
$env:REAL_TEST_USERNAME = "test"
$env:REAL_TEST_PASSWORD = "Welcome@1234"

# Run tests
npm run e2e
```

---

## Test Files Location

- Mock tests: `e2e/*.spec.ts`
- Real tests: `e2e-real/*.real.spec.ts`
- Playwright config: `playwright.config.ts`
- Real config: `playwright.real.config.ts`
- Test utilities: `e2e-real/support/realHelpers.ts`

---

## Related Documentation

- Comprehensive test guide: [`TESTING.md`](./TESTING.md)
- Status report: [`E2E_TEST_STATUS.md`](./E2E_TEST_STATUS.md)
- Complete tests list: [`E2E_TESTS_COMPLETE_LIST.md`](./E2E_TESTS_COMPLETE_LIST.md)
- Browser test plan: [`E2E_BROWSER_TEST_PLAN.md`](./E2E_BROWSER_TEST_PLAN.md)
