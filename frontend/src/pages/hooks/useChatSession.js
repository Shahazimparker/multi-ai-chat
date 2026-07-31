import { useCallback, useEffect, useRef, useState } from 'react';
import api, { API_BASE_URL } from '../../config/api';

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
  const [unifiedProvider, setUnifiedProvider] = useState(null);
  const [providerModelId, setProviderModelId] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const [failedMessage, setFailedMessage] = useState(null);
  const [llmError, setLlmError] = useState(null);

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
  }, []);

  const uploadSingleFile = useCallback(async (file, topicIdToUse) => {
    setUploadProgress(0);
    setUploadMessage('');
    const formData = new FormData();
    formData.append('file', file);
    formData.append('modelId', model.id);
    formData.append('ragEnabled', ragEnabled);
    if (topicIdToUse) formData.append('topicId', topicIdToUse);
    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${API_BASE_URL}/upload/file`);
      xhr.withCredentials = true;
      xhr.timeout = 600000;
      const csrfToken = sessionStorage.getItem('csrf_token');
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      xhr.upload.onprogress = (event) => {
        if (event.lengthComputable) setUploadProgress(Math.round((event.loaded / event.total) * 100));
      };

      let parsedLen = 0;
      xhr.onreadystatechange = () => {
        if (xhr.readyState !== 3 && xhr.readyState !== 4) return;
        const chunk = xhr.responseText.substring(parsedLen);
        parsedLen = xhr.responseText.length;
        for (const line of chunk.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'init' && data.sessionId) {
              uploadSessionIdRef.current = data.sessionId;
              sessionStorage.setItem('uploadSessionId', data.sessionId);
            }
            if (data.type === 'error') window.__uploadSseError = data.error;
            if (data.type === 'progress' && typeof data.percent === 'number') {
              setUploadProgress(data.percent);
              if (data.message) setUploadMessage(data.message);
            }
          } catch {}
        }
      };

      xhr.onload = () => {
        if (xhr.status >= 200 && xhr.status < 300) {
          const sseError = window.__uploadSseError;
          window.__uploadSseError = null;
          let result = null;
          let lastError = null;
          for (const line of xhr.responseText.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'done') result = data;
              if (data.type === 'error') lastError = data.error;
            } catch {}
          }
          if (sseError || lastError) {
            reject(new Error(sseError || lastError || 'Upload failed'));
          } else {
            resolve(result || { fileName: file.name });
          }
          return;
        }
        let errorMessage = 'Upload failed';
        try {
          const parsed = JSON.parse(xhr.responseText);
          if (parsed.error) errorMessage = parsed.error;
        } catch {
          for (const line of xhr.responseText.split('\n')) {
            if (!line.startsWith('data: ')) continue;
            try {
              const data = JSON.parse(line.slice(6));
              if (data.type === 'error') errorMessage = data.error;
            } catch {}
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
      xhr.send(formData);
    });
  }, [model, ragEnabled]);

  const sendMessage = useCallback(async (msgText, filesArr, image, isRetry = false, forceCurrentModel = false, forceWebSearch = false) => {
    let finalMessage = String(msgText).trim();
    const files = filesArr || [];
    setFailedMessage({ text: finalMessage, files, image, forceCurrentModel, forceWebSearch: Boolean(forceWebSearch) });

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
      const csrfToken = sessionStorage.getItem('csrf_token');
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
          allowArtifactWithCurrentModel: Boolean(forceCurrentModel),
        }),
        signal: controller.signal,
      });
      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let metadata = {};
      let streamingText = '';
      setMessages((prev) => [...prev, { role: 'assistant', content: '', streaming: true, statusMessage: null, created_at: new Date().toISOString() }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') {
              setError(data.error);
              if (data.errorType === 'model_switch_required') {
                setLlmError({
                  error: data.error || 'Model switch required',
                  suggestedModels: Array.isArray(data.suggestedModels) ? data.suggestedModels : [],
                  recommendedModelId: data.recommendedModelId || null,
                  failedModelId: data.failedModelId || null,
                });
              }
              break;
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
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: streamingText, statusMessage: null };
                return updated;
              });
            } else if (data.type === 'done') {
              metadata = data;
              fullReply = streamingText;
            } else if (data.type === 'cached') {
              fullReply = data.reply;
              metadata = { cacheHit: true, tokensUsed: 0 };
              setMessages((prev) => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullReply, ...metadata, streaming: false, statusMessage: null };
                return updated;
              });
              break;
            }
          } catch {}
        }
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
        updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false, statusMessage: null, model: metadata.model, tokensUsed: metadata.tokensUsed, cacheHit: metadata.cacheHit, generatedFiles };
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
  }, [activeTopic, historyLimit, memoryMode, model, providerModelId, ragEnabled, refreshTokenStats, uploadSingleFile]);

  useEffect(() => {
    if (loading || messageQueue.length === 0) return;
    const [next, ...rest] = messageQueue;
    setMessageQueue(rest);
    sendMessage(next.text, next.files, next.image, false, false, Boolean(next.forceWebSearch));
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
    await sendMessage(text, files || [], image, false, false, Boolean(forceWebSearch));
  }, [loading, sendMessage]);

  const handleRetry = useCallback(() => {
    if (!failedMessage) return;
    const { text, files, image, forceCurrentModel, forceWebSearch } = failedMessage;
    setFailedMessage(null);
    setError('');
    setMessages((prev) => (prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev));
    sendMessage(text, files, image, true, forceCurrentModel, Boolean(forceWebSearch));
  }, [failedMessage, sendMessage]);

  const handleContinueWithCurrentModel = useCallback(() => {
    if (!failedMessage) return;
    const { text, files, image, forceWebSearch } = failedMessage;
    setLlmError(null);
    setError('');
    setMessages((prev) => (prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev));
    sendMessage(text, files, image, true, true, Boolean(forceWebSearch));
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
    unifiedProvider,
    setUnifiedProvider,
    providerModelId,
    setProviderModelId,
    messageQueue,
    queuePopoverOpen,
    setQueuePopoverOpen,
    queuePopoverRef,
    failedMessage,
    llmError,
    setLlmError,
    handleContinueWithCurrentModel,
    handleTopicSelect,
    handleNewChat,
    requestSend,
    handleRetry,
    removeFromQueue,
    handleStop,
    cancelUploadAndStream,
  };
};
