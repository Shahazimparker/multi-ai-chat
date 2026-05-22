# Testing Checklist — Security & Stability Fixes

## 1. DB Deletion — No Orphans

- [ ] **1a. Upload abort cleanup** — Start a file upload, cancel it mid-way. Verify no orphaned `uploaded_files_rag` or `uploaded_files` rows remain in Supabase.
- [ ] **1b. Admin delete user** — Delete a user from admin panel. Verify all related rows (topics, messages, uploaded_files, uploaded_files_rag, code_files, rag_documents, query_cache) are removed from DB.
- [ ] **1c. Delete topic** — Delete a chat topic. Verify all 7 related tables are cleaned. Run `delete_topic_cascade` SQL migration first.

## 2. Upload Security

- [ ] **2a. Path traversal** — Try uploading a file named `../../../etc/passwd`. Verify multer saves it as sanitized name (no path separators, no `..`).
- [ ] **2b. CRLF injection** — Upload a file named `test\r\nX-Injected:evil.txt`. Download it — verify `Content-Disposition` header has no CRLF.
- [ ] **2c. Generated file name** — `POST /api/upload/generate-file` with `fileName: "../../hack.js"`. Verify sanitized name stored in DB.

## 3. CSRF Protection

- [ ] **3a. Login returns csrfToken** — Login via API. Response body must include `csrfToken` field.
- [ ] **3b. Mutating requests blocked** — From production origin (not localhost), send `POST /api/upload/file` without `X-CSRF-Token` header. Must return `403`.
- [ ] **3c. Mutating with token works** — Same request WITH valid `X-CSRF-Token` header. Must succeed.
- [ ] **3d. Localhost bypass** — From `http://localhost:3000`, same request without token. Must succeed (dev mode).
- [ ] **3e. GET requests unaffected** — `GET /api/history/topics` without CSRF token. Must succeed (CSRF only on mutating methods).

## 4. Cache Stability

- [ ] **4a. No unhandled rejections** — Check server logs after cache hits. No `UnhandledPromiseRejection` warnings for `query_cache` updates.
- [ ] **4b. Embedding cache eviction** — Send 50+ unique queries rapidly. Check logs for `[RAG] LRU eviction` messages — cache must stay ≤ 5000 entries.
- [ ] **4c. TTL cleanup** — Wait 15+ minutes. Check logs for `[RAG] Cache cleanup` — stale entries (1hr+) should be purged.

## 5. Upload Abort — No Orphaned Temp Files

- [ ] **5a. Abort during processing** — Start upload, abort via cancel endpoint. Verify `req.file.path` is deleted from OS temp dir.
- [ ] **5b. Error during upload** — Upload corrupt/unreadable file. Verify temp file cleanup in catch block.
- [ ] **5c. No temp file accumulation** — Check `os.tmpdir()/multi-ai-chat-uploads/` before and after several uploads. No stale files.

## 6. Token Quota — No Race Condition

- [ ] **6a. Concurrent uploads** — Trigger 2 file uploads simultaneously (different browser tabs or `Promise.all`). Both should deduct tokens correctly — sum of deductions must equal total tokens consumed.
- [ ] **6b. Single upload deduction** — Upload one file. Verify `used_tokens` in `users` table incremented correctly.

## 7. Frontend Auth

- [ ] **7a. Token cleared on 401 (non-login page)** — With expired token, load `/chat`. Must redirect to `/login`, token removed from storage.
- [ ] **7b. Token cleared on 401 (login page)** — Set an invalid token in localStorage. Load `/login`. Token must be cleared (check DevTools → Application → Local Storage).
- [ ] **7c. No redirect loop** — On `/login` with invalid token, page must render login form (no flicker/redirect).
- [ ] **7d. isRedirecting recovery** — Trigger a 401, then quickly trigger another. Only one redirect should fire (check browser history).

## 8. Sentry — No 4xx Noise

- [ ] **8a. 401 not captured** — Trigger a 401 (expired token). Check Sentry dashboard — no new error event.
- [ ] **8b. 404 not captured** — Hit a non-existent route. No Sentry event.
- [ ] **8c. 500 captured** — Trigger a genuine server error. Must appear in Sentry.
- [ ] **8d. Authorization header redacted** — Check Sentry event details — no `authorization` or `cookie` headers in request data.

## 9. Run the SQL Migration

- [ ] Run `database/migration_delete_topic_cascade.sql` in Supabase SQL Editor before testing 1c.

## 10. Double Embedding Fix — /stream Endpoint

- [ ] **10a. Single embedding call** — Enable RAG, upload a file, send a message via `/stream`. Check server logs: only ONE `[RAG] OpenRouter Embedding` call per request (not two).
- [ ] **10b. Semantic cache works on /stream** — Send the same query twice via `/stream`. Second response must come from cache (`type: "cached"`, `cacheHit: true`). First response must NOT be cached.
- [ ] **10c. RAG context still works** — Upload a text file, send a question about its content via `/stream`. AI must reference the uploaded document. Verify `[RAG] Context:` log appears.
- [ ] **10d. No RAG without topicId** — New chat (no topicId yet), ragEnabled=true. First message must NOT trigger RAG search (no uploaded files to search). Embedding still generated for cache.
- [ ] **10e. /message endpoint unchanged** — Verify `/api/chat/message` still works as before (it already had the correct single-embedding pattern).

## 11. Token Race Condition — Chat Endpoints

- [ ] **11a. Atomic increment — /message** — Send 2 messages rapidly from same user (two tabs). Check `used_tokens` in `users` table: sum of both deductions must be correct (no overwrite).
- [ ] **11b. Atomic increment — /stream** — Same test via `/stream` endpoint. Token accounting must be accurate.
- [ ] **11c. RPC function exists** — Run `SELECT * FROM pg_proc WHERE proname = 'increment_user_tokens'` in Supabase SQL Editor. Must return 1 row.

## 12. Input Sanitization — All Fields Covered

- [ ] **12a. XSS in image field** — `POST /api/chat/stream` with `image: "<script>alert(1)</script>"`. Verify the `<script>` tags are stripped before reaching AI provider.
- [ ] **12b. XSS in providerModelId** — Send `providerModelId: "<img src=x onerror=alert(1)>"`. Verify HTML stripped.
- [ ] **12c. XSS in message** — Send `message: "<b>hello</b><script>evil()</script>"`. Verify only `hello` remains (tags stripped, text kept).
- [ ] **12d. Non-string fields untouched** — Verify `ragEnabled: true`, `dbOnly: false`, `historyLimit: 5` pass through unchanged (middleware skips non-strings).

## 13. Sanitize.js — No jsdom Dependency

- [ ] **13a. isomorphic-dompurify removed** — Check `backend/package.json`: `isomorphic-dompurify` must NOT be in dependencies.
- [ ] **13b. HTML stripping works** — Call `sanitizeInput('<p>Hello <b>World</b></p><script>xss()</script>')`. Must return `Hello World`.
- [ ] **13c. Entity decoding** — Call `sanitizeInput('<script>')`. Must return `<script>` (decoded, no XSS risk since tags stripped).

## 14. Inline Requires Moved to Top

- [ ] **14a. Server starts cleanly** — Run `node server.js` in backend. No `MODULE_NOT_FOUND` errors. All 11 services load at startup.
- [ ] **14b. All services accessible** — Send a chat message via `/stream`. Must complete normally. If any `require` path was wrong, it would have failed on server start, not at request time.

## 15. Fragile Regex → Beginning-Only Tag Stripping

- [ ] **15a. Tool tags at start stripped** — AI reply starts with `[QUERY_DB]\nSELECT 1\n[/QUERY_DB]\nHere are results`. Verify only `Here are results` reaches user.
- [ ] **15b. Tool syntax in middle preserved** — AI reply: `Use [QUERY_DB] tags like this: [QUERY_DB]SELECT * FROM users[/QUERY_DB]`. Verify the explanation text is NOT stripped (tool tags only removed from the beginning).
- [ ] **15c. Orphan closing tags handled** — AI reply starts with `[/QUERY_DB]\nSorry, no data.`. Verify `[/QUERY_DB]` is stripped, user sees `Sorry, no data.`

## 16. ensureBizDbInit — No Unhandled Rejection

- [ ] **16a. Module init failure handled** — Temporarily set invalid `BUSINESS_DB_URL` in `.env`. Start server. Check logs for `[BizDB] Module init deferred:` (not an `UnhandledPromiseRejection` crash).
- [ ] **16b. Normal startup** — With valid config, server starts with `[BizDB] ✅ Business database connected` (or `⚠️ Not configured` if no business DB).

## 17. SQL Migration

- [ ] Run the new function in Supabase SQL Editor (append to schema.sql):
  ```sql
  CREATE OR REPLACE FUNCTION increment_user_tokens(user_id UUID, token_amount INTEGER)
  RETURNS VOID LANGUAGE plpgsql SECURITY DEFINER
  AS $$ BEGIN UPDATE users SET used_tokens = used_tokens + token_amount WHERE id = user_id; END; $$;
  ```
