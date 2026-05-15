# Multi-AI Chat — Comprehensive Test Cases (Sections 1–10)

---

## 1. Token Budget Estimation (`tokenBudget.service.js`)

### 1.1 `estimateTokens()`

**Approach:** Pure unit tests — no mocks, no I/O. Direct function call with varied string inputs.

| # | Test | Input | Expected | Why |
|---|------|-------|----------|-----|
| 1 | Empty string | `''` | `0` | Guard clause `if (!text) return 0` |
| 2 | Whitespace-only | `'   '` | `0` | `.trim()` produces empty string |
| 3 | Null/undefined | `null`, `undefined` | `0` | `String(text).trim()` yields `''` |
| 4 | Single char | `'a'` | `1` | chars/4=1, words*1.3=2, avg=1.5→2... Wait, let me compute: str='a', charEstimate=ceil(1/4)=1, words=1, wordEstimate=ceil(1.3)=2, avg=ceil(1.5)=2. So expected=2 |
| 5 | Short text | `'hello'` | `2` | 5 chars→ceil(5/4)=2, 1 word→ceil(1.3)=2, avg=2 |
| 6 | Normal sentence (50 chars, 8 words) | `'The quick brown fox jumps over the lazy dog'` (43 chars, 9 words) | Compute: char=ceil(43/4)=11, word=ceil(9*1.3)=ceil(11.7)=12, avg=ceil(11.5)=12 | Verifies hybrid average |
| 7 | Dense code block (500 chars ABAP) | ABAP SELECT statement ~500 chars | char=125, words~65→ceil(84.5)=85, avg=ceil(105)=105 | Code is denser than natural language |
| 8 | Long paragraph (2000 chars, 300 words) | 2000-char lorem ipsum | char=500, word=ceil(390)=390, avg=ceil(445)=445 | Large input boundary |
| 9 | JSON object string | `'{"key":"value","nested":{"a":1}}'` | char=ceil(37/4)=10, words~6→ceil(7.8)=8, avg=9 | Dense but structured — should not inflate |
| 10 | Mixed SAP technical text with abbreviations | `'BAPI for RFC on SAP S/4HANA using OData v4'` | char=ceil(50/4)=13, words=9→ceil(11.7)=12, avg=ceil(12.5)=13 | Verifies no overestimation on technical text |
| 11 | Very long string (10k chars) | 10,000-char string | char=2500, words~1667→ceil(2167)=2167, avg=ceil(2334)=2334 | Stress test — realistic but not inflated |
| 12 | Single word with special characters | `'ABAP_SELECT*FROM#BKPF'` | char=ceil(22/4)=6, words=1→ceil(1.3)=2, avg=ceil(4)=4 | No word-splitting inflation |

**Edge Cases for `estimateTokens()`:**
| # | Scenario | Expected Behavior |
|---|----------|------------------|
| EC1 | Very short input `'a b'` (3 chars, 2 words) | char=1, word=ceil(2.6)=3, avg=2 |
| EC2 | Text with only numbers `'123 456 789'` | Treated as words, no special handling |
| EC3 | Text with only symbols `'!@#$%^&*()'` | Normal char/word estimation |
| EC4 | Extremely long single word (10k chars no spaces) | char=2500, words=1→2, avg=1251 — correctly handles dense input |
| EC5 | Multi-byte Unicode (emoji, CJK) | char estimate counts bytes vs chars — may vary; verify behavior |

---

### 1.2 `estimateMessagesTokens()`

**Approach:** Unit test — calls `estimateTokens()` per message, adds 4 tokens overhead per message.

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Empty array | `[]` | `0` |
| 2 | Single message, 100 chars | `[{ role:'user', content: 'x'.repeat(100) }]` | `estimateTokens('x'.repeat(100)) + 4` |
| 3 | Three messages, varying lengths | 3 messages of 50, 200, 500 chars | Sum of `estimateTokens()` each + 12 (4×3) |
| 4 | Message with empty content | `[{ role:'user', content: '' }]` | `0 + 4 = 4` |
| 5 | Message with null content | `[{ role:'user', content: null }]` | `0 + 4 = 4` |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | 100 messages, each 10 chars | `100 * (estimateTokens('x'.repeat(10)) + 4)` — verifies no overflow |
| EC2 | Mixed roles (system, user, assistant) | All treated equally — each adds 4 tokens overhead |

---

### 1.3 `createPromptBudget()`

**Approach:** Unit test — pure function based on model config.

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Default model (4096 maxTokens) | `{}` | `maxPromptTokens=4096-1434=2662`, system=532, history=666, rag=666, file=878, query=479 |
| 2 | Large model (128k tokens) | `{ maxTokens: 131072 }` | `maxPromptTokens=131072-45875=85197`, proportional slices |
| 3 | Small model (2048 tokens) | `{ maxTokens: 2048 }` | `reservedOutputTokens=800`, `maxPromptTokens=1248` (clamped to 1200) |
| 4 | Custom model config | `{ maxTokens: 8192, label: 'custom' }` | Correct proportional allocation |

---

### 1.4 `createDynamicPromptBudget()`

**Approach:** Unit test with mocked turn count and complexity score.

| # | Test | turnCount | complexityScore | Expected behavior |
|---|------|-----------|-----------------|-------------------|
| 1 | New topic, low complexity | 1 | 1.5 | `historyTokens=1000` |
| 2 | Medium conversation, medium complexity | 8 | 6.0 | `historyTokens=2800` |
| 3 | Long complex conversation | 20 | 8.5 | `historyTokens=4000` |
| 4 | High complexity, few turns | 2 | 9.0 | Falls into `complexityScore>7` → `historyTokens=4000` |
| 5 | Zero turn count (edge) | 0 | 0 | `turnCount < 3` → `historyTokens=1000` |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Negative turnCount (should never happen) | Falls to `turnCount < 3` (since negative < 3) |
| EC2 | complexityScore clamped at 10 | `>7` path, `historyTokens=4000` |
| EC3 | complexityScore 0 with 50 turns | `turnCount > 15` → `historyTokens=4000` |

---

### 1.5 `calculateComplexityScore()`

**Approach:** Unit test — pattern matching on query text.

| # | Test | Input | Expected range |
|---|------|-------|----------------|
| 1 | SAP keyword match | `'How to implement BAPI in SAP ABAP'` | ≥ 2.0 (high-weight matches) |
| 2 | Code block present | `'Explain this:\n```\nSELECT * FROM bkpf\n```'` | ≥ 1.5 (code block bonus) |
| 3 | SQL pattern | `'SELECT * FROM users WHERE id = 1'` | ≥ 1.0 (SQL regex match) |
| 4 | General question | `'What is the weather today?'` | 0 (no technical keywords) |
| 5 | Mixed technical + code | Long query with JSON, SQL, and keywords | 4–10 range |
| 6 | History text contributes | Pass `historyText` with SAP keywords | Score increases by up to 2 from history |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Empty query | 0 |
| EC2 | Query with only XML tags | `score += 0.5` (XML pattern match) |
| EC3 | Query with function calls | `score += 0.5` (function call pattern) |
| EC4 | Very long query (500+ words) | `score += 2.5` (length cap) |

---

### 1.6 `fitMessagesToBudget()`

**Approach:** Unit test — array filtering with token budget.

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | All messages fit | 5 messages, budget=1000 | All 5 messages returned |
| 2 | Partial fit | 10 messages, budget=500 | First N messages that fit within 500 tokens |
| 3 | Single message exceeds budget | 1 huge message, budget=50 | Message trimmed (since remaining >= minUsefulTokens) |
| 4 | Message too large even trimmed | 1 huge message, budget=20 | Skipped (remaining < minUsefulTokens) |
| 5 | Zero budget | any messages, budget=0 | Empty array |
| 6 | Empty messages | `[]`, budget=1000 | Empty array |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | `remaining` exactly equals message estimate | Message included, remaining becomes 0 |
| EC2 | `remaining` just under minimumUsefulTokens (user=80) | Message skipped, loop breaks |
| EC3 | Mixed roles — user message first, assistant second | Each checked independently with correct `minimumUsefulTokens` |

---

### 1.7 `billableTokens` Integration Flow

**Approach:** Integration test — mock `dispatchToAI` return values and verify `billableTokens` calculation in [`chat.controller.js`](backend/controllers/chat.controller.js:351).

| # | Scenario | Mocked Values | Expected |
|---|----------|--------------|----------|
| 1 | API returns `tokensUsed=1500` | `totalAITokens=1500` | `billableTokens = 1500 + embedding + input + compress + summary` |
| 2 | API returns `tokensUsed=0` | `totalAITokens=0` | Falls back to `promptTokens + estimateTokens(reply) + embedding + input + compress + summary` |
| 3 | API returns `tokensUsed=null` | `totalAITokens=0` (null coalesced) | Same fallback as #2 |
| 4 | API returns 500 vs estimate 800 | `totalAITokens=500` | Prefers API value (500) |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Multi-round tool call (3 rounds, each returns tokensUsed) | `totalAITokens` accumulated across all rounds |
| EC2 | `finalReply` empty after loop | `finalReply = reply || ''` guard at line 347-349 |
| EC3 | Embedding tokens also accumulated | `totalEmbeddingTokens` added to total |

---

### 1.8 `smartTrimContextBlock()`

**Approach:** Unit test — structure-aware trimming of memory blocks.

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Within budget | Block with summary+latest, total ≤ maxTokens | Returned unchanged |
| 2 | Latest fits, summary doesn't | Block where summary exceeds budget after reserving latest | Summary trimmed, latest preserved |
| 3 | Latest too big, drop summary | Latest > 85% of max, summary exists | Summary dropped, latest trimmed if needed |
| 4 | Both too big | Everything exceeds budget | Both trimmed: 80% latest, 20% summary |
| 5 | No structured sections | Plain text without markers | Falls back to `trimTextByTokens()` |
| 6 | Only summary, no latest | Block with only `[OLDER CONVERSATION SUMMARY]` | No latest match, operates on summary alone |

---

## 2. Chat Controller (`chat.controller.js`) — `sendMessage`

**Approach:** Integration tests with mocked services (Supabase, AI dispatcher, cache, RAG, context). Mock `req`/`res` objects.

### 2.1 Non-streaming Path Tests

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | New topic, no history, simple query | POST body: `{ message: "What is ABAP", modelId: "claude-sonnet" }`, no auth | Returns `{ reply, tokensUsed, topicId, cacheHit: false }`. New topic created in DB for logged-in users. |
| 2 | Existing topic with history | Include `topicId` with 10+ pre-seeded messages | History context included in AI messages, `promptTokens` accounts for history |
| 3 | RAG context enabled | `ragEnabled: true`, pre-uploaded docs matching query | RAG context injected into system messages, total stays within `promptBudget` |
| 4 | Query with file attachment | Upload file first, then query with `topicId` | File context in system messages, AI can use SEARCH_FILES/GET_FILE tools |
| 5 | Cache hit (exact match) | Same query sent twice, first call uncached | First call returns token count >0, sets cache; second returns `tokensUsed: 0`, `cacheHit: true` |
| 6 | Cache miss (semantic) | Query embedding returns no match >0.92 threshold | Normal flow, new cache entry created via `setCachedResponse` |
| 7 | Identity question | `message: "Who are you?"` | Returns model identity from `runtimeIdentity`, NOT cached (skips cache set) |
| 8 | Image + text query | Include `image: "data:image/jpeg;base64,..."` | User content has `[{ type: 'text' }, { type: 'image_url' }]` format |
| 9 | Exceeds `per_query_limit` | Force user `per_query_limit=200`, message ~300 tokens | Returns 400 error: "Query too long" |
| 10 | Tool call: SEARCH_FILES | AI response contains `[SEARCH_FILES:query=...]` | Multi-round loop: searches files, appends results, re-invokes AI |
| 11 | Tool call: GET_FILE | AI response contains `[GET_FILE:id=...]` | File content fetched, appended to messages, AI re-invoked |
| 12 | Max tool rounds exceeded | AI keeps calling tools beyond 3 rounds | Loop exits after round 3, `finalReply` uses last reply |
| 13 | Context exceeds `per_query_limit` after RAG/history | Large RAG context pushes prompt over limit | Returns 400 error: "Query context too large" |
| 14 | Unknown model ID | `modelId: "nonexistent"` | Returns 400 error: "Unknown model" |
| 15 | Anonymous user (no auth header) | No `Authorization` header | `req.user = null`, `isAnonymous = true`, no messages/topic saved |
| 16 | Dynamic budget applied | Topic with 20 turns, high complexity | `createDynamicPromptBudget` called, debug logged |

### 2.2 Error Handling

| # | Scenario | Expected |
|---|----------|----------|
| 1 | AI dispatch throws quota error | Returns 503 with `errorType: "quota_exhausted"`, `retryable: true` |
| 2 | AI dispatch throws rate limit error | Returns 503 with `errorType: "rate_limited"` |
| 3 | AI dispatch throws model unavailable | Returns 503 with `errorType: "model_unavailable"` |
| 4 | AI dispatch throws auth error | Returns 503 with `errorType: "api_key_missing"` |
| 5 | AI dispatch throws generic error | Returns 503 with `errorType: "unknown"`, generic message |
| 6 | Dynamic budget function throws | Falls back to static `createPromptBudget`, logs warning |
| 7 | Supabase topic creation fails | Logs error, continues without `topicId`, message not saved |
| 8 | Supabase message insert fails | Logs error, continues with token tracking |

### 2.3 Edge Cases

| # | Scenario | Expected |
|---|----------|----------|
| 1 | Abort during AI call (client disconnects) | `abortController.abort()` triggers, function returns early, no response sent |
| 2 | Abort during RAG build | `throwIfAborted()` catches, `AbortError` thrown, caught gracefully |
| 3 | Abort during tool-call loop | Loop exits immediately, function returns |
| 4 | Anonymous user (no auth) | `userId=null`, topic cached differently (no `userId` in cache key) |
| 5 | All providers fail one by one | Dispatcher falls through providers, final error returned |
| 6 | `finalReply` empty after loop | `finalReply = reply || ''` assigns empty string, no crash |
| 7 | `tokensUsed` null from API | Coerced to 0, fallback estimation used |
| 8 | `req.on('aborted')` and `res.on('close')` both fire | No double-abort — `abortController.signal.aborted` check prevents |

---

## 3. Chat Routes (`chat.routes.js` — Streaming Path)

**Approach:** Integration tests with mock SSE client. Mock underlying services but verify SSE event format and ordering.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Streamed response, no tools | POST `/api/chat/stream` with basic message | SSE events: `{"status":"connected"}`, N × `{"type":"chunk","text":"...","progress":N}`, `{"type":"done","tokensUsed":N,...}` |
| 2 | Tool call during stream | AI returns `[SEARCH_FILES:query=...]` | Stream pauses, tool executes silently (no SSE events for tool), stream resumes with final reply |
| 3 | Token calculation at stream end | Mock `totalAITokens=1200`, `totalEmbeddingTokens=50`, `estimatedInputTokens=30` | `billableTokens=1280` in `type: 'done'` event |
| 4 | Multiple concurrent SSE clients | 3 parallel POST requests to `/stream` | Each client receives independent event stream, correct data per request |
| 5 | Client disconnects mid-stream | Client closes connection after 2 chunks | AbortController fires, server stops processing, no error |
| 6 | Cache hit on stream | Same query sent twice | First: normal stream; Second: immediate `{"type":"cached","reply":"...","tokensUsed":0}` then `{"type":"done"}` |
| 7 | Rate limit exceeded | 31 requests in 1 minute | Returns 429 with error |
| 8 | Anonymous stream with client-provided history | `history: [...]` in body, no auth | History used as context, no DB persistence |
| 9 | Image in stream | `image: "data:image/..."` in body | User content built with image_url format, streamed normally |
| 10 | Stream with empty finalReply | AI returns empty string | `finalReply = reply || ''` prevents crash, empty chunks sent |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | SSE chunk boundary exactly at `chunkSize` (10 chars) | Progress correctly calculated as 100% |
| EC2 | Response shorter than `chunkSize` | Single chunk containing full response |
| EC3 | Abort right before `res.end()` | `res.writableEnded` check prevents double-end |
| EC4 | DB persistence fails during stream | `persistError` flag set in `type: 'done'` event, token update still attempted |
| EC5 | Headers already sent on error | Check `res.headersSent` before writing error SSE |

---

## 4. RAG System (`rag.service.js`)

### 4.1 `embedText()`

**Approach:** Unit/integration — mock axios/Gemini client. Test caching layer independently.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Short text via OpenRouter | 50-char text, OpenRouter provider | Returns `{ vector: number[1536], tokensUsed: number }` |
| 2 | Long text (10k chars) | Truncated to 2000 by caller before embedding | Returns valid 1536-dim vector |
| 3 | Cache hit (same text within 1hr) | Same text embedded twice within 60 min | Second call returns `{ vector, tokensUsed: 0 }` — no API call |
| 4 | Cache TTL expiry | Same text after 61+ min | Cache entry deleted, new API call made |
| 5 | Abort during embedding | AbortSignal aborted mid-request | Throws `{ name: 'AbortError' }` |
| 6 | API failure + retry | API returns 5xx first 2 times, succeeds 3rd | Retries up to 3 times, returns vector on success |
| 7 | All retries fail | API returns 5xx all 3 times | Returns `null` |
| 8 | Missing API key | `OPENROUTER_API_KEY` not set | Returns `null`, logs error |
| 9 | Gemini provider | provider='gemini' | Uses GoogleGenerativeAI client, returns vector |
| 10 | Mistral provider | provider='mistral' | Uses `embedWithMistral`, pads to 1536 dims |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Aborted before API call (signal already aborted) | Immediate `throwIfAborted()` throws |
| EC2 | Empty text | `estimateTokens(text)` returns 0, check if embedding API called |
| EC3 | Single-word text | Works normally — single word embedded |
| EC4 | Text exactly at cache key slice (100 chars) | Cache key uses `text.slice(0, 100)`, boundary case |

---

### 4.2 `searchRelevantDocs()`

**Approach:** Integration — mock Supabase RPC response.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Matching docs exist | RPC returns 3 docs with similarity 0.5, 0.7, 0.9 | Returns docs sorted by similarity, all > 0.4 threshold |
| 2 | No matching docs | RPC returns empty array | Returns `[]` |
| 3 | Embedding fails | `embedText` returns `null` | Returns `[]` |
| 4 | Exact match query | Query identical to doc content | Highest similarity doc returned first |
| 5 | Multiple users/docs filtered | Pass `userId` and `topicId` params | RPC filters correctly |
| 6 | Supabase RPC error | RPC throws error | Returns `[]`, logs warning |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Doc exactly at 0.4 threshold | Included (similarity >= 0.4) |
| EC2 | Doc at 0.399 similarity | Excluded |
| EC3 | Empty embedding vector | Check if RPC handles zero vector gracefully |

---

### 4.3 `buildRAGContext()`

**Approach:** Integration — mock `embedText`, `searchRelevantDocs`, Supabase.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | With topicId, matching files exist | topicId provided, matching docs found | Returns formatted context string with doc content |
| 2 | No topicId, global docs exist | topicId=null, uses `match_documents` RPC | Uses global matching, returns context |
| 3 | No results at all | No matching docs anywhere | Returns `''` |
| 4 | Precomputed embedding provided | Pass `queryVector` param | Skips `embedText` call, uses provided vector directly |
| 5 | Context exceeds token budget | Matching docs produce long context | Context trimmed by `trimTextByTokens` to `tokenBudget.ragTokens` |
| 6 | Abort during context build | Signal aborted mid-process | Throws `AbortError` |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Multiple docs with identical content | Both included (separate entries) |
| EC2 | Doc content is empty string | Included as empty entry? Or skipped — verify behavior |
| EC3 | Token budget is 0 | Context trimmed to 0 → effectively `''` |

---

## 5. File Upload (`fileUpload.service.js`)

### 5.1 `saveFileToRAG()`

**Approach:** Unit/integration — mock fs, Supabase. Test chunking logic directly.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Small file (<2000 chars) | 500-char text file | 1 chunk created in DB |
| 2 | Large file (>2000 chars) | 5000-char text file | 3 overlapping chunks (2000/200 overlap): chunks 0-2000, 1800-3800, 3600-5000 |
| 3 | RAG disabled (`ragEnabled=false`) | Flag set to false | File metadata stored in `uploaded_files_rag`, no chunking |
| 4 | Same file uploaded twice | Same content twice | Both stored — separate entries, different file_id |
| 5 | Binary file via 'other' handler | `.xyz` unknown extension | Best-effort text extraction (`.toString('utf8')` or similar) |
| 6 | PDF file | `.pdf` upload | `pdf-parse` extracts text, stored as chunks |
| 7 | DOCX file | `.docx` upload | `mammoth` extracts text, stored as chunks |
| 8 | ZIP file with code | `.zip` containing `.js` files | Extracted via JSZip, files processed individually |
| 9 | Image file (JPG/PNG) | `.jpg` upload | Stored as image type, no text extraction |
| 10 | Multi-chunk exact boundary | 4000-char file (exactly 2× chunkSize) | 2 chunks: 0-2000, 1800-4000 (overlap 200) |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Empty file (0 bytes) | 1 chunk with empty content |
| EC2 | File exactly 2000 chars | 1 chunk (not > chunkSize) |
| EC3 | File 2001 chars | 2 chunks: 0-2000, 1801-2001 |
| EC4 | Corrupted PDF/DOCX | Error caught, returns error message to user |
| EC5 | ZIP with nested directories | All files flattened or directory structure preserved? — verify |
| EC6 | File name with special characters | Sanitized or stored as-is? Check `detectLanguage` and Supabase insert |

---

### 5.2 `chunkContent()`

**Approach:** Pure unit test — no mocks needed.

| # | Test | Input | Expected |
|---|------|-------|----------|
| 1 | Text ≤ chunkSize | 1000 chars, chunkSize=2000 | `[text]` (single element) |
| 2 | Text > chunkSize | 5000 chars, chunkSize=2000, overlap=200 | 3 chunks: `[0:2000]`, `[1800:3800]`, `[3600:5000]` |
| 3 | Text exactly 2× chunkSize | 4000 chars, chunkSize=2000, overlap=200 | 3 chunks (overlap makes it 3, not 2) |
| 4 | Zero overlap | chunkSize=100, overlap=0 | No overlap between chunks |
| 5 | Empty text | `''` | `['']` (single empty chunk — check if returns `[text]` since empty ≤ chunkSize) |

---

### 5.3 `searchUserFilesRAG()`

**Approach:** Integration — mock Supabase RPC.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Matching files exist | RPC returns top 5 matches | Returns `{ results: [...], embedTokens: N }` |
| 2 | No files for topic | No files match | Returns `{ results: [], embedTokens: N }` |
| 3 | Embedding fails | `embedText` returns null | Returns `{ results: [], embedTokens: 0 }` |
| 4 | Exact file name query | File named exactly in search | File found via vector similarity |
| 5 | Abort during search | Signal aborted | Throws `AbortError` |

---

## 6. Cache Service (`cache.service.js`)

### 6.1 `getCachedResponse()` / `setCachedResponse()`

**Approach:** Integration — mock Supabase queries.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Exact same query, same user+topic | Same query, same userId, same topicId | Returns cached `response_text`, `hit_count` incremented |
| 2 | Same query, different topic | Same query, same user, different topicId | Cache miss → returns `null` |
| 3 | Same query, different user | Same query, different userId, same topic | Cache miss → returns `null` |
| 4 | No cache entry | Query never sent before | Returns `null` |
| 5 | Set cache with valid response | Response >20 chars | Stored in `query_cache` table with hash, userId, topicId |
| 6 | Set cache with short response | Response <20 chars | Skipped (not cached) |
| 7 | Set cache with query embedding | Pass `queryEmbedding` param | Embedding stored alongside hash for semantic lookup |
| 8 | Cache with null userId or topicId | Anonymous user | Stored with empty-string userId key component |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | `hashQuery` with special characters in query | Normalized: lowercase, single spaces, trimmed |
| EC2 | Very long query (>1000 chars after normalization) | `query_text` capped at 1000 chars in storage |
| EC3 | `hit_count` increment fails silently | Fire-and-forget `.then()` — non-blocking |
| EC4 | Concurrency: two simultaneous identical queries | Both might miss cache initially, both set cache (last write wins) |

---

### 6.2 `getSemanticCachedResponse()`

**Approach:** Integration — mock Supabase RPC `match_query_cache`.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Similar query (>0.92), same user+topic | Embedding similarity 0.95 | Returns cached `response_text` |
| 2 | Similar query, different topic | Same user, different topicId | Cache miss → returns `null` (topic-filtered) |
| 3 | Below threshold (0.91) | Similarity 0.91 vs threshold 0.92 | Cache miss |
| 4 | No similar entry | No matching entries in cache | Returns `null` |
| 5 | Null queryEmbedding | `queryEmbedding=null` | Returns `null` immediately |
| 6 | RPC throws error | Supabase error | Returns `null`, caught silently |
| 7 | RPC returns empty array | `data=[]` | Returns `null` |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Exact threshold boundary (0.92) | Included (≥ threshold) |
| EC2 | Multiple entries above threshold | Top match returned (`match_count: 1`) |
| EC3 | `hit.similarity` undefined | Hit returned anyway, no percentage logged |

---

### 6.3 `cleanupStaleCache()`

**Approach:** Integration — mock Supabase delete/select.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Old entries with <2 hits | last_hit_at >30 days, hit_count <2 | Deleted |
| 2 | Recent entries (<30 days) | last_hit_at <30 days | Preserved regardless of hit count |
| 3 | Old entries with >2 hits | last_hit_at >30 days, hit_count ≥2 | Preserved (still useful) |
| 4 | No stale entries | All entries recent or high-hit | No deletions |
| 5 | Empty cache table | No entries | No-op |

---

## 7. Context Service (`context.service.js`)

**Approach:** Integration — mock Supabase queries for messages, summaries.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Topic with 5 messages | topicId has 5 non-summary messages | Returns `context` array with 5 formatted messages, `isNewTopic: false` |
| 2 | Topic with 25+ messages | topicId has 30 messages, `historyLimit=25` | Returns max 25 (`rawLimit` |
| 3 | Topic with summary | Summary exists in messages table, `is_summary=true` | Summary included in context block with `[OLDER CONVERSATION SUMMARY]` markers |
| 4 | No summary exists | No summary message for topic | No summary block, only recent messages |
| 5 | Summary trigger (8+ new messages since last summary) | 8 new messages after last summary | New summary generated, saved via `saveTopicSummary` |
| 6 | No topicId (new conversation) | `topicId=null` | Returns `{ context: [], isNewTopic: true }` |
| 7 | Memory mode = 'full' | `memoryMode: 'full'` | All messages returned (no summary) |
| 8 | Memory mode = 'summarized' | `memoryMode: 'summarized'` | Summary + recent messages combined |
| 9 | Dynamic budget applied | High complexity, many turns | `smartTrimContextBlock` called with appropriate token budget |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Topic exists but has 0 messages | Returns empty context, no summary |
| EC2 | Summary exists but all messages before it are deleted | Summary preserved, no recent raw messages |
| EC3 | `historyLimit` set to 2 (minimum) | Only 2 most recent messages returned |
| EC4 | `historyLimit` set to 25 (maximum) | Up to 25 messages returned |
| EC5 | `historyLimit` set to 100 (clamped) | Clamped to 25 |
| EC6 | Summary generation fails | Logged, no summary saved, context built without summary block |

---

## 8. Summary Service (`summary.service.js`)

**Approach:** Integration — mock fetch/axios for each provider. Test fallback chain.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Normal conversation text | 500-word conversation | Summary preserves personal info (name, job) |
| 2 | Text with "Azim", job "developer" | Text: "My name is Azim, I'm a developer" | Both "Azim" and "developer" present in summary output |
| 3 | Long text (>1000 tokens) | Text exceeding 1000 tokens | Trimmed: `max_tokens: 1000` sent to API |
| 4 | API failure — first provider fails | OpenRouter returns 5xx | Falls through to next provider (Gemini → Mistral → Cerebras) |
| 5 | All providers fail | All 5 models return errors | Falls back to `fallbackSummary` (truncated original text) |
| 6 | Empty text | `text=''` | Handled gracefully — returns empty or minimal summary |
| 7 | Cerebras provider succeeds | Cerebras called with correct model | Returns `{ summary, tokensUsed }` |
| 8 | Gemini provider succeeds | Gemini called via GoogleGenerativeAI | Returns `{ summary, tokensUsed }` |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Text with only personal info (no technical content) | Summary preserves personal info per prompt rules |
| EC2 | Text with only technical content (no personal info) | Summary focuses on technical facts, decisions |
| EC3 | API returns empty summary string | Falls through to next provider |
| EC4 | `estimateSummaryTokens` with very long text | Returns `inputTokens + 600` |
| EC5 | `estimateSummaryTokens` with empty text | `inputTokens = estimateTokens(summaryPrompt(''))` — should be > 0 since prompt itself has text |

---

## 9. Provider Services

### 9.1 Claude (`claude.service.js`)

**Approach:** Unit/integration — mock Anthropic SDK.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | System messages present | 3 system messages in messages array | First message gets `cache_control: { type: "ephemeral" }`, rest have no cache_control |
| 2 | No system messages | Only user/assistant messages | `system` param is `undefined` in API call |
| 3 | Single system message | 1 system message | Gets `cache_control` — `i === 0` is true |
| 4 | Response with usage data | API returns `input_tokens=500, output_tokens=200` | `tokensUsed = 700` |
| 5 | Cache hit on Anthropic side | `cache_read_input_tokens=100` | `cacheReadTokens = 100` |
| 6 | Cache creation | `cache_creation_input_tokens=50` | `cacheCreationTokens = 50` |
| 7 | Non-text content response | API returns tool_use or other content type | `text = ''` (only handles type === 'text') |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Large number of system messages (10+) | Only first cached, rest sent without cache_control |
| EC2 | Empty system message content | Still gets cache_control — verify Anthropic behavior |
| EC3 | Response usage fields missing | `cacheReadTokens` defaults to 0 via `|| 0` |

---

### 9.2 OpenRouter (`openrouter.service.js`)

**Approach:** Unit/integration — mock `callOpenAICompatible`.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Claude model via OpenRouter | `modelName` contains 'claude', system messages present | System as array with cache_control on first element |
| 2 | GPT-4-Turbo model via OpenRouter | `modelName` contains 'gpt-4-turbo' | System as array with cache_control (same as Claude path) |
| 3 | Non-Claude model (e.g., GPT-4o, Mistral) | Model doesn't match Claude or GPT-4-Turbo | System concatenated as single string, prepended as `role: 'system'` message |
| 4 | No system messages | Empty system messages array | No `system` param in `baseConfig`, only chat messages sent |
| 5 | Cache tokens present | Response has `cacheCreationTokens` and `cacheReadTokens` | Both forwarded in return object |
| 6 | Multiple system messages, non-Claude mode | Non-Claude model, 3 system messages | All 3 concatenated with `\n\n`, sent as single system message |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | `modelName` includes 'claude' but case differs (e.g., 'Claude') | `includes('claude')` is case-sensitive — verify lowercase check |
| EC2 | Empty system array but `system` param set | Should not happen — guarded by `systemMessages.length > 0` |

---

### 9.3 DeepSeek (`deepseek.service.js`)

**Approach:** Unit/integration — mock axios.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Normal request | Standard message payload | Returns `{ text, tokensUsed }` |
| 2 | API returns error | 4xx/5xx response | Axios error thrown, caught by caller |
| 3 | Abort during request | Signal aborted mid-request | Axios throws `AbortError` (via `signal` param) |
| 4 | No `usage` in response | API doesn't return token counts | `tokensUsed = 0` (via `|| 0` fallback) |
| 5 | Empty response content | `choices[0].message.content` is empty | `text = ''` |

---

### 9.4 Mistral (`mistral.service.js`)

**Approach:** Unit/integration — mock axios.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Normal request | Standard message payload | Returns `{ text, tokensUsed }` |
| 2 | API error | 4xx/5xx response | Axios error thrown |
| 3 | Abort during request | Signal aborted | Throws `AbortError` |
| 4 | Messages mapped correctly | Input messages have extra fields | Output mapped to `{ role, content }` only |
| 5 | Embedding via `embedWithMistral` | Text sent for embedding | `{ vector: number[1536], tokensUsed: number }` — vector padded to 1536 dims |

**Edge Cases for `embedWithMistral`:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | Mistral returns 1024-dim vector | Padded to 1536 with trailing zeros |
| EC2 | API doesn't return `prompt_tokens` | `tokensUsed = 0` |

---

### 9.5 Groq (`groq.service.js`)

**Approach:** Unit/integration — mock Groq SDK.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Normal request | Standard message payload | Returns `{ text, tokensUsed }` |
| 2 | API error | SDK throws error | Error propagated |
| 3 | Abort during request | Signal aborted | Throws via SDK signal handling |
| 4 | Messages mapped correctly | Extra message fields stripped | Maps to `{ role, content }` |
| 5 | Empty response | `choices[0].message.content` null | `text = ''` (via `|| ''`) |

---

### 9.6 Unified Service (`unified.service.js` — `callOpenAICompatible`)

**Approach:** Unit/integration — mock OpenAI SDK.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | Standard call | `{ baseURL, apiKey, modelName, messages }` | Returns `{ text, tokensUsed, cacheCreationTokens, cacheReadTokens }` |
| 2 | With `system` param as object | Claude-style system array | Passed through to SDK as-is |
| 3 | With `system` param as string | OpenAI-style system | Also passed through |
| 4 | No `system` param | `system` undefined | Not included in request body |
| 5 | Cache tokens from API | API returns cache fields | Extracted and returned (default 0 if missing) |

---

## 10. Token Check Middleware (`tokenCheck.js`)

**Approach:** Unit test — mock `req`, `res`, `next`.

| # | Test | Conditions | Expected |
|---|------|-----------|----------|
| 1 | User has remaining tokens | `total_tokens=100000`, `used_tokens=50000`, `remaining=50000` | Calls `next()`, sets `req.tokenRemaining = 50000` |
| 2 | User exhausted | `total_tokens=100000`, `used_tokens=100000`, `remaining=0` | Returns 429: "Token quota exhausted" |
| 3 | User exceeded | `total_tokens=100000`, `used_tokens=150000`, `remaining=-50000` | Returns 429 (remaining <= 0) |
| 4 | Anonymous user | `req.user = null` or `undefined` | Calls `next()` immediately, no token check |
| 5 | User with `total_tokens=0` | `total_tokens=0`, `used_tokens=0`, `remaining=0` | Blocked (remaining=0) |
| 6 | User with `total_tokens=0`, used negative (edge) | `total_tokens=0`, `used_tokens=-100` | `remaining=100` → passes (unlikely but handled) |

**Edge Cases:**
| # | Scenario | Expected |
|---|----------|----------|
| EC1 | `total_tokens` missing/null on user object | `undefined - used_tokens = NaN`, `NaN <= 0` is false → passes. May need fix. |
| EC2 | `used_tokens` missing/null | Same NaN issue |
| EC3 | Response sent twice check | `res.status(429).json()` called only once — no double-send |

---

## Summary: Mocking Strategy

| Service | Mocking Approach | Key Mocks |
|---------|-----------------|-----------|
| `tokenBudget.service.js` | Pure unit — no mocks needed | N/A |
| `chat.controller.js` | Mock all dependencies | `supabase`, `dispatchToAI`, `buildRAGContext`, `buildContextMessages`, `cache.service`, `logAnalytics` |
| `chat.routes.js` | Integration + mock services | Same as controller + mock SSE `res.write` |
| `rag.service.js` | Mock axios, GoogleGenerativeAI, supabase | `axios.post`, `supabase.rpc`, `supabase.from` |
| `fileUpload.service.js` | Mock fs, supabase | `fs.readFile`, `supabase.from`, `pdf-parse`, `mammoth`, `JSZip` |
| `cache.service.js` | Mock supabase | `supabase.from().select().eq().maybeSingle()`, `.rpc()` |
| `context.service.js` | Mock supabase | `supabase.from('messages').select()` |
| `summary.service.js` | Mock fetch/axios | `fetch()`, `GoogleGenerativeAI` |
| `claude.service.js` | Mock Anthropic SDK | `Anthropic()`, `client.messages.create()` |
| `openrouter.service.js` | Mock `callOpenAICompatible` | Stub return `{ text, tokensUsed, cacheCreationTokens, cacheReadTokens }` |
| `deepseek.service.js` | Mock axios | `axios.post` |
| `mistral.service.js` | Mock axios | `axios.post` |
| `groq.service.js` | Mock Groq SDK | `Groq()`, `client.chat.completions.create()` |
| `unified.service.js` | Mock OpenAI SDK | `OpenAI()`, `client.chat.completions.create()` |
| `tokenCheck.js` | Pure unit — mock req/res/next | `req.user`, `res.status().json()`, `next()` |
