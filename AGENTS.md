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
2. **Direct Browser-to-Storage Upload Pipeline**:
   - Files up to **50MB** are uploaded directly from client (`upload(...)` in `useChatSession.js` and `KnowledgePage.jsx`) to private Vercel Blob via `/api/upload/blob-handler`.
   - The backend then processes the private blob via `/api/upload/process-blob` or `/api/knowledge/collections/:id/documents/process-blob` using streaming SSE progress.
   - This completely bypasses Vercel's 4.5MB serverless edge body limit.
3. **Private Blob Access**:
   - Private blobs do NOT have public CDN URLs.
   - File downloads are proxied and streamed via `GET /api/upload/download/:fileId` with user authentication and ownership validation.
4. **Pasted Image Compression**:
   - Clipboard screenshots are compressed to <= 1600px / JPEG 85% via HTML5 Canvas in `useChatComposer.js` before being sent over chat stream payloads.

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

- `backend/services/blobStorage.service.js`: Wrapper around `@vercel/blob` (`get`, `del`, `head`, `setBlobClient`).
- `backend/services/fileUpload.service.js`: RAG ingestion, ZIP safety validation, text extraction, blob URL persistence.
- `backend/services/documentLoader.service.js`: Unified loader for PDF, Word, Excel, CSV, text, code, and images with OCR/Vision fallback.
- `backend/services/chatPipeline.service.js`: Unified AI pipeline for streaming, reasoning tokens, tool loops, and temporal grounding.
- `backend/services/rag2.service.js`: Advanced RAG 2.0 (RAPTOR trees, GraphRAG, multi-query expansion, Cohere reranking).
- `frontend/src/pages/hooks/useChatSession.js`: Chat SSE streaming, Vercel Blob client direct upload.
- `frontend/src/pages/KnowledgePage.jsx`: Knowledge collection management, document indexing, web crawl, chunk inspection.
