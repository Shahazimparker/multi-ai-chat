# Complete List of E2E Tests — Multi-AI Chat

## All Existing E2E Tests (34 Total)

### Mock E2E Tests — 17 TESTS (100% Passing)

#### Location: `e2e/`

**1. Authentication Tests** (`auth.spec.ts` — 4 tests)
```
- Redirects protected routes to login when unauthenticated
- Shows login error for invalid credentials  
- Logs in as user and logs out back to login
- Logs in as admin and lands on admin page
```
**What it tests**: Login flow, route protection, role-based redirection

---

**2. Chat Tests** (`chat.spec.ts` — 4 tests)
```
- Sends a normal chat message using deepseek-v4-flash
- Shows clarification form for vague artifact requests
- Approves generated artifact from approval prompt
- Starts a new chat from the sidebar
```
**What it tests**: Messaging, model selection, approval flow, sidebar navigation

---

**3. Artifact Tests** (`artifacts.spec.ts` — 3 tests)
```
- Uploads a file and sends a chat message with deepseek-v4-flash selected
- Shows and filters artifacts in the sidebar
- Deletes an artifact from the sidebar
```
**What it tests**: File handling, artifact management, filtering, deletion

---

**4. Admin Dashboard Tests** (`admin.spec.ts` — 4 tests)
```
- Loads admin tabs and analytics
- Creates a user from admin
- Edits and manages an existing user
- Deletes a user from admin
```
**What it tests**: Admin CRUD operations, user management, dashboard display

---

**5. Model Selector Tests** (`model-selector.spec.ts` — 2 tests)
```
- Model picker sits under the composer and picks model + effort together
- Mobile sheet expands the levels inline
```
**What it tests**: Unified model modal, effort level switching, mobile responsive drawer

---

### Real E2E Tests — 17 TESTS

#### Location: `e2e-real/`

**6. Real Authentication Tests** (`auth.real.spec.ts` — 3 tests)
```
- Redirects unauthenticated users to login
- Logs in as configured real user and can log out
- Configured admin user can reach admin page
```
**What it tests**: Real backend authentication, session management

---

**7. Real Artifact Tests** (`artifacts.real.spec.ts` — 2 tests)
```
- Uploads a real text file and receives a non-error assistant response
- Artifacts sidebar opens and search input is usable
```
**What it tests**: Real file uploads, sidebar operations, search

---

**8. Real Chat Tests** (`chat.real.spec.ts` — 5 tests)
```
- Chat screen uses deepseek-v4-flash by default
- Sends a real chat message and receives a live response
- Vague PPT request shows clarification box
- Approval prompt can be rejected cleanly
- Existing chats can be opened and new chat can be started
```
**What it tests**: Real chat functionality, model selection, message streaming

---

**9. Real Admin Tests** (`admin.real.spec.ts` — 2 tests)
```
- Admin tabs load against the real backend
- Destructive admin mutation flow is opt-in only
```
**What it tests**: Real admin operations, mutation gates

---

**10. Real Approval Tests** (`approval.real.spec.ts` — 5 tests)
```
- Approval prompt appears for image generation request
- Can provide instructions via "Other" button
- Can approve after instructions (revised approval)
- Can reject approval request
- Approval prompt shows correct tool labels
```
**What it tests**: Complete approval workflow with revisions, rejections, tool labels

---

## Test Summary Table

| Category | File | Count | Coverage Area |
|---|---|---|---|
| Mock Auth | `auth.spec.ts` | 4 | Login, logout, redirects |
| Mock Chat | `chat.spec.ts` | 4 | Messages, clarification, approval, new chat |
| Mock Artifacts | `artifacts.spec.ts` | 3 | Upload, sidebar, delete |
| Mock Admin | `admin.spec.ts` | 4 | User CRUD, analytics |
| Mock Model Selector | `model-selector.spec.ts` | 2 | Picker modal, effort levels, mobile |
| Real Auth | `auth.real.spec.ts` | 3 | Real auth and sessions |
| Real Chat | `chat.real.spec.ts` | 5 | Real streaming, model default, topics |
| Real Artifacts | `artifacts.real.spec.ts` | 2 | Real file upload, sidebar |
| Real Admin | `admin.real.spec.ts` | 2 | Real admin tabs, mutation safety |
| Real Approvals | `approval.real.spec.ts` | 5 | Real approval lifecycle |
| **TOTAL** | | **34** | **17 Mock + 17 Real** |

---

## Running the Tests

### Mock Tests (Fast — ~50 seconds)
```bash
npm run e2e:mock
```

### Real Tests (Requires Running Backend)
```bash
$env:REAL_TEST_USERNAME = "test"
$env:REAL_TEST_PASSWORD = "Welcome@1234"
npm run e2e
```

---

## Related Documentation

- Comprehensive test guide: [`TESTING.md`](./TESTING.md)
- Status report: [`E2E_TEST_STATUS.md`](./E2E_TEST_STATUS.md)
- Test catalog: [`E2E_TEST_SUMMARY.md`](./E2E_TEST_SUMMARY.md)
- Browser test plan: [`E2E_BROWSER_TEST_PLAN.md`](./E2E_BROWSER_TEST_PLAN.md)
