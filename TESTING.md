# Multi-AI Chat — Comprehensive Testing Guide

## 1. Token Budget Estimation (`tokenBudget.service.js`)

### Unit: `estimateTokens()`

| # | Input | Expected | Why |
|---|-------|----------|-----|
| 1 | Empty string `''` | `0` | No content |
| 2 | Short text `"hello"` | `2` | chars/4=2, words*1.3=2, avg=2 |
| 3 | Normal sentence (50 chars, 8 words) | `10` | chars/4=13, words*1.3=11, avg=12 → 12 |
| 4 | Code block (500 chars ABAP) | `95` | chars/4=125, words*1.3~65, avg=95 |
| 5 | Long paragraph (2000 chars, 300 words) | `400` | chars/4=500, words*1.3=390, avg=445 → 445 |
| 6 | Mixed SAP technical text with abbreviations | Verify < actual | Should not overestimate |
| 7 | JSON object string | Verify reasonable | Should not inflate from dense chars |
| 8 | Whitespace-only `"   "` | `0` | Trimmed to empty |

### Unit: `estimateMessagesTokens()`

| # | Input | Expected |
|---|-------|----------|
| 1 | Empty array `[]` | `0` |
| 2 | 1 message, 100 chars | `estimateTokens(100 chars) + 4` |
| 3 | 3 messages, varying lengths | Sum of each + 12 |

### Integration: `billableTokens` flow

| # | Scenario | Input | Expected |
|---|----------|-------|----------|
| 1 | API returns `tokensUsed=1500` | `tokensUsed=1500` | `billableTokens=1500` |
| 2 | API returns `tokensUsed=0` | `tokensUsed=0` | Falls back to `promptTokens + estimateTokens(reply)` |
| 3 | API returns `tokensUsed=null` | `tokensUsed=null` | Falls back to estimate |
| 4 | API returns `tokensUsed=500` vs estimate=800 | Prefers 500 | Accurate API value wins |

### Edge Cases

| # | Scenario | Expected Behavior |
|---|----------|------------------|
| 1 | Very long response (10k chars) | Estimate should be realistic, not inflated |
| 2 | Empty response `''` | `billableTokens` = `promptTokens` only |
| 3 | Multi-turn tool-call (3 rounds) | Each round's `tokensUsed` accumulated; final takes last round |
| 4 | Response with only code blocks | Estimate handles dense chars without inflation |

---

## 2. Chat Controller (`chat.controller.js`)

### `sendMessage` — Non-streaming path

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | New topic, no history, simple query | POST with `message="What is ABAP"` | Returns reply + `tokensUsed` from API |
| 2 | Existing topic with history | Include `topicId` with 10+ messages | History context included, tokens counted correctly |
| 3 | RAG context enabled | Upload docs first, then query about them | RAG context injected, total within `promptBudget` |
| 4 | Query with file attachment | Upload file, query referencing it | File context in system messages |
| 5 | Cache hit (semantic) | Ask same query twice | 2nd call returns cached, `tokensUsed` = 0 or minimal |
| 6 | Cache miss (semantic) | Ask different query | Normal flow, new cache entry created |
| 7 | Identity question | `message="Who are you?"` | Returns model identity, not cached |
| 8 | Image + text query | Include base64 image | Image URL in user content, processed correctly |
| 9 | Exceeds `per_query_limit` | Force large history context | Returns 400 error with message |
| 10 | Tool call: SEARCH_FILES | Trigger file search | Multi-round tool loop, context appended |

### Edge Cases

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Abort during AI call | Graceful return, no response sent |
| 2 | Abort during RAG build | Graceful return |
| 3 | Abort during tool-call loop | Loop exits immediately |
| 4 | Anonymous user (no auth) | `userId=null`, topic cached differently |
| 5 | All providers fail | Fallback to next provider or error message |
| 6 | `finalReply` empty after loop | `finalReply = reply || ''` used |

---

## 3. Chat Routes (`chat.routes.js` — Streaming path)

| # | Scenario | Steps | Expected |
|---|----------|-------|----------|
| 1 | Streamed response, no tools | SSE events with `data: {...}\n\n` | Chunks streamed, final `type: 'done'` with correct `tokensUsed` |
| 2 | Tool call during stream | AI returns `[SEARCH_FILES:query=...]` | Stream pauses, tool executes, stream resumes |
| 3 | Token calculation in stream | Verify `billableTokens` at end | Uses API-reported value |
| 4 | Multiple SSE clients | 3 concurrent streams | Each client receives correct data |
| 5 | Client disconnects mid-stream | Abort controller triggers | Server stops processing |

---

## 4. RAG System (`rag.service.js`)

### `embedText()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Short text (50 chars) | Returns 1536-dim vector |
| 2 | Long text (10k chars) | Returns vector (truncated to 2000 by caller) |
| 3 | Cache hit (same text within 1hr) | Returns cached vector, no API call |
| 4 | Abort during embedding | Throws `AbortError` |
| 5 | API failure + retry | Retries up to 3 times before throwing |

### `searchRelevantDocs()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Matching docs exist | Returns docs with similarity > 0.4 |
| 2 | No matching docs | Returns empty array `[]` |
| 3 | Embedding fails | Returns empty array `[]` |
| 4 | Exact match query | Highest similarity doc first |

### `buildRAGContext()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | With topicId, matching files exist | Returns formatted context string |
| 2 | No topicId, global docs exist | Uses `match_documents` RPC |
| 3 | No results at all | Returns `''` |
| 4 | Precomputed embedding provided | Skips embedText call |

---

## 5. File Upload (`fileUpload.service.js`)

### `saveFileToRAG()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Small file (<2000 chars) | 1 chunk created |
| 2 | Large file (>2000 chars) | Multiple overlapping chunks (2000/200) |
| 3 | Rag disabled (`ragEnabled=false`) | File metadata stored, no chunks |
| 4 | Same file uploaded twice | Both stored (separate entries) |
| 5 | Binary file (via 'other' handler) | Best-effort text extraction |

### `searchUserFilesRAG()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Matching files exist | Returns top 5 by similarity |
| 2 | No files for topic | Returns empty array |
| 3 | Embedding fails | Returns empty array |
| 4 | Exact file name query | File found via vector search |

---

## 6. Cache Service (`cache.service.js`)

### `getCachedResponse()` / `setCachedResponse()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Exact same query, same user+topic | Returns cached response |
| 2 | Same query, different topic | Cache miss (topic-isolated) |
| 3 | Same query, different user | Cache miss (user-isolated) |
| 4 | No cache entry | Returns `null` |

### `getSemanticCachedResponse()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Similar query (>0.92), same user+topic | Returns cached response |
| 2 | Similar query, different topic | Cache miss |
| 3 | Threshold 0.92 — slightly different query | Cache miss (below threshold) |
| 4 | No similar entry | Returns `null` |

### `cleanupStaleCache()`

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Entries older than 30 days, <2 hits | Deleted |
| 2 | Recent entries (<30 days) | Preserved |
| 3 | Old entries with >2 hits | Preserved (still useful) |

---

## 7. Context Service (`context.service.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Topic with 5 messages | Returns all 5 |
| 2 | Topic with 25+ messages | Returns max 25 (`rawLimit`) |
| 3 | Topic with summary | Summary included in context |
| 4 | No summary exists | No summary block |
| 5 | Summary trigger (8+ new messages) | New summary generated |

---

## 8. Summary Service (`summary.service.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Normal conversation text | Summary preserves personal info (name, job) |
| 2 | Text with name "Azim", job "developer" | Both preserved in summary |
| 3 | Long text (>1000 tokens) | Trimmed to 1000 max_tokens |
| 4 | API failure | Falls back to `fallbackSummary` |
| 5 | Empty text | Handled gracefully |

---

## 9. Provider Services

### Claude (`claude.service.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | System messages present | First gets `cache_control: ephemeral` |
| 2 | No system messages | `system` param is `undefined` |
| 3 | Multiple system messages | Only first cached, rest uncached |
| 4 | Response with usage | `tokensUsed = input_tokens + output_tokens` |
| 5 | Cache hit on Anthropic side | `cacheReadTokens > 0` |

### OpenRouter (`openrouter.service.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Claude model via OpenRouter | System as array, first cached |
| 2 | Non-Claude model (e.g., GPT) | System concatenated as single string |
| 3 | No system messages | No `system` param sent |
| 4 | Cache tokens present | `cacheCreationTokens` and `cacheReadTokens` forwarded |

### DeepSeek / Mistral / Groq

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Normal request | Returns `{ text, tokensUsed }` |
| 2 | API error | Throws axios error |
| 3 | Abort during request | Throws `AbortError` |

---

## 10. Token Check Middleware (`tokenCheck.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | User has remaining tokens | Passes |
| 2 | User exhausted (`remaining <= 0`) | Returns 403 |
| 3 | Anonymous user | Skipped (no middleware) |
| 4 | User with `total_tokens=0` | `remaining=0 - used`, blocked |

---

## 11. Auth Middleware (`auth.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Valid JWT token | `req.user` populated |
| 2 | Expired token | Returns 401 |
| 3 | Invalid token | Returns 401 |
| 4 | No token | Returns 401 (or anonymous for public routes) |

---

## 12. Admin Controller (`admin.controller.js`)

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Create user with default tokens | `total_tokens=100000`, `per_query_limit=2000` |
| 2 | Reset user tokens | `used_tokens=0`, optional new `total_tokens` |
| 3 | Update user limits | Fields updated in DB |
| 4 | List all users | Returns paginated list |

---

## 13. Performance Testing

| # | Scenario | Target |
|---|----------|--------|
| 1 | 10 concurrent chat requests | All complete <30s |
| 2 | File upload (5MB text file) | Processed <10s |
| 3 | RAG search across 1000 docs | Result <3s |
| 4 | Embedding with cache hit | <100ms |
| 5 | Embedding with cache miss (API call) | <3s |
| 6 | Memory: 100+ message topic load | <500ms |
| 7 | Memory: app restart, 10 topics | Server starts <5s |

---

## 14. Security Validation

| # | Scenario | Expected |
|---|----------|----------|
| 1 | SQL injection in `message` | Rejected by parameterized queries |
| 2 | XSS in file name | Sanitized/stored as-is, rendered safely |
| 3 | JWT token tampering | Rejected by auth middleware |
| 4 | Zip slip (malicious ZIP) | Rejected by `isSafeZipEntryName` |
| 5 | Oversized file (>50MB) | Rejected by multer `fileSize` limit |
| 6 | API key leak in error message | Redacted in logs/response |
| 7 | Anonymous user rate limit | Throttled server-side |
| 8 | Direct Supabase table access | Blocked by RLS policies |
| 9 | RPC injection (malicious params) | Blocked by Supabase param binding |
| 10 | `total_tokens` user manipulation | Server-authoritative, not client |

---

## 15. Coverage Goals

| Module | Target Coverage | Priority |
|--------|----------------|----------|
| `tokenBudget.service.js` | 95%+ | Critical |
| `chat.controller.js` | 85%+ | Critical |
| `chat.routes.js` | 80%+ | Critical |
| `rag.service.js` | 90%+ | High |
| `cache.service.js` | 95%+ | High |
| `fileUpload.service.js` | 85%+ | High |
| `context.service.js` | 90%+ | High |
| `summary.service.js` | 85%+ | Medium |
| `dispatcher.service.js` | 75%+ | Medium |
| Provider services (each) | 80%+ | Medium |
| Middleware (auth, tokenCheck) | 95%+ | High |
| Admin controller | 85%+ | Low |

---

## 16. Recent Changes — Specific Test Scenarios

| # | Change | Test | Expected |
|---|--------|------|----------|
| 1 | [`estimateTokens`](backend/services/tokenBudget.service.js:12) — `Math.max` → avg | Input `"ABAP SELECT * FROM bkpf WHERE belnr = '123'"` (43 chars) | chars/4=11, words*1.3=13, avg=12, not 13 |
| 2 | [`billableTokens`](backend/controllers/chat.controller.js:337) — prefer API | Mock `tokensUsed=1200`, `promptTokens=1500`, `estimateTokens(reply)=600` | Returns 1200, not 2100 |
| 3 | [`billableTokens` routes](backend/routes/chat.routes.js:297,303) — same fix | Mock streaming path same values | Returns 1200 |
| 4 | File upload — all types accepted | Upload `.xyz` unknown extension | Returns `'other'` type, best-effort text |
| 5 | Prompt caching — Claude | System messages split, first cached | Only first system gets `cache_control` |
| 6 | Topic isolation — cache | Same query, different topic | Cache miss (different topicId) |
| 7 | Summary — personal info preserved | Text "My name is Azim, I'm a developer" | Summary contains both facts |
