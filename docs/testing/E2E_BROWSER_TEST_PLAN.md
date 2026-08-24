# E2E Browser Test Plan (Manual, via Playwright MCP)

## Baseline

- **Tests defined as of commit:** `cce1dfd` — "RAG 2.0 completed" (2026-08-21)
- **Target environment:** https://multi-ai-chat-frontend.vercel.app/chat (production, Vercel)
- **Method:** Interactive browser testing driven by an AI agent using the Playwright MCP tools (`browser_navigate`, `browser_click`, `browser_snapshot`, etc.) against the live deployed app — not the automated Playwright spec suites in `e2e/` and `e2e-real/` (those are separate, code-based tests; see `TESTING.md`, `E2E_TEST_SUMMARY.md`).
- **Auth:** No credentials are stored here. A human enters username/password into the browser when the agent reaches the login screen.

## How to keep this file current

1. Every time you run a session against this plan, update the **Status** and **Last Run** columns below.
2. When new features land after commit `cce1dfd`, append new test cases to the relevant section (or a new section) — do **not** rewrite history that's already covered.
3. Bump the **Baseline** commit hash at the top only after all cases tied to that range have been executed at least once.
4. Run `git log --oneline <old-baseline>..HEAD` to see exactly what shipped since the last update and translate it into new test cases before re-baselining.

Status values: `Not Run` | `Pass` | `Fail` | `Blocked` | `Skipped`

---

## 1. Authentication

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 1.1 | Unauthenticated redirect | Open `/chat` while logged out | Redirected to `/login` | Pass | 2026-08-21 | |
| 1.2 | Login success | Enter valid username/password, submit | Redirected to chat screen, sidebar loads | Pass | 2026-08-21 | User logged in manually as `test` (admin) |
| 1.3 | Login failure | Enter invalid credentials | Inline error shown, stays on login | Not Run | | |
| 1.4 | Logout | Trigger logout from menu | Returns to `/login`, session cleared | Not Run | | |
| 1.5 | Admin role redirect | Log in as admin user, navigate to `/admin` | Admin dashboard loads (not bounced to login) | Pass | 2026-08-21 | |

## 2. Core Chat

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 2.1 | Send basic message | Type a message, submit | User bubble + streamed assistant reply appear | Pass | 2026-08-21 | |
| 2.2 | Streaming renders incrementally | Watch response while it streams | Text appears progressively, not all-at-once | Pass | 2026-08-21 | Observed "..." typing indicator then progressive render on image-gen turn |
| 2.3 | Copy button | Hover/click copy on a text bubble and a code block | Content copied, button shows confirmation | Blocked | 2026-08-21 | Copy button present on every bubble; click-to-clipboard not verified (no clipboard read in this session) |
| 2.4 | New chat | Click "New chat" in sidebar | Fresh empty chat session created | Pass | 2026-08-21 | Also auto-creates a new chat on first message from welcome screen |
| 2.5 | Open existing chat | Click a prior chat in sidebar | Correct history loads | Pass | 2026-08-21 | |
| 2.6 | Delete chat | Delete a chat from sidebar | Removed from list, no longer selectable | Pass | 2026-08-21 | Confirmation dialog shown, chat removed from list correctly. **Caution:** see the "Cleanup incident" note below — the delete confirmation dialog does not name which chat it's deleting, which contributed to deleting the wrong chat during cleanup. |
| 2.7 | Retry button | Force/trigger a failed response, click retry | Message re-sent, new response streams | Not Run | | |
| 2.8 | Thinking toggle | Toggle "thinking"/reasoning visibility on | Reasoning panel appears with model's reasoning trace | Pass | 2026-08-21 | "Thought for Ns" collapsible panel appeared on Groq/Gemini turns |
| 2.9 | Reasoning effort levels | Open submenu for level (low/med/high/xhigh) and switch | Model list filters to models supporting that level | Pass | 2026-08-21 | Per-model "Reasoning effort" submenu button confirmed present |
| 2.10 | Chat queue popover | Send multiple messages quickly / open queue popover | Queued messages shown correctly | Not Run | | |
| 2.11 | Memory controls | Open chat memory controls, verify cross-chat memory toggle | Setting persists and affects context sharing | Pass | 2026-08-21 | "Advanced" reveals "Last N msgs" + "RAG on" checkbox |

## 3. Model Selection

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 3.1 | Default model | Open a fresh chat | Default model (e.g. deepseek-v4-flash equivalent) pre-selected | Pass | 2026-08-21 | DeepSeek V4 Flash |
| 3.2 | Switch model | Open model selector, pick a different model | Selection persists for subsequent messages | Pass | 2026-08-21 | Switched to Gemini Flash 3.7 (Free) and back to DeepSeek V4 Flash |
| 3.3 | Unified model modal | Open the unified model modal | Full model list with level/category filters renders | Pass | 2026-08-21 | Grouped by provider (DeepSeek, Groq, Gemini, Mistral, Anthropic, OpenRouter) with level + price badges |
| 3.4 | Model list filtered by level | Change level (low/high/xhigh) | Only compatible models listed | Pass | 2026-08-21 | Each model row shows its own level badge (Medium/High/Minimal) |
| 3.5 | Model choice remembered | Pick a model, reload page/new chat | Last-used model remembered | Not Run | | |

## 4. Composer (+) Menu & File Upload

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 4.1 | Open plus menu | Click "+" button in chat input | Menu opens with Knowledge Base / Manage options | Pass | 2026-08-21 | |
| 4.2 | Attach knowledge base to message | Select a KB collection from plus menu, send message | Selected collection badge shown; response uses RAG context | Pass | 2026-08-21 | See 5.12; also see cross-chat leakage bug noted under 5.13 |
| 4.3 | Clear KB selection | Use "clear" control after selecting collections | Selection reset to none | Pass | 2026-08-21 | Clicking "Clear Selection" removed the KB attachment; also confirmed a brand-new chat still showed the collection as pre-selected before clearing, reproducing bug 5.14 |
| 4.4 | Upload single file | Use upload control, attach one file, send | Upload progress shown, file processed, response references it | Pass | 2026-08-21 | DeepSeek V4 Flash correctly read uploaded .txt content |
| 4.5 | Upload multiple files | Attach 2+ files at once | All files upload in parallel, all processed | Not Run | | |
| 4.6 | Large file upload | Upload a large file (near limit) | Upload succeeds or shows correct limit error | Not Run | | Composer shows hint "max 4MB each" |
| 4.7 | Upload false-positive popup | Upload a valid file | No spurious "upload failed" popup appears | Pass | 2026-08-21 | File chip showed cleanly, no error toast on valid upload |
| 4.8 | Drag and drop upload | Drag a file onto the chat window | Drop zone highlights, file attaches | Not Run | | |
| 4.9 | **[BUG]** File + KB combined on a free/limited model | Attach a file, select a KB collection, ask a question needing both, using Gemini Flash 3.7 (Free) | Response uses both sources | **Fail** | 2026-08-21 | Returned empty answer plus error toast "The selected LLM model is unavailable or no longer supported." Retried identical request on DeepSeek V4 Flash — worked correctly (see 5.12/4.4). Likely a free-tier Gemini + file-upload/RAG combination issue, not a general RAG bug. |

## 5. Knowledge Base / RAG 2.0

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 5.1 | Navigate to Knowledge page | Go to knowledge base management page | Collections list loads (no stray top blank/reference bar) | Pass | 2026-08-21 | |
| 5.2 | Create collection | Click create, fill name/description/color, save | New collection appears in list | Pass | 2026-08-21 | Created "E2E Test Collection" |
| 5.3 | Public vs private collection | Toggle "public" on a collection | Public badge shown; accessible workspace-wide | Not Run | | |
| 5.4 | Upload document to collection | Open collection, upload a file | Document appears with processing → success status | Not Run | | Covered indirectly via 5.6 (text note) instead of file upload |
| 5.5 | Crawl URL into collection | Use "crawl" modal, enter URL + depth/max pages | Crawl job starts, pages ingested as documents | Pass | 2026-08-21 | Crawled https://example.com — alert "Crawl complete! Successfully indexed 1 pages.", new "Example Domain" doc appeared as source type "Web Crawl", status Indexed |
| 5.6 | Add raw text/markdown | Use "add text" modal, enter title + markdown content | Document created directly from text | Pass | 2026-08-21 | "E2E Fact Sheet" note indexed instantly (1 doc, 1 chunk) |
| 5.7 | Inspect chunks | Click "Inspect Chunks" on a document | Chunk viewer opens showing split content | Pass | 2026-08-21 | Showed chunk text, token count, section heading |
| 5.8 | Delete document | Delete a document from a collection | Removed from list, collection doc count updates | Pass | 2026-08-21 | Confirm dialog named the doc ("Delete document \"Example Domain\"?"); doc count updated 2→1 immediately |
| 5.9 | Delete collection | Delete an entire collection | Collection removed, contained docs gone | Pass | 2026-08-21 | Confirm dialog named the collection and warned "This cannot be undone"; collection removed, page returned to empty state |
| 5.10 | Search collections | Type in the collections search box | List filters to matching collections | Not Run | | (Artifacts-sidebar search was tested instead, see 7.2) |
| 5.11 | Failed document shows error | Trigger a bad upload (unsupported/corrupt file) | Status pill shows "failed" with error message on hover | Not Run | | |
| 5.12 | RAG-enabled response | Attach a KB collection in chat, ask a question answerable only from it | Response uses retrieved content, not generic knowledge | Pass | 2026-08-21 | Asked for the note's secret codeword; got "ZEBRA-4471" with citation card "[1] E2E Fact Sheet 100%" |
| 5.13 | Always-enable KB when selected | Select a collection once, send several follow-up messages | KB stays applied without re-selecting each time | Pass (with caveat) | 2026-08-21 | KB selection persisted across messages as intended, but also **bled into a separate, unrelated chat** (image-generation chat) that never had the collection attached — see finding below |
| 5.14 | **[BUG]** KB selection leaks across chats | In Chat A, attach a KB collection and send a message. Switch to unrelated Chat B (never attached KB). Send a message in Chat B. | Chat B should have no KB citations | **Fail** | 2026-08-21 | The unrelated "Generate an image..." chat (Groq GPT-OSS 120B) showed an "[1] E2E Fact Sheet 100%" citation card on every turn, despite that chat never having the KB collection selected via its own composer. Selection/RAG-on state appears to be global/sticky rather than scoped per chat. |

## 6. File Generation & Approval Flow

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 6.1 | Request image/file generation | Ask assistant to generate an image | Approval prompt appears with tool label and prompt preview | Pass | 2026-08-21 | Tested with image generation (not PPT); approval card showed generated prompt + "Yes, generate / Other / No" |
| 6.2 | Vague generation request | Ask for a file with insufficient detail | Clarification form shown instead of immediate generation | Pass | 2026-08-21 | Free-tier Groq model asked clarifying questions in plain text on the first pass |
| 6.3 | Submit clarification | Fill and submit the clarification form | Generation proceeds with clarified parameters | Pass | 2026-08-21 | Structured "Clarify" form (Subject/Style/Usage fields + Continue button) confirmed distinct from the text-based clarification in 6.2; required Subject field, showed inline "Enter subject." validation when empty |
| 6.4 | Approve generation | Click "Approve" on approval prompt | File generated, file card appears in chat | Pass | 2026-08-21 | Clicked "Yes, generate" → PNG image produced with "Generated Files" card |
| 6.5 | Reject generation | Click "Reject"/decline on approval prompt | Generation cancelled, no file produced | Not Run | | "No" button confirmed present on approval card |
| 6.6 | Revise via instructions | Click "Other", enter custom instructions, resubmit | Revised approval prompt reflects new instructions | Not Run | | "Other" button confirmed present on approval card |
| 6.7 | Download generated file | Click download on a file card | File downloads and matches what was generated | Not Run | | Download button confirmed present on file card; click not exercised in this sandboxed session |
| 6.8 | Large generated content preview | Generate content >300 lines/chars | Only code/preview shown, no raw inline dump per file-card behavior | Not Run | | |
| 6.9 | Other formats (DOCX/XLSX/CSV/HTML/PPT) | Repeat generation flow for each format | Correct file type produced and downloadable | Not Run | | Only PNG image tested this round |
| 6.10 | PPT theme variety | Generate PPT and check theme applied | Theme renders correctly in output | Not Run | | |
| 6.11 | Clarification loop robustness | Answer clarifying questions with free-form text on a weaker/free model | Model proceeds to approval after reasonable answers | Observed friction | 2026-08-21 | Groq GPT-OSS 120B (Free) looped through 3 rounds of clarification (text Q&A, then structured form twice) before reaching the approval card, even after explicit "generate now, no more questions" instructions — usable but slow/verbose on this model tier. Not a hard bug, but worth revisiting model-specific tool-use tuning. |

## 7. Artifacts Sidebar

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 7.1 | Open artifacts sidebar | Click artifacts icon/tab | Sidebar opens listing uploaded/generated artifacts | Pass | 2026-08-21 | Shows both uploads and generated files (txt, pptx seen from history) |
| 7.2 | Filter artifacts | Use filter/search in artifacts panel | List narrows to matches | Pass | 2026-08-21 | Typing "e2e-upload" correctly narrowed list to the 2 matching txt artifacts |
| 7.3 | Preview artifact | Click an artifact | Preview renders correctly | Pass | 2026-08-21 | Opens in new tab, renders plain-text content correctly |
| 7.4 | Delete artifact | Delete an artifact from sidebar | Removed from list and no longer referenced in chat | Pass | 2026-08-21 | Confirm dialog named the exact filename; artifact removed from list immediately after confirming |

## 8. Web Search / Internet Access

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 8.1 | Enable web search toggle | Turn on "web" option, ask a current-events question | Response includes web-sourced info/citations | Pass | 2026-08-21 | Asked for today's date + a live headline; got correct date and 3 real, cited headlines (BBC News, Reuters, AP) with a working outbound link |
| 8.2 | Web-only restriction | With web checked, verify non-web tools aren't silently used | Behavior matches "restrict usage to web only when checked" | Not Run | | |
| 8.3 | URL rendering in chat | Paste a URL in a message | URL content scraped/rendered (Firecrawl → Tavily → Exa fallback chain) | Pass | 2026-08-21 | Pasted a Wikipedia random-article URL; response correctly fetched and summarized the actual page content ("The Light Shines On" by ELO), rendered as clickable link |
| 8.4 | Deep site scan | Ask a question requiring crawling a site beyond one page | Multiple pages considered in response | Not Run | | |
| 8.5 | **[OBSERVATION]** Web search toggle does not reset per new chat | Toggle web search on, send a message, start a new chat | New chat's web search state | Observed | 2026-08-21 | Web search stayed enabled after switching chats in this session — consistent with the same "global rather than per-chat toggle" pattern seen with KB selection (5.14); not confirmed as a bug, but worth checking alongside it |

## 9. Admin Dashboard

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 9.1 | Load admin tabs | Log in as admin, open `/admin` | All tabs (users, analytics, etc.) load without bouncing to login | Pass | 2026-08-21 | API Status, Users, Analytics tabs all confirmed |
| 9.2 | Analytics display | Open analytics tab | Charts/metrics render with data | Pass | 2026-08-21 | Total Queries, Total Tokens, Cache Hits/Rate, daily chart, model usage donut, top-queries table all populated |
| 9.3 | Create user | Use "create user" modal, fill fields, save | New user appears in list | Not Run | | Not exercised against production user table — real user data, deferred to avoid pollution |
| 9.4 | Edit user | Edit an existing user's fields | Changes persist after save | Not Run | | Same reason as 9.3 |
| 9.5 | Delete user | Delete a user | User removed from list | Not Run | | Same reason as 9.3 — destructive against real accounts, intentionally skipped |
| 9.6 | Admin dark mode | Toggle theme while on admin page | Admin UI switches themes cleanly (no unstyled flash) | Pass | 2026-08-21 | Dark → shows "Light Mode" label correctly, no flash observed in screenshot |
| 9.7 | API Status tab | Open API Status tab | Provider health cards render | Pass | 2026-08-21 | Anthropic/OpenAI/Groq/Gemini/OpenRouter/Together/AnyAPI/Supabase all "active" — add this as a tracked case going forward |

## 10. UI / Theme / Layout

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 10.1 | Theme toggle | Switch light/dark theme | All screens (chat, admin, knowledge, login) respect theme | Pass (partial) | 2026-08-21 | Verified on Admin page; chat/knowledge/login not re-checked this round |
| 10.2 | Mobile viewport chat | Resize/emulate mobile width (390×844), open chat | No blank white top bar; layout renders correctly | Pass | 2026-08-21 | Clean layout, no blank bar, hamburger menu icon present |
| 10.3 | Mobile nav | On mobile width, use hamburger/mobile nav drawer | Navigation between chat/knowledge/admin works | Pass (with gap) | 2026-08-21 | Drawer opens/closes cleanly with New Chat, Chats, Artifacts, Recent list, profile, Admin Panel, Logout. **Gap:** the "Knowledge Bases" nav link present on desktop is missing from the mobile drawer entirely — no way to reach KB management from a mobile viewport. |
| 10.4 | Mobile file upload | On mobile width, upload a file | Upload bar/behavior works same as desktop | Pass | 2026-08-21 | Same "Click to select files" UI as desktop; uploaded a .txt file and got a correct answer referencing its content |
| 10.5 | Token usage bar | Send messages, observe token bar | Usage updates and reflects consumption | Pass | 2026-08-21 | Bar and "(N left)" figure updated correctly after each message/upload/generation |
| 10.6 | Toast notifications | Trigger an error (e.g. bad upload) | Toast appears, auto-dismisses, doesn't stack indefinitely | Pass | 2026-08-21 | Inline banner "The selected LLM model is unavailable or no longer supported." appeared on the Gemini+file+KB failure (see bug 4.9) |
| 10.7 | Scrollbar styling | Scroll a long chat | Custom scrollbar size/color renders (not browser default) | Not Run | | |
| 10.8 | Composer overlay close behavior | Open the "+" composer menu, press Escape or click elsewhere | Menu closes promptly | Minor friction | 2026-08-21 | After selecting a KB collection, the `+` menu overlay intercepted the next click for a few seconds (click on textbox timed out); Escape didn't close it immediately either — it did close a moment later on its own. Not fully blocking, but worth a look if it recurs. |

## 11. Security

| # | Test Case | Steps | Expected | Status | Last Run | Notes |
|---|---|---|---|---|---|---|
| 11.1 | XSS in chat input | Send a message containing `<script>`/HTML payload | Rendered as inert text, not executed | Pass | 2026-08-21 | Sent `<script>window.__xssProbe=true;</script><img src=x onerror="window.__xssProbe2=true">`; rendered as literal text in the user bubble, `window.__xssProbe`/`__xssProbe2` both stayed `false` (checked via `browser_evaluate`) |
| 11.2 | XSS in generated/rendered content | Trigger content that echoes user input (e.g. file name) | No script execution in the DOM | Pass | 2026-08-21 | Assistant reply (which echoed part of the payload back per instructions) also rendered as inert markdown/text, no script execution |
| 11.3 | Auth guard on direct navigation | Directly navigate to `/admin` or `/chat` as a non-privileged/logged-out user | Correctly blocked/redirected | Not Run | | Covered indirectly by 1.1 (logged-out redirect); not tested with a non-admin logged-in user hitting `/admin` directly |
| 11.4 | ~~**[BUG, high]** Composer "+" menu overlay permanently stuck~~ → **Escape does not close the "+" menu** | Open the "+" menu, press Escape | Menu closes | **Fixed** (was mis-reported as High) | 2026-08-21 | **Retracted as a freeze.** Code review found a working `onClick={() => setOpen(false)}` on the overlay; the original evidence was invalid (DOM checked synchronously in the same tick as the dispatched click, before React flushed; and the Playwright timeouts were on the *textbox*, which the overlay correctly blocks while open). Real defect: no keydown listener, so Escape did nothing — fixed by adding one. Severity High → Low. |
| 11.5 | **[BUG, critical — code review, not browser]** Stored XSS in artifact preview | Upload a file whose name/content contains HTML, preview it from the Artifacts sidebar | Content rendered inert | **Fixed** | 2026-08-21 | `safe()` in `Sidebar.jsx`/`MobileNav.jsx` had identity-only replacements (`.replace(/&/g,'&')`), so no escaping occurred before `document.write()`. Same-origin preview window ⇒ script would run with the user's session/token. Confirmed at byte level. Not reachable via the chat-message path tested in 11.1/11.2 (React escapes there). |

---

## Findings From 2026-08-21 Run — all triaged in code and fixed

Every finding below was traced to a specific line before being fixed. One was
**downgraded** and one **new, more severe** issue was found during that review.

1. **[Fixed — Critical, found during code review, NOT during browser testing]**
   **Stored XSS in artifact preview.** `Sidebar.jsx` and `MobileNav.jsx` both
   defined an HTML escaper whose replacements were all identity operations —
   `.replace(/&/g, '&')`, `.replace(/</g, '<')`, etc. The entities
   (`&amp;`, `&lt;`, …) had been lost at some point, so `safe()` did nothing.
   Its output went straight into `newWindow.document.write()` with the
   artifact's `file_name` and `content`. Because `window.open('', '_blank')` is
   same-origin with the app, a file containing `<img src=x onerror=…>` would
   execute with the user's session and token on preview. Verified at byte level
   with `od -c` — not a tooling artifact. **Fixed:** real entity escaping in
   both files, ampersand first to avoid double-escaping.
   *Note: browser test 11.1/11.2 passed only because chat messages render
   through React, which escapes correctly — that path never touched this sink.*
2. **[Fixed — Medium]** KB collection selection leaked across chats.
   `selectedCollectionIds` was session-global state in `useChatSession.js` and
   was reset by neither `handleTopicSelect` nor `handleNewChat`, while being
   sent on every request. **Fixed:** cleared in both handlers. See 5.14, 4.3.
3. **[Fixed — Medium]** Web search toggle stayed armed across chats.
   `webEnabled` in `useChatComposer.js` was never reset, yet its own tooltip
   claimed "on for **this query**". **Fixed:** disarmed on chat switch/new chat
   via wrappers in `ChatPage.jsx`, and the tooltip now says "this chat" so the
   UI matches the behaviour. See 8.5.
4. **[Fixed — Medium]** The 3-round clarification loop was a **backend logic
   bug**, not model verbosity as originally assumed. Two causes in
   `chatPipeline.service.js`: (a) `hasEnoughDetails` for images only tested for
   the prepositions `of|for|showing|with`, so a fully-specified prompt
   ("red apple on plain white background, photorealistic, top-down") was judged
   too vague; (b) the only suppression guard checked the *current message* for
   `[ARTIFACT DETAILS]`, so the next plain-language follow-up mentioning the
   artifact re-armed a fresh empty form — the loop. **Fixed:** added a
   conversation-level `conversationHadClarification()` guard, and a length
   fallback for the image detail check. See 6.11.
5. **[Fixed — Medium]** "The selected LLM model is unavailable or no longer
   supported" was a misleading catch-all. `chatCleanup.service.js` matched a
   **bare `|model|`**, which appears in nearly every provider error, and ran
   *before* the api-key, connection and timeout branches — so those were all
   reported as a dead model. This is very likely what actually happened in 4.9
   (a context/payload-size failure on Gemini free tier, mislabelled).
   **Fixed:** narrowed to real model-availability phrases. See 4.9.
6. **[Fixed — Gap]** Mobile nav drawer had no "Knowledge Bases" link.
   `MobileNav.jsx` is a separate reimplementation of the sidebar and never got
   the entry `Sidebar.jsx` has. **Fixed:** added, with matching CSS for both
   themes. See 10.3.
7. **[Fixed — Safety]** The delete-chat confirmation said only "Delete this
   conversation?" without naming it, while the KB/artifact dialogs did name
   their target. Combined with the list re-ordering after each delete, this
   caused the wrong chat to be deleted during cleanup. **Fixed:** both sidebars
   now name the chat and warn that its generated files go too.
8. **[DOWNGRADED — was reported as "Fail, high"; actually a minor UX gap]**
   The composer "+" overlay was reported as permanently stuck. Code review of
   `ComposerPlusMenu.jsx` shows the overlay has a working
   `onClick={() => setOpen(false)}`. **The original evidence was invalid:** the
   DOM was checked with `querySelector` synchronously in the same tick as the
   dispatched click, before React could flush the state update, so "still-open"
   was a false reading both times; and the Playwright timeouts were on the
   *textbox*, which the overlay correctly blocks while the menu is open. The
   one real defect is that **nothing listened for Escape**. **Fixed:** added an
   Escape handler. See 11.4 — severity corrected from High to Low.

## Cleanup Incident (2026-08-21)

While deleting test chats after this run, **one of the three pre-existing "Generate an image..." chats that already existed in this account before testing began** was accidentally deleted, along with the test conversation that had been added to it. The other two pre-existing "Generate an image..." chats were confirmed intact afterward. This was caused by the generic, unnamed delete-confirmation dialog (see finding #6) combined with the chat list re-ordering after each deletion. This cannot be undone from the browser session. Flagging directly so you're aware — apologies for the mistake.

## Cleanup Completed (2026-08-21)

All test data created during this run was removed by the end of the session:
- Knowledge Base collection "E2E Test Collection" and its documents — deleted.
- Uploaded artifacts `e2e-upload-test.txt` (×2) and `mobile-upload-test.txt` — deleted.
- Generated PNG (`image_a_photorealistic_red_apple_centered_on_*.png`) — deleted.
- Test chats ("pong", "secret codeword", "xssProbe", "today's date") — deleted.

No test data should remain in production as of the end of this session, aside from the unintended loss described in "Cleanup Incident" above.

## Not Yet Covered (candidates for next test-writing pass)

- Session/JWT expiration handling mid-session
- Token usage hard-limit enforcement (blocking further messages)
- Multi-user concurrent approval flows
- Network failure / reconnect during streaming
- Performance/latency budgets
- Accessibility (keyboard nav, screen reader) audit
- Web-only restriction behavior (8.2), deep multi-page crawl (8.4)
- Reject/revise approval flow (6.5, 6.6), file download click-through (6.7)
- Non-image generation formats: PPT/DOCX/XLSX/CSV/HTML (6.9, 6.10)
- Destructive admin mutations (9.3-9.5) — intentionally skipped against real user accounts
- Copy-to-clipboard verification (2.3), retry button (2.7), chat queue popover (2.10)
- Public/private collection toggle (5.3), failed-upload error state (5.11)
- Root-cause the composer-plus-overlay stuck state (11.4) and the global vs. per-chat KB/web-search persistence (5.14, 8.5)

## Change Log

| Date | Commit at time of edit | Change |
|---|---|---|
| 2026-08-21 | `cce1dfd` | Initial version of this manual browser test plan, derived from full git history (236 commits) up to "RAG 2.0 completed". |
| 2026-08-21 | `cce1dfd` | First execution pass against production, logged in as admin `test`. Covered auth, core chat, model selection, composer/file upload, KB/RAG 2.0 (create/note/inspect/retrieve), image generation + approval flow, artifacts sidebar, and admin dashboard tabs. Found 2 real bugs (4.9, 5.14) and 1 minor UI friction (10.8). Test data left in production for review. |
| 2026-08-21 | `cce1dfd` | **Code-review + fix pass** over every finding raised in the two test runs. Traced each to a specific line before fixing. Downgraded 11.4 (the "stuck overlay") to a missing Escape handler after finding the original browser evidence was methodologically invalid, and found a **new critical stored-XSS** in the artifact preview path that browser testing had missed entirely (the no-op HTML escaper in `Sidebar.jsx`/`MobileNav.jsx`). 8 fixes total across 9 files; frontend build green, backend suite 488/488 green, changed regex/guard logic verified with targeted scripts. Fixes are local only — **not yet deployed**, so none are re-verified against production. |
| 2026-08-21 | `cce1dfd` | Second execution pass same session: covered remaining "Not Run" items — web search (§8), XSS/security (§11), mobile viewport/nav/upload (§10.2-10.4), KB crawl-URL ingestion (5.5), document/collection/artifact/chat deletion (5.8, 5.9, 7.4, 2.6, 4.3). Found 2 more issues: a **stuck composer-overlay bug** requiring a page reload to recover (11.4, upgraded from the earlier "minor" 10.8 framing), and a **missing Knowledge Bases link in the mobile nav drawer** (10.3). All test data cleaned up by end of session — see "Cleanup Completed." **One pre-existing user chat was accidentally deleted during cleanup** — see "Cleanup Incident" above. Still Not Run: reject/revise approval (6.5-6.6), non-image generation formats (6.9-6.10), destructive admin mutations (9.3-9.5, intentionally skipped), deep multi-page crawl (8.4), copy-to-clipboard (2.3), retry (2.7), queue popover (2.10), public/private KB toggle (5.3), failed-upload error state (5.11). |
