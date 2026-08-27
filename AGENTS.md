# Multi-AI Chat — AI Agent Context & Rules

This document provides essential context about the codebase, deployment environment, cloud infrastructure, free-tier quotas, and architectural conventions. Any AI assistant working on this project must follow these rules without requiring the user to re-explain.

---

## 1. Hosting & Cloud Infrastructure

### Vercel (Frontend & Backend)
- **Tier**: **Free / Hobby Tier**
- **Region**: **Mumbai, India (`bom1`)**
- **Serverless Execution Timeout**: **300 seconds** (`maxDuration: 300` in `backend/vercel.json` and Vercel portal)
- **Serverless Request Body Limit**: **4.5MB edge payload limit**
- **Vercel Blob Storage**:
  - Store Name: `multi-chat-upload-storage`
  - Region: **Mumbai (`bom1`)**
  - Access Mode: **Private** (`access: 'private'`)
  - Integration: Connected to `multi-ai-chat-backend` (`BLOB_READ_WRITE_TOKEN`, `BLOB_STORE_ID`, `BLOB_WEBHOOK_PUBLIC_KEY`)

### Supabase (Database & Vectors)
- **Tier**: **Free Tier**
- **Region**: **Singapore (`ap-southeast-1`)**
- **Storage Limits**: **500MB Database storage cap**
- **Extensions**: `pgvector` for dense 1536/1024-dimension vector search, Full-Text Search (`pg_trgm` / `tsvector`)

---

## 2. Critical Architectural Rules

### File Upload & Storage Strategy
1. **Never Save Large Base64 Strings to Postgres**:
   - Because Supabase Free Tier has a 500MB DB limit, raw file binaries/Base64 strings MUST NOT be stored in table columns like `uploaded_files_rag.file_content`.
   - Instead, files are uploaded directly from the browser to **Private Vercel Blob** via `@vercel/blob/client`, and only the `blob_url` pointer is persisted in PostgreSQL.
2. **Direct Browser-to-Storage Upload Pipeline & Collision-Proof Namespacing**:
   - Files up to **50MB** are uploaded directly from client (`upload(...)` in `useChatSession.js` and `KnowledgePage.jsx`) to private Vercel Blob via `/api/upload/blob-handler`.
   - Upload paths are hierarchically namespaced: `uploads/${topicId}/${Date.now()}_${cleanFileName}` and `knowledge/${collectionId}/${Date.now()}_${cleanFileName}` with `addRandomSuffix: true` to prevent filename collisions between concurrent users.
   - The backend then processes the private blob via `/api/upload/process-blob` or `/api/knowledge/collections/:id/documents/process-blob` using streaming SSE progress.
   - This completely bypasses Vercel's 4.5MB serverless edge body limit.
3. **Private Blob Access & On-Demand Fallback**:
   - Private blobs do NOT have public CDN URLs.
   - File downloads are proxied and streamed via `GET /api/upload/download/:fileId` with user authentication and ownership validation.
   - `getFileContent` includes an automatic fallback to fetch the full file buffer directly from private Vercel Blob storage if database text is missing.
4. **Pasted Image Compression**:
   - Clipboard screenshots are compressed to <= 1600px / JPEG 85% via HTML5 Canvas in `useChatComposer.js` before being sent over chat stream payloads.
5. **Direct DB Upload Toggle (`upgDB`)**:
   - In `ChatMemoryControls.jsx` under Advanced settings, users can check `upgDB` (`storeInDb: true`) to store files directly in PostgreSQL Base64.
   - For files > 2.5MB in `upgDB` mode, client slices files into 2MB chunks via `/api/upload/chunk/*` to bypass Vercel's 4.5MB edge limit before assembling in Postgres. Default remains Vercel Blob (up to 50MB).

---

## 3. Supported & Blocked File Types

- **Supported Formats (up to 50MB)**:
  - **Text & Logs**: `.txt`, `.text`, `.log`, `.rtf`, `.tex`, `.latex`, `.rst`, `.adoc`, `.asciidoc`, `.srt`, `.vtt`, `.sub`
  - **Documents & Spreadsheets**: `.pdf`, `.docx`, `.doc`, `.xlsx`, `.xls`, `.csv`, `.tsv`, `.tab`, `.odt`, `.pages`, `.epub`, `.ppt`, `.pptx`, `.odp`, `.key`
  - **Data & Config**: `.json`, `.jsonl`, `.ndjson`, `.geojson`, `.xml`, `.yaml`, `.yml`, `.toml`, `.ini`, `.conf`, `.cfg`, `.config`, `.properties`, `.env`, `.lock`
  - **Code**: `.js`, `.mjs`, `.cjs`, `.jsx`, `.ts`, `.mts`, `.cts`, `.tsx`, `.py`, `.ipynb`, `.java`, `.kt`, `.scala`, `.groovy`, `.c`, `.cpp`, `.h`, `.hpp`, `.cs`, `.go`, `.rs`, `.zig`, `.d`, `.nim`, `.rb`, `.php`, `.swift`, `.m`, `.mm`, `.dart`, `.r`, `.lua`
  - **Web**: `.html`, `.htm`, `.css`, `.scss`, `.sass`, `.less`, `.vue`, `.svelte`, `.astro`, `.sql`, `.graphql`, `.proto`, `.prisma`, `Dockerfile`, `.gitignore`
  - **Archives**: `.zip`, `.tar`, `.gz`, `.tgz`, `.7z`, `.rar`, `.bz2`, `.xz`
  - **Images**: `.png`, `.jpg`, `.jpeg`, `.webp`, `.gif`, `.bmp`, `.tiff`, `.ico`, `.svg`
- **Blocked Risky Executables & Binaries**:
  - `.exe`, `.dll`, `.so`, `.dylib`, `.bin`, `.com`, `.scr`, `.sys`, `.drv`, `.cpl`, `.msc`, `.hta`, `.vbs`, `.vbe`, `.wsf`, `.wsh`, `.pif`, `.gadget`, `.msi`, `.msp`, `.pkg`, `.deb`, `.rpm`, `.apk`, `.app`, `.ipa`, `.iso`, `.img`, `.vmdk`, `.dmg`, `.jar`, `.class`, `.reg`, `.chm`

---

## 4. Key Services & Code Structure

- `backend/services/blobStorage.service.js`: Wrapper around `@vercel/blob` (`get`, `del`, `head`, `setBlobClient`, `fetchPrivateBlobBuffer`, `deleteBlobFromStorage`).
- `backend/services/fileUpload.service.js`: RAG ingestion, ZIP safety validation, text extraction, blob URL persistence, hybrid grep/vector search with Cohere cross-encoder reranking and 429 rate-limit resilience.
- `backend/services/rag.service.js`: Topic RAG context building, pgvector similarity search with Cohere cross-encoder reranking fallback.
- `backend/services/documentLoader.service.js`: Unified loader for PDF, Word, Excel, CSV, text, code, and images with OCR/Vision fallback.
- `backend/services/chatPipeline.service.js`: Unified AI pipeline for streaming, reasoning tokens, tool loops, and temporal grounding.
- `backend/services/contextWindow.service.js`: Measures the assembled prompt against the model's real window and evicts only when it genuinely does not fit. Owns the eviction ladder, the cache-stable low-water mark, and the merge of retrieved context into the user turn.
- `backend/services/ai/promptCache.service.js`: Single place that understands each provider's prompt-cache dialect (Anthropic / OpenAI / DeepSeek / Gemini field names), builds the per-conversation `prompt_cache_key`, and places the Anthropic history breakpoint.
- `backend/services/toolProcessor.service.js`: Tool execution dispatcher, SRE diagnostic digest scanner, SAP ST22 parser, web search cross-referencing loop.
- `backend/services/rag2.service.js`: Advanced RAG 2.0 (RAPTOR trees, GraphRAG, multi-query expansion, Cohere reranking).
- `frontend/src/pages/hooks/useChatSession.js`: Chat SSE streaming, Vercel Blob client direct upload.
- `frontend/src/pages/KnowledgePage.jsx`: Knowledge collection management, document indexing, web crawl, chunk inspection.

---

## 5. Prompt Context, Model Limits & Token Rules

1. **Raw Prompt Preservation (Secondary LLM Query Compression Disabled)**:
   - Query compression via secondary LLMs (OpenRouter Gemini Flash Lite) is disabled for all models to preserve raw prompt fidelity (e.g. big data, logs, code, stack traces) without unexpected background token consumption.
   - A lightweight local regex pass (`compressPrompt`) removes conversational polite filler phrases (e.g. "please help me") for inputs >50 characters without altering substantive prompt payload.
2. **Model Context Windows — Measure and Evict (`contextWindow.service.js`)**:
   - Each model accepts raw input up to its declared capacity (e.g., Codestral: 256K, Ministral 14B: 128K, Mistral Small / Medium / Large: 128K, DeepSeek V4: 128K, Claude Sonnet 5: 200K, Gemini/Groq: 5,999).
   - The percentage budgets in `tokenBudget.service.js` size **retrieval** (how much RAG/file text to fetch). They are soft targets and must always sum to <= 100%. They are **not** the safety mechanism.
   - The prompt is assembled raw, measured, and sent **untouched** when it fits — the normal path on a 128K-256K model, where a long conversation is never trimmed just for being long. The same array object is returned so the prefix stays byte-identical and provider prompt caches keep hitting.
   - When it genuinely does not fit, eviction runs in a fixed order, **never mid-message**: disposable retrieved context (web/URL) -> oldest whole history turns (floor of `CONTEXT_MIN_RECENT_MESSAGES`) -> remaining retrieved context -> the current query as a last resort (floor of `CONTEXT_MIN_QUERY_TOKENS`).
   - Eviction runs down to a **low-water mark** (`CONTEXT_EVICTION_TARGET_RATIO`, default 0.85), not merely under the ceiling. Trimming the bare minimum would overflow again next turn and mutate the prefix on every request, collapsing the provider cache-hit rate.
   - `context_too_large` is now returned only when eviction has spent every lever and the turn is genuinely impossible. Previously any overflow landed there.
   - Tool rounds are budgeted against what the base prompt actually left, not a flat share of the window.
3. **Embedding Vector Safety (Supabase 500MB Cap)**:
   - Query embeddings and post-turn cross-chat memory embeddings (`embedText` / `embedAndStoreMessage`) are bounded to <= 6,000 / 3,000 tokens to prevent provider crashes, runaway embedding costs, and database storage bloat under Supabase's 500MB free-tier limit.
4. **Reserved Output Tokens & Safety Margin**:
   - A flat **8,192** tokens are reserved for the reply on models with $\ge 32\text{k}$ context; models below that reserve 25% of their window (800-4,000). A 128K and a 200K model write replies of the same order, so scaling the reserve with the window would only waste prompt space history could use. Override with `CONTEXT_RESERVED_OUTPUT_TOKENS`.
   - A further **safety margin** (`CONTEXT_SAFETY_MARGIN_RATIO`, default 6%) sits below the usable window. Token counts here are estimates and they drift worst on dense logs and stack traces — exactly this app’s traffic — so the margin is what stops an underestimate becoming a provider-side rejection.
   - `estimateTokens` takes `max(char, word)` rather than the average, is density-aware (3 chars/token for structured text vs 4 for prose), and counts multimodal image parts (~1,200 each). `trimTextByTokens` is self-calibrating and verified against the estimator, so a trim to N tokens never returns more than N.

---

## 5b. Prompt Caching (Provider Prefix Reuse)

Verified live 2026-08-28. Do not "simplify" any of the below without re-measuring — every failure mode here is silent: the API returns a normal answer and only the bill moves.

1. **Prompt order is load-bearing**:
   - Order is `system (static, the ONLY system block) | ...history... | [temporal + per-turn tools + retrieved context + question]`.
   - **The raw-history window is anchored to its OLDEST message, and that anchor only moves in `HISTORY_WINDOW_STEP` jumps (default 10).** Taking "the newest N" slid the window by one every turn, so the first history message differed on every request and the prefix diverged right where the history began — invalidating the cache on every single turn for any thread longer than the window (20 messages by default). Measured live on a 32-message conversation: **768 cached tokens per turn before, 3,072-3,456 and rising after (6.4x across three turns)**. Between jumps the history grows append-only, which is why the figure climbs.
   - **The conversation summary sits after the raw turns, not before them.** It is regenerated roughly every 12 messages; at the head of the history each regeneration invalidated every raw turn behind it. `buildContextMessages` returns it as `olderSummary` and the pipeline places it in the volatile block.
   - **Nothing conditional may enter `staticSystem`.** It is fixed for the life of a conversation on one model, and that is the only reason a provider can serve it plus the history from cache. Anything that varies per message rewrites the prefix and takes the whole history cache with it. Three things were moved out for exactly this reason: the temporal clock, the conditional tool advertisements (`SEARCH_KB` when a knowledge base is attached, `WEB_SEARCH` when the per-message toggle is on), and the identity directive (added only on a turn that asks what model this is). Verified live with the clock changing *and* the web toggle flipping between turns: cache holds at 2,176 tokens per turn.
   - **Temporal grounding is not a system block.** It carries a live clock quantised to `TEMPORAL_PRECISION_MS` (60s), so it is byte-identical only for turns less than a minute apart. Sitting ahead of the history it broke the prefix there on essentially every real conversation. Measured live on DeepSeek with turns spaced minutes apart: **640 cached tokens with it as a system block, 2,176 with it moved in beside the question** — and the 640 was a hard ceiling regardless of how long the thread grew.
   - Placing it later *as a system message* does not work either: Claude hoists every system message into its top-level `system` field regardless of array position. Leaving the system role is the only fix that works across providers.
   - Retrieved context is deliberately **not** a system block. It changes every turn, and a provider cache keys on an exact prefix, so anything volatile placed ahead of the history breaks the prefix there and the whole conversation is re-read at full price. Moving it beside the question took the cacheable prefix from ~1K to ~85K tokens on a long thread.
   - It also reads better: models attend worst to the middle of a long context ("lost in the middle", arXiv 2307.03172), and this puts retrieved passages at the end, next to the question they answer.
   - The volatile block (temporal + retrieved context) travels as its own message flagged `__volatileContext` so the window fitter can still drop whole sections by priority, then `mergeVolatileIntoQuery` folds it into the user turn before dispatch — providers see one message and role alternation holds.

2. **Per-provider mechanics** (each differs; the dialects are normalised in `promptCache.service.js`):
   - **Mistral** (the default model) — caching is **NOT automatic**. Without `prompt_cache_key` the API simply does not cache and says nothing about it. Measured: 0 cached tokens without the key, 1,152 with. Minimum prefix 64 tokens, 1h TTL, cached tokens bill at ~10%.
   - **DeepSeek** — automatic, no parameter. Reports `prompt_cache_hit_tokens`. Hits bill at $0.014/M against $0.14/M uncached. Measured 2,432 tokens served from cache on turn two.
   - **OpenAI** — automatic above 1,024 tokens; `prompt_cache_key` is a routing hint OpenAI recommends setting explicitly.
   - **Groq / Gemini** — automatic; read-only metrics.
   - **Claude** — explicit `cache_control` breakpoints. The system field alone holds ~959 tokens here, under Anthropic's 1,024 floor, and a sub-minimum breakpoint is **accepted and then silently ignored** — which is why caching never engaged. The breakpoint that pays sits at the end of the conversation history. Writes bill at 1.25x, so both Claude paths check the minimum before paying for a cache that can never be read.

3. **Usage field names differ per provider and reading the wrong one fails silently** — always go through `extractCacheUsage`:
   - Anthropic `cache_creation_input_tokens` / `cache_read_input_tokens`
   - OpenAI, Mistral, Groq `prompt_tokens_details.cached_tokens`
   - DeepSeek `prompt_cache_hit_tokens` / `prompt_cache_miss_tokens`
   - Gemini `usageMetadata.cachedContentTokenCount`

4. **Cache lifetime differs sharply per provider — do not generalise**:
   - **DeepSeek**: disk-backed, persists **hours to days**. No parameter, and no TTL problem.
   - **Mistral**: 1 hour. No parameter.
   - **Groq / Gemini**: automatic. No parameter.
   - **Anthropic**: 5 minutes by default, 1 hour available at a higher write rate — set via `ANTHROPIC_CACHE_TTL` (defaults to `1h` here). Writes are charged on the delta past the previous breakpoint, so the premium applies to one turn's worth while the read covers the whole history at 0.1x. Anthropic also requires longer-TTL entries to appear before shorter ones, which one shared TTL satisfies by construction.
   - **OpenAI**: `in_memory` (5-10 min idle) by default, `24h` available. `OPENAI_PROMPT_CACHE_RETENTION` is deliberately unset — accepted values are model-dependent (GPT-5.6+ only `30m`, GPT-5.5 only `24h`), so a blanket value risks rejected requests.

5. **Switching model mid-conversation**: caches never transfer between providers. A switch costs exactly one cold turn; turns after it re-warm normally because system + history stay stable. Switching back later may re-hit the earlier cached prefix while it is still within TTL.

6. **`cacheHit` vs prompt cache — do not merge these again**:
   - `cacheHit` / `query_analytics.cache_hit` means *the reply came from our own exact/semantic response cache, no model was called*. It drives the UI "(Cached)" badge and the admin reply-cache-rate tile.
   - Prompt-cache volume is `cacheReadTokens` / `cacheCreationTokens` and the `prompt_cache_*_tokens` columns. Feeding `cacheHit` from those would mark nearly every DeepSeek reply "(Cached)" and pin the admin tile near 100%.

---

## 6. Log Diagnostics, SAP ST22 & Dynamic Web Cross-Referencing

1. **SAP ST22 Sectional Parser (`parseSAPShortDump`)**:
   - Automatically detects SAP short dumps and extracts the 8 canonical diagnostic sections verbatim: Runtime Error, Exception, Where Terminated, Source Code Extract (with `>>>` line), Active Calls / Call Stack, System Variables (`SY-SUBRC`, `SY-UNAME`, `SY-TCODE`, `SY-TABIX`), Error Analysis, and Resolution steps.
   - Filters out multi-megabyte internal table dumps and raw hex memory blocks to conserve token context.
2. **Multi-Technology Crash Classifier (Logdy & OpenObserve Architecture)**:
   - Covers non-SAP logs across Linux (kernel panics, OOM killer, SIGSEGV), Databases (Sybase/ASE, PostgreSQL, Oracle, MySQL deadlocks), and Application runtimes (Java, Python, Node.js).
   - Extracts Boot/Init sequence (first 120 lines), up to 35 high-signal incident clusters with 8-line context windows across all lines, and Crash/Shutdown state (last 150 lines).
3. **Small/Medium Log Raw Passthrough**:
   - Files $\le 250\text{KB}$ ($\le 1,200$ lines) are delivered 100% full raw with zero filtering.
4. **Dynamic Web Search + Log Cross-Referencing Loop**:
   - When Web search is enabled, the AI can query `[WEB_SEARCH:query="..."]` on unfamiliar vendor error codes or crash signatures (e.g. `SQL30012`, `ORA-00600`) to understand root causes, then cross-reference and verify related parameters in uploaded logs with `[SEARCH_FILES:query="..."]`.
5. **Cohere Cross-Encoder Reranking & 429 Rate-Limit Resilience**:
   - When searching uploaded files/logs (`searchUserFilesRAG`) or building topic RAG context (`buildRAGContext`), candidate log grep lines ($\pm 4$ lines) and pgvector chunks are cross-encoder reranked via Cohere (`rerank-v3.5`) to promote true root-cause crash signatures over superficial keyword matches.
   - **Free-Tier 429 Protection**: Under Cohere free-tier limits (10 RPM / 1,000 monthly searches), HTTP 429 responses never halt or break a turn; the system activates an in-memory cooldown (default 60s or respecting `Retry-After`), logs a clean warning, skips outbound network calls during cooldown, and immediately returns the un-reranked keyword/vector candidates.

---

## 7. Atomic Cascade Deletion Guarantees (Zero-Orphan Architecture)

1. **Topic Deletion (`DELETE /api/chat/topics/:id`)**:
   - Deletes all blobs in Vercel Blob for that topic (`deleteBlobFromStorage`).
   - Executes atomic RPC `delete_topic_cascade` (cleans `messages`, `uploaded_files_rag`, `uploaded_files` -> `rag_chunks`, `query_cache`, `rag_documents`, and `topics`).
2. **File Deletion (`DELETE /api/upload/:fileId`)**:
   - Deletes physical blob from Vercel Blob.
   - Deletes `uploaded_files_rag` and `uploaded_files` (cascading to all `rag_chunks`).
3. **User Deletion (`DELETE /api/admin/users/:id`)**:
   - Deletes all Vercel Blobs across chats and knowledge collections for that user.
   - Executes atomic RPC `delete_user_cascade` across all 18 related database tables.

---

## 8. Embedding & Ingestion Configuration

1. **Default Embedding Provider (`DEFAULT_EMBEDDING_PROVIDER`)**:
   - Configurable via `DEFAULT_EMBEDDING_PROVIDER=openrouter` (default, `openai/text-embedding-3-small` in 1536 dims) or `DEFAULT_EMBEDDING_PROVIDER=mistral` (`mistral-embed` in 1024 dims).
   - Seamless failover across same-space providers (OpenRouter $\leftrightarrow$ OpenAI).
2. **PDF OCR & Vision Models**:
   - PDF OCR chain order: OpenRouter file-input tier first (`PDF_OCR_FALLBACK_MODEL`, default `google/gemini-2.5-flash-lite`), then Mistral OCR (`PDF_OCR_MODEL`, default `mistral-ocr-latest`) as the per-page-billed fallback.
   - Vision (image reading) chain order: DeepSeek (`VISION_DEEPSEEK_MODEL`, default `deepseek-v4-flash`) → Mistral (`VISION_FREE_MODEL`, default `mistral-small-latest`) → OpenRouter vision models (`VISION_MODEL`, default `google/gemini-2.5-flash-lite`, then `gemini-3.1-flash-lite`), with local Tesseract.js OCR as the final no-network fallback.
   - `VISION_PREFER_FREE` is retired; chain order is fixed as above.
