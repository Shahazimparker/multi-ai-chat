import { useCallback, useEffect, useRef, useState } from 'react';
import { put as vercelBlobPut } from '@vercel/blob/client';
import api, { API_BASE_URL } from '../../config/api';
import { createSseParser } from '../../utils/sse';
import { getCsrfToken } from '../../utils/sessionBroadcast';

export const useChatSession = ({ refreshTokenStats }) => {
  const [models, setModels] = useState([]);
  const [messages, setMessages] = useState([]);
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(null);
  const [activeTopic, setActiveTopic] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [error, setError] = useState('');
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');
  const [memoryMode, setMemoryMode] = useState('accurate');
  const [historyLimit, setHistoryLimit] = useState(8);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [storeInDb, setStoreInDb] = useState(false);
  const storeInDbRef = useRef(false);
  storeInDbRef.current = storeInDb;
  const [selectedCollectionIds, setSelectedCollectionIds] = useState([]);
  const [unifiedProvider, setUnifiedProvider] = useState(null);
  const [providerModelId, setProviderModelId] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [failedMessage, setFailedMessage] = useState(null);
  // Thinking is a property of the model, not of one message — unlike the Web
  // toggle, which is a per-query intent and lives in the composer. Both maps
  // are keyed by model id so each model keeps its own setting as the user
  // switches. Session only: everything resets to the model's documented
  // default on reload.
  const [thinkingByModel, setThinkingByModel] = useState({});
  const [effortByModel, setEffortByModel] = useState({});

  // null means "use the model's default", which the server resolves. Storing
  // per model id keeps each model's choice separate as the user switches.
  const reasoningEffort = model ? (effortByModel[model.id] ?? null) : null;

  // Addressed by id, for the case where the model and its effort are chosen in
  // the same gesture: the level must land on the model being switched to, not
  // on whichever one `model` still holds until React commits setModel.
  const setReasoningEffortFor = useCallback((modelId, level) => {
    if (!modelId) return;
    setEffortByModel((prev) => ({ ...prev, [modelId]: level }));
  }, []);
  const setReasoningEffort = useCallback((level) => {
    if (!model) return;
    setReasoningEffortFor(model.id, level);
  }, [model, setReasoningEffortFor]);

  // Until the user touches the toggle for a model, follow the default the
  // server reports. That is off everywhere except providers with no off switch
  // (Gemini), so reasoning is always a deliberate choice where it can be one.
  const modelThinkingDefault = Boolean(model?.reasoning?.enabledByDefault);
  const thinkingEnabled = model
    ? (thinkingByModel[model.id] ?? modelThinkingDefault)
    : false;
  const setThinkingEnabled = useCallback((next) => {
    if (!model) return;
    setThinkingByModel((prev) => ({
      ...prev,
      [model.id]: typeof next === 'function' ? next(prev[model.id] ?? modelThinkingDefault) : next,
    }));
  }, [model, modelThinkingDefault]);

  // Same reason as setReasoningEffortFor. Takes a plain boolean only — there is
  // no current value to build a functional update on for another model.
  const setThinkingEnabledFor = useCallback((modelId, enabled) => {
    if (!modelId) return;
    setThinkingByModel((prev) => ({ ...prev, [modelId]: Boolean(enabled) }));
  }, []);

  const abortControllerRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const uploadSessionIdRef = useRef(null);
  const queuePopoverRef = useRef(null);

  useEffect(() => {
    const savedSid = sessionStorage.getItem('uploadSessionId');
    if (!savedSid) return;
    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const { data } = await api.get(`/upload/status/${savedSid}`);
          if (!data.active) {
            sessionStorage.removeItem('uploadSessionId');
            if (!cancelled) {
              setUploadProgress(0);
              setUploadMessage('');
            }
            return;
          }
          if (!cancelled) {
            setLoading(true);
            setUploadProgress(data.progress);
            setUploadMessage(data.message || '');
            uploadSessionIdRef.current = savedSid;
          }
          if (data.status === 'done' || data.status === 'aborted' || data.status === 'error') {
            setTimeout(() => {
              if (!cancelled) {
                setUploadProgress(0);
                setUploadMessage('');
                setLoading(false);
              }
            }, 3000);
            sessionStorage.removeItem('uploadSessionId');
            return;
          }
        } catch {
          if (!cancelled) {
            setUploadProgress(0);
            setUploadMessage('');
          }
          sessionStorage.removeItem('uploadSessionId');
          return;
        }
        await new Promise((resolve) => setTimeout(resolve, 2000));
      }
    };
    poll();
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    api.get('/chat/models')
      .then((res) => setModels(res.data.models || []))
      .catch(() => {});
  }, []);

  const handleTopicSelect = useCallback(async (topic) => {
    setActiveTopic(topic);
    setMessages([]);
    // Attached knowledge bases belong to the conversation they were picked in.
    // Carrying them into the next one silently cites documents the user never
    // attached here.
    setSelectedCollectionIds([]);
    try {
      const res = await api.get(`/history/topics/${topic.id}/messages`);
      setMessages(res.data.messages.map((entry) => {
        // generated_files is JSONB — may be array, string (double-encoded from earlier bug), or null
        let gf = [];
        if (Array.isArray(entry.generated_files)) {
          gf = entry.generated_files;
        } else if (typeof entry.generated_files === 'string') {
          try { gf = JSON.parse(entry.generated_files); } catch { gf = []; }
          if (!Array.isArray(gf)) gf = [];
        }
        return {
          role: entry.role,
          content: entry.content,
          model: entry.model,
          tokensUsed: entry.tokens_used,
          created_at: entry.created_at,
          generatedFiles: gf,
          // Undefined when the opt-in reasoning migration has not been applied;
          // the panel simply does not render in that case.
          reasoning: entry.reasoning || undefined,
        };
      }));
    } catch {
      setMessages([]);
    }
    if (topic.model && models.length > 0) {
      const matched = models.find((entry) => entry.id === topic.model);
      if (matched) setModel(matched);
    }
  }, [models]);

  const handleNewChat = useCallback(() => {
    setActiveTopic(null);
    setMessages([]);
    setError('');
    setSelectedCollectionIds([]);
  }, []);

  const uploadSingleFile = useCallback(async (file, topicIdToUse) => {
    setUploadProgress(0);
    setUploadMessage(`Uploading ${file.name}...`);

    let blobResult = null;
    let blobUploadSucceeded = false;
    let chunkUploadId = null;

    const isDbMode = Boolean(storeInDbRef.current || storeInDb);

    if (isDbMode) {
      if (file.size > 2.5 * 1024 * 1024) {
        const CHUNK_SIZE = 2 * 1024 * 1024;
        const totalChunks = Math.ceil(file.size / CHUNK_SIZE);
        setUploadMessage(`Splitting ${file.name} into ${totalChunks} chunks for database upload...`);

        const initRes = await api.post('/upload/chunk/init', {
          fileName: file.name,
          fileSize: file.size,
          fileType: file.type,
          totalChunks,
        });

        chunkUploadId = initRes.data?.uploadId;
        if (!chunkUploadId) {
          throw new Error('Failed to initialize chunked database upload');
        }

        for (let i = 0; i < totalChunks; i++) {
          if (uploadAbortRef.current?.signal?.aborted) {
            await api.post(`/upload/chunk/${chunkUploadId}/abort`).catch(() => {});
            throw new DOMException('Aborted', 'AbortError');
          }

          const start = i * CHUNK_SIZE;
          const end = Math.min(file.size, start + CHUNK_SIZE);
          const blobSlice = file.slice(start, end);

          const reader = new FileReader();
          const base64Data = await new Promise((resolve, reject) => {
            reader.onloadend = () => {
              const res = reader.result;
              const base64 = typeof res === 'string' ? res.split(',')[1] : '';
              resolve(base64);
            };
            reader.onerror = reject;
            reader.readAsDataURL(blobSlice);
          });

          setUploadMessage(`Uploading chunk ${i + 1} of ${totalChunks} directly to database...`);
          setUploadProgress(Math.round(((i + 0.5) / totalChunks) * 50));

          await api.post(`/upload/chunk/${chunkUploadId}`, {
            chunkIndex: i,
            totalChunks,
            fileName: file.name,
            fileType: file.type,
            chunkData: base64Data,
          });

          setUploadProgress(Math.round(((i + 1) / totalChunks) * 50));
        }

        setUploadMessage(`Reassembling & indexing ${file.name}...`);
      } else {
        setUploadMessage(`Uploading ${file.name} directly to database...`);
      }
    } else {
      try {
        setUploadMessage(`Authorizing upload...`);
        const tokenRes = await api.post('/upload/blob-handler', {
          type: 'blob.generate-client-token',
          payload: {
            pathname: file.name,
            clientPayload: null,
            multipart: file.size > 5 * 1024 * 1024,
          },
        });

        const clientToken = tokenRes.data?.clientToken;
        if (!clientToken) {
          throw new Error('Failed to generate upload authorization token');
        }

        setUploadMessage(`Uploading to secure storage...`);
        blobResult = await vercelBlobPut(file.name, file, {
          access: 'private',
          token: clientToken,
          multipart: file.size > 5 * 1024 * 1024,
          onUploadProgress: (progress) => {
            const pct = Math.round((progress.percentage || 0) * 0.45);
            setUploadProgress(pct);
            setUploadMessage(`Uploading to secure storage (${Math.round(progress.percentage || 0)}%)...`);
          },
          abortSignal: uploadAbortRef.current?.signal,
        });

        if (blobResult?.url) {
          blobUploadSucceeded = true;
        }
      } catch (blobErr) {
        console.warn('[ChatSession] Direct blob upload error or fallback:', blobErr.message);
        if (file.size > 4 * 1024 * 1024) {
          throw new Error(blobErr.message || 'File upload to storage failed');
        }
      }
    }

    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      let endpoint = `${API_BASE_URL}/upload/file`;
      if (blobUploadSucceeded) {
        endpoint = `${API_BASE_URL}/upload/process-blob`;
      } else if (chunkUploadId) {
        endpoint = `${API_BASE_URL}/upload/chunk/${chunkUploadId}/finalize`;
      }

      xhr.open('POST', endpoint);
      xhr.withCredentials = true;
      xhr.timeout = 600000;
      const csrfToken = getCsrfToken();
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      if (blobUploadSucceeded || chunkUploadId) {
        xhr.setRequestHeader('Content-Type', 'application/json');
      } else {
        xhr.upload.onprogress = (event) => {
          if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
        };
      }

      // Per-request state.
      const parser = createSseParser();
      let parsedLen = 0;
      let sseError = null;
      let doneEvent = null;

      const consume = (events) => {
        for (const data of events) {
          if (data.type === 'init' && data.sessionId) {
            uploadSessionIdRef.current = data.sessionId;
            sessionStorage.setItem('uploadSessionId', data.sessionId);
          }
          if (data.type === 'error' || data.type === 'aborted') {
            sseError = data.error || 'Upload failed';
          }
          if (data.type === 'done') doneEvent = data;
          if (data.type === 'progress' && typeof data.percent === 'number') {
            const displayPercent = blobUploadSucceeded || chunkUploadId
              ? 50 + Math.round((data.percent / 100) * 50)
              : data.percent;
            setUploadProgress(displayPercent);
            if (data.message) setUploadMessage(data.message);
          }
        }
      };

      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 3 && xhr.readyState !== 4) return;
        const chunk = xhr.responseText.substring(parsedLen);
        parsedLen = xhr.responseText.length;
        consume(parser.push(chunk));
      };

      xhr.onload = () => {
        consume(parser.flush());

        if (xhr.status >= 200 && xhr.status < 300) {
          if (sseError) reject(new Error(sseError));
          else resolve(doneEvent || { fileName: file.name });
          return;
        }

        let errorMessage = sseError || 'Upload failed';
        if (!sseError) {
          try {
            const parsed = JSON.parse(xhr.responseText);
            if (parsed.error) errorMessage = parsed.error;
          } catch {
            /* not JSON — keep the default message */
          }
        }
        reject(new Error(errorMessage));
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file.'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

      if (uploadAbortRef.current?.signal) {
        uploadAbortRef.current.signal.addEventListener('abort', () => xhr.abort());
      }

      if (blobUploadSucceeded || chunkUploadId) {
        xhr.send(JSON.stringify({
          ...(blobUploadSucceeded ? { blobUrl: blobResult.url, fileName: file.name } : {}),
          topicId: topicIdToUse || null,
          modelId: model.id,
          ragEnabled,
        }));
      } else {
        const formData = new FormData();
        formData.append('file', file);
        formData.append('modelId', model.id);
        formData.append('ragEnabled', ragEnabled);
        if (topicIdToUse) formData.append('topicId', topicIdToUse);
        xhr.send(formData);
      }
    });
  }, [model, ragEnabled, storeInDb]);

  const sendMessage = useCallback(async (msgText, filesArr, image, isRetry = false, forceWebSearch = false) => {
    let finalMessage = String(msgText).trim();
    const files = filesArr || [];
    setFailedMessage({ text: finalMessage, files, image, forceWebSearch: Boolean(forceWebSearch) });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    uploadAbortRef.current = new AbortController();
    setError('');

    const fileNames = files.map((entry) => entry.name);
    const userMsgContent = fileNames.length > 0
      ? (finalMessage ? `${finalMessage}\n${fileNames.map((name) => `📎 ${name}`).join('\n')}` : fileNames.map((name) => `📎 ${name}`).join('\n'))
      : finalMessage;
    if (!isRetry) {
      setMessages((prev) => [...prev, { role: 'user', content: userMsgContent, created_at: new Date().toISOString() }]);
    }
    setLoading(true);

    try {
      let topicIdToUse = activeTopic?.id || null;
      const uploadedResults = [];
      for (const file of files) {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'user') {
            const doneList = uploadedResults.map((entry) => `📎 ✅ \`${entry.fileName}\``).join('\n');
            const stillUploading = files.slice(uploadedResults.length).map((entry) => `📎 \`${entry.name}\``).join('\n');
            const textPart = finalMessage ? `${finalMessage}\n` : '';
            updated[updated.length - 1] = { ...last, content: `${textPart}${doneList}${doneList ? '\n' : ''}${stillUploading}\n⏳ Uploading \`${file.name}\`...` };
          }
          return updated;
        });
        const result = await uploadSingleFile(file, topicIdToUse);
        uploadedResults.push(result);
      }

      // Uploads deduct embedding tokens server-side (upload.routes.js) as
      // soon as each file finishes — independent of whether the chat message
      // below succeeds. Refresh here too (not just after the message at the
      // end of this function) so the counter doesn't sit stale if the
      // subsequent /chat/stream call fails or the user aborts the send.
      if (uploadedResults.length > 0) {
        await refreshTokenStats();
      }

      sessionStorage.removeItem('uploadSessionId');
      setTimeout(() => {
        setUploadProgress(0);
        setUploadMessage('');
      }, 3000);

      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'user') {
          const doneList = uploadedResults.map((entry) => `📎 ✅ \`${entry.fileName}\``).join('\n');
          const textPart = finalMessage ? `${finalMessage}\n` : '';
          updated[updated.length - 1] = { ...last, content: `${textPart}${doneList}` };
        }
        return updated;
      });

      if (uploadedResults.length > 0) {
        const refs = uploadedResults.map((entry) => `[File uploaded: ${entry.fileName}]`).join('\n');
        finalMessage = finalMessage ? `${finalMessage}\n${refs}` : refs;
      }

      const headers = { 'Content-Type': 'application/json' };
      const csrfToken = getCsrfToken();
      if (csrfToken) headers['X-CSRF-Token'] = csrfToken;
      const response = await fetch(`${API_BASE_URL}/chat/stream`, {
        method: 'POST',
        headers,
        credentials: 'include',
        body: JSON.stringify({
          message: finalMessage,
          image,
          topicId: topicIdToUse,
          modelId: model.id,
          providerModelId,
          memoryMode,
          historyLimit: Number(historyLimit),
          ragEnabled,
          forceWebSearch: Boolean(forceWebSearch),
          selectedCollectionIds,
          thinkingEnabled,
          reasoningEffort,
          // The server has no way to know where the user is — a serverless host
          // runs in UTC. Without this, "today" and "next Friday" resolve in the
          // wrong zone for anyone outside it. Advisory: the backend validates
          // it and prefers the saved profile setting when there is one.
          clientTimeZone: Intl.DateTimeFormat().resolvedOptions().timeZone,
        }),
        signal: controller.signal,
      });
      // A bare "Stream failed" hid the actual cause — a 401 from an expired
      // session and a 403 from a missing CSRF cookie looked identical to a
      // provider outage. Surface what the server actually said.
      if (!response.ok) {
        let detail = '';
        try {
          const body = await response.json();
          detail = body?.error || '';
        } catch {
          /* non-JSON error body — the status alone will have to do */
        }
        throw new Error(detail || `Request failed (HTTP ${response.status})`);
      }

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let metadata = {};
      let streamingText = '';
      let reasoningTextAcc = '';
      let reasoningStartedAt = null;
      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true, statusMessage: null, created_at: new Date().toISOString() }]);

      const parser = createSseParser();
      let streamEnded = false;

      while (!streamEnded) {
        const { done, value } = await reader.read();
        // `stream: true` keeps multi-byte characters intact across chunk edges.
        const text = done ? decoder.decode() : decoder.decode(value, { stream: true });
        const events = done ? [...parser.push(text), ...parser.flush()] : parser.push(text);

        for (const data of events) {
          {
            if (data.type === 'error') {
              setError(data.error);
              streamEnded = true;
              break;
            }
            // Chain of thought — its own panel, never the answer bubble.
            // `reasoningStartedAt` drives the live "Thinking for 14s" counter;
            // it is stamped once so the timer measures the whole thinking
            // phase, not the gap between deltas.
            if (data.type === 'reasoning') {
              if (reasoningStartedAt === null) reasoningStartedAt = Date.now();
              reasoningTextAcc += data.text;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    reasoning: reasoningTextAcc,
                    reasoningStartedAt,
                    reasoningDone: false,
                    statusMessage: null,
                  };
                }
                return updated;
              });
              continue;
            }
            // The server streamed text that turned out to be a tool call's
            // preamble, not part of the answer. Drop it and start the bubble
            // over from the round that follows the tool.
            if (data.type === 'reset') {
              streamingText = '';
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, content: '', streaming: true };
                }
                return updated;
              });
              continue;
            }
            if (data.type === 'approval_request') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    approvalRequest: {
                      id: data.approvalId,
                      toolType: data.toolType,
                      toolLabel: data.toolLabel,
                      message: data.message,
                      summary: data.summary || '',
                      options: data.options || ['yes', 'other', 'no'],
                    },
                    streaming: false,
                    statusMessage: null,
                  };
                }
                return updated;
              });
              continue;
            }
            if (data.type === 'clarification_request') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    clarificationRequest: {
                      intent: data.intent,
                      formId: data.formId,
                      message: data.message,
                      questions: Array.isArray(data.questions) ? data.questions : [],
                    },
                    streaming: false,
                    statusMessage: null,
                  };
                }
                return updated;
              });
              continue;
            }

            if (data.type === 'citations') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = {
                    ...last,
                    citations: data.citations || [],
                  };
                }
                return updated;
              });
              continue;
            }

            if (data.type === 'status') {
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                if (last && last.role === 'assistant') {
                  updated[updated.length - 1] = { ...last, statusMessage: data.message || 'Working...', streaming: true };
                }
                return updated;
              });
            }
            if (data.type === 'chunk') {
              streamingText += data.text;
              // The first answer token marks the end of thinking: freeze the
              // counter at its final value so the collapsed header reads
              // "Thought for 14s" instead of counting up forever.
              const reasoningJustFinished = reasoningStartedAt !== null;
              const reasoningElapsedMs = reasoningJustFinished ? Date.now() - reasoningStartedAt : null;
              setMessages((prev) => {
                const updated = [...prev];
                const last = updated[updated.length - 1];
                updated[updated.length - 1] = {
                  ...last,
                  content: streamingText,
                  statusMessage: null,
                  ...(reasoningJustFinished && !last.reasoningDone
                    ? { reasoningDone: true, reasoningElapsedMs }
                    : {}),
                };
                return updated;
              });
            } else if (data.type === 'done') {
              metadata = data;
              fullReply = streamingText;
            }
          }
        }

        if (done) streamEnded = true;
      }

      if (metadata.topicId) topicIdToUse = metadata.topicId;
      // Start with server-generated binary files (images, PPTs) from done event
      const generatedFiles = Array.isArray(metadata.generatedFiles) ? [...metadata.generatedFiles] : [];
      if (fullReply) {
        const fileBlockRegex = /```(\w+)\n([\s\S]*?)```/g;
        const fileLangs = new Set(['html', 'htm', 'js', 'jsx', 'ts', 'tsx', 'css', 'json', 'xml', 'md', 'svg', 'py', 'sql', 'sh']);
        let fileMatch;
        let fileIdx = 0;
        const extractFileName = (code, lang, idx) => {
          const ext = lang === 'htm' ? 'html' : lang;
          const lines = code.split('\n');
          const firstLine = lines[0]?.trim() || '';
          const secondLine = lines[1]?.trim() || '';
          if (lang === 'html' || lang === 'htm') {
            const titleMatch = code.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) return `${titleMatch[1].trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')}.${ext}`;
          }
          const commentMatch = firstLine.match(/^(?:\/\/|#|<!--?|%)\s*(.+)/);
          const commentMatch2 = secondLine.match(/^(?:\/\/|#|<!--?|%)\s*(.+)/);
          const descComment = commentMatch?.[1] || commentMatch2?.[1];
          if (descComment) {
            const name = descComment.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').substring(0, 40);
            if (name.length > 3) return `${name}.${ext}`;
          }
          const namePatterns = [
            /(?:export\s+)?(?:default\s+)?(?:function\s+|fn\s+)(\w+)/,
            /(?:export\s+)?(?:default\s+)?class\s+(\w+)/,
            /(?:export\s+)?(?:default\s+)?(?:const|let|var)\s+(\w+)/,
            /def\s+(\w+)/,
            /(?:export\s+)?default\s+(\w+)/,
          ];
          for (const pattern of namePatterns) {
            const match = code.match(pattern);
            if (match) return `${match[1]}.${ext}`;
          }
          if (lang === 'css') {
            const selMatch = code.match(/\.([\w-]+)\s*\{/);
            if (selMatch) return `${selMatch[1]}.css`;
          }
          const labels = { html: 'page', js: 'script', jsx: 'component', ts: 'module', tsx: 'component', css: 'styles', json: 'data', xml: 'config', md: 'document', svg: 'graphic', py: 'script', sql: 'query', sh: 'script' };
          return `${labels[lang] || 'file'}_${idx + 1}.${ext}`;
        };

        while ((fileMatch = fileBlockRegex.exec(fullReply)) !== null) {
          const lang = fileMatch[1];
          if (!fileLangs.has(lang)) continue;
          const content = fileMatch[2].trim();
          const fileName = extractFileName(content, lang, fileIdx);
          try {
            const res = await api.post('/upload/generate-file', {
              topicId: topicIdToUse,
              fileName,
              content,
              fileType: lang,
              messageId: metadata.assistantMessageId || null,
            });
            if (res.data?.file) generatedFiles.push(res.data.file);
          } catch (uploadError) {
            console.error('[saveGeneratedFile]', uploadError);
          }
          fileIdx++;
        }
      }

      setMessages((prev) => {
        const updated = [...prev];
        // Also stop the counter here: a turn that reasoned but produced no
        // answer text never hit the chunk branch, and would otherwise be left
        // ticking forever.
        const prevMsg = updated[updated.length - 1] || {};
        updated[updated.length - 1] = {
          ...prevMsg,
          streaming: false,
          statusMessage: null,
          model: metadata.model,
          tokensUsed: metadata.tokensUsed,
          cacheHit: metadata.cacheHit,
          generatedFiles,
          reasoningDone: true,
          citations: metadata.citations || prevMsg.citations || [],
        };
        return updated;
      });
      if (generatedFiles.length > 0) setSidebarRefresh((prev) => prev + 1);
      setFailedMessage(null);
      if (metadata.topicId && !activeTopic) {
        setActiveTopic({ id: metadata.topicId });
        setSidebarRefresh((prev) => prev + 1);
      } else if (metadata.topicId && activeTopic?.id !== metadata.topicId) {
        setActiveTopic({ id: metadata.topicId });
      }
      await refreshTokenStats();
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') {
        setMessages((prev) => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') updated[updated.length - 1] = { ...last, streaming: false, statusMessage: null };
          return updated;
        });
        return;
      }
      setMessages((prev) => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'assistant') updated[updated.length - 1] = { ...last, streaming: false, statusMessage: null };
        return updated;
      });
      const msg = err.response?.data?.error || err.message || 'Something went wrong.';
      setError(msg);
      setMessages((prev) => [...prev, { role: 'assistant', content: `❌ Error: ${msg}` }]);
    } finally {
      setLoading(false);
      setUploadProgress(0);
      abortControllerRef.current = null;
      uploadAbortRef.current = null;
      uploadSessionIdRef.current = null;
      sessionStorage.removeItem('uploadSessionId');
    }
  }, [activeTopic, historyLimit, memoryMode, model, providerModelId, ragEnabled, refreshTokenStats, selectedCollectionIds, thinkingEnabled, reasoningEffort, uploadSingleFile]);

  useEffect(() => {
    if (loading || messageQueue.length === 0) return;
    const [next, ...rest] = messageQueue;
    setMessageQueue(rest);
    sendMessage(next.text, next.files, next.image, false, Boolean(next.forceWebSearch));
  }, [loading, messageQueue, sendMessage]);

  useEffect(() => {
    const handleClickOutside = (event) => {
      if (queuePopoverRef.current && !queuePopoverRef.current.contains(event.target)) {
        setQueuePopoverOpen(false);
      }
    };
    if (queuePopoverOpen) document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [queuePopoverOpen]);

  const requestSend = useCallback(async ({ text, files, image, forceWebSearch }) => {
    if (!String(text || '').trim() && (!files || files.length === 0)) return;
    if (loading) {
      setMessageQueue((prev) => [...prev, { text, files: [...(files || [])], image, forceWebSearch: Boolean(forceWebSearch) }]);
      return;
    }
    await sendMessage(text, files || [], image, false, Boolean(forceWebSearch));
  }, [loading, sendMessage]);

  const handleRetry = useCallback(() => {
    if (!failedMessage) return;
    const { text, files, image, forceWebSearch } = failedMessage;
    setFailedMessage(null);
    setError('');
    setMessages((prev) => (prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev));
    sendMessage(text, files, image, true, Boolean(forceWebSearch));
  }, [failedMessage, sendMessage]);

  const removeFromQueue = useCallback((index) => {
    setMessageQueue((prev) => prev.filter((_, idx) => idx !== index));
  }, []);

  const handleStop = useCallback(() => {
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    setMessageQueue([]);
    setQueuePopoverOpen(false);
    setLoading(false);
  }, []);

  const cancelUploadAndStream = useCallback(() => {
    const sid = uploadSessionIdRef.current;
    if (sid) {
      // api.post attaches the CSRF token and credentials via interceptors.
      api.post(`/upload/cancel/${sid}`).catch(() => {});
      uploadSessionIdRef.current = null;
    }
    if (uploadAbortRef.current) {
      uploadAbortRef.current.abort();
      uploadAbortRef.current = null;
    }
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    sessionStorage.removeItem('uploadSessionId');
    setLoading(false);
    setUploadProgress(0);
    setUploadMessage('');
  }, []);

  return {
    models,
    messages,
    loading,
    model,
    setModel,
    thinkingEnabled,
    setThinkingEnabled,
    setThinkingEnabledFor,
    reasoningEffort,
    setReasoningEffort,
    setReasoningEffortFor,
    activeTopic,
    sidebarRefresh,
    error,
    setError,
    uploadProgress,
    uploadMessage,
    memoryMode,
    setMemoryMode,
    historyLimit,
    setHistoryLimit,
    ragEnabled,
    setRagEnabled,
    storeInDb,
    setStoreInDb,
    selectedCollectionIds,
    setSelectedCollectionIds,
    unifiedProvider,
    setUnifiedProvider,
    providerModelId,
    setProviderModelId,
    messageQueue,
    queuePopoverOpen,
    setQueuePopoverOpen,
    queuePopoverRef,
    failedMessage,
    handleTopicSelect,
    handleNewChat,
    requestSend,
    handleRetry,
    removeFromQueue,
    handleStop,
    cancelUploadAndStream,
  };
};
