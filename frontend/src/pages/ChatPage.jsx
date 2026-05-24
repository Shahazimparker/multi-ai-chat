// ============================================================
// FILE: frontend/src/pages/ChatPage.jsx
// PURPOSE: Main chat UI — message list, input box, model selector
//          Token bar on top, sidebar for history
// CHANGES: Added MobileNav component (lines 19, 261-268)
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Loader2 } from 'lucide-react';
import Sidebar from '../components/chat/Sidebar';
import MobileNav from '../components/chat/MobileNav';
import ModelSelector from '../components/chat/ModelSelector';
import MessageBubble from '../components/chat/MessageBubble';
import TokenBar from '../components/layout/TokenBar';
import { useAuth } from '../context/AuthContext';
import api from '../config/api';
import './ChatPage.css';
import UnifiedModelModal from '../components/chat/UnifiedModelModal';
import FileUpload from '../components/chat/FileUpload';


const ChatPage = () => {
  const { refreshTokenStats } = useAuth();

  const [models, setModels] = useState([]);   // all available models from API
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(null);   // selected AI model object
  const [showScrollBtn, setShowScrollBtn] = useState(false);
  const [activeTopic, setActiveTopic] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [error, setError] = useState('');

  const [pendingFiles, setPendingFiles] = useState([]);
  const [pendingImage, setPendingImage] = useState(null);
  const [uploadProgress, setUploadProgress] = useState(0);
  const [uploadMessage, setUploadMessage] = useState('');

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const uploadAbortRef = useRef(null);
  const uploadSessionIdRef = useRef(null);
  const messagesAreaRef = useRef(null);
  const isUserAtBottom = useRef(true); // tracks if user is scrolled to bottom
  const [memoryMode, setMemoryMode] = useState('accurate');
  const [historyLimit, setHistoryLimit] = useState(8);
  const [ragEnabled, setRagEnabled] = useState(true);
  const [dbOnly, setDbOnly] = useState(false);
  const [showAdvancedMemory, setShowAdvancedMemory] = useState(false);
  const [unifiedProvider, setUnifiedProvider] = useState(null);
  const [providerModelId, setProviderModelId] = useState(null);
  const [messageQueue, setMessageQueue] = useState([]);
  const [queuePopoverOpen, setQueuePopoverOpen] = useState(false);
  const queuePopoverRef = useRef(null);
  const [failedMessage, setFailedMessage] = useState(null);
  const [llmError, setLlmError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // Resume upload progress display after browser back/forward navigation
  // Checks sessionStorage for active upload sessionId and polls status endpoint
  useEffect(() => {
    const savedSid = sessionStorage.getItem('uploadSessionId');
    if (!savedSid) return;

    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://multi-ai-chat-backend.vercel.app/api'
      : 'http://localhost:5000/api';
    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');

    let cancelled = false;
    const poll = async () => {
      while (!cancelled) {
        try {
          const res = await fetch(`${baseUrl}/upload/status/${savedSid}`, {
            headers: token ? { Authorization: `Bearer ${token}` } : {},
          });
          const data = await res.json();
          if (!data.active) {
            // Upload completed or expired — clear storage
            sessionStorage.removeItem('uploadSessionId');
            if (!cancelled) { setUploadProgress(0); setUploadMessage(''); }
            return;
          }
          if (!cancelled) {
            setLoading(true);
            setUploadProgress(data.progress);
            setUploadMessage(data.message || '');
            uploadSessionIdRef.current = savedSid;
          }
          if (data.status === 'done' || data.status === 'aborted' || data.status === 'error') {
            // Final state — show briefly then clear
            setTimeout(() => {
              if (!cancelled) { setUploadProgress(0); setUploadMessage(''); setLoading(false); }
            }, 3000);
            sessionStorage.removeItem('uploadSessionId');
            return;
          }
        } catch {
          // Poll failed (network error) — stop trying
          if (!cancelled) { setUploadProgress(0); setUploadMessage(''); }
          sessionStorage.removeItem('uploadSessionId');
          return;
        }
        await new Promise(r => setTimeout(r, 2000)); // poll every 2s
      }
    };
    poll();
    return () => { cancelled = true; };
  }, []);

  // ── Fetch available models list ──────────────────────────────────
  useEffect(() => {
    api.get('/chat/models')
      .then(res => setModels(res.data.models || []))
      .catch(() => {});
  }, []);

  // ── Auto-switch to deepseek-v4-pro-erp when Only DB is toggled ON ──
  const prevModelRef = useRef(null);

  useEffect(() => {
    if (dbOnly) {
      // Save current model before switching
      if (model && model.id !== 'deepseek-v4-pro-erp') {
        prevModelRef.current = model;
      }
      // Switch to ERP model if not already selected
      if (!model || model.id !== 'deepseek-v4-pro-erp') {
        const erpModel = models.find(m => m.id === 'deepseek-v4-pro-erp');
        if (erpModel) setModel(erpModel);
      }
    } else {
      // Only DB OFF — restore previous model (if any)
      if (prevModelRef.current) {
        setModel(prevModelRef.current);
        prevModelRef.current = null;
      }
    }
  }, [dbOnly]);

  const scrollToBottom = () => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  // Track if user is near the bottom of the messages area
  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const threshold = 100; // px from bottom counts as "at bottom"
    isUserAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
    setShowScrollBtn(!isUserAtBottom.current);
  }, []);

  // Auto-scroll only if user hasn't scrolled up
  const isStreaming = messages.length > 0 && messages[messages.length - 1]?.streaming;
  useEffect(() => {
    if (isUserAtBottom.current) {
      bottomRef.current?.scrollIntoView({ behavior: isStreaming ? 'auto' : 'smooth' });
    }
  }, [messages, loading]);

  // Auto-grow textarea
  const handlePaste = (e) => {
    const items = e.clipboardData?.items;
    if (!items) return;

    for (const item of items) {
      if (item.type.startsWith('image/')) {
        e.preventDefault();

        // Check if selected model supports vision
        const visionProviders = ['openai', 'gemini', 'claude'];
        const visionOpenRouterModels = ['gemini', 'gpt', 'claude'];
        const provider = model?.provider;
        const modelId = model?.model || '';

        const supportsVision =
          visionProviders.includes(provider) ||
          (provider === 'openrouter' && visionOpenRouterModels.some(v => modelId.includes(v)));

        if (!supportsVision) {
          alert('This model does not support image input. Use the 📎 attachment button to upload files, or switch to a vision-capable model (GPT-4o, Gemini, Claude).');
          return;
        }

        const file = item.getAsFile();
        if (!file) continue;
        const reader = new FileReader();
        reader.onload = () => setPendingImage(reader.result);
        reader.readAsDataURL(file);
        break;
      }
    }
  };



  // Load messages when switching topics — also restore the model used for this topic
  const handleTopicSelect = async (topic) => {
    setActiveTopic(topic);
    setMessages([]);
    try {
      const res = await api.get(`/history/topics/${topic.id}/messages`);
      setMessages(res.data.messages.map(m => ({
        role: m.role, content: m.content, model: m.model, tokensUsed: m.tokens_used,
        created_at: m.created_at,
      })));
    } catch { setMessages([]); }

    // Restore the model this topic was created with
    if (topic.model && models.length > 0) {
      const matched = models.find(m => m.id === topic.model);
      if (matched) setModel(matched);
    }
  };

  const handleNewChat = () => {
    setActiveTopic(null);
    setMessages([]);
    setError('');
  };

  // Helper: upload a single file via XHR with SSE progress
  const uploadSingleFile = async (file, topicIdToUse) => {
    setUploadProgress(0);
    setUploadMessage('');

    const formData = new FormData();
    formData.append('file', file);
    formData.append('modelId', model.id);
    formData.append('ragEnabled', ragEnabled);
    if (topicIdToUse) formData.append('topicId', topicIdToUse);

    const baseUrl = process.env.NODE_ENV === 'production'
      ? 'https://multi-ai-chat-backend.vercel.app/api'
      : 'http://localhost:5000/api';
    const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');

    return await new Promise((resolve, reject) => {
      const xhr = new XMLHttpRequest();
      xhr.open('POST', `${baseUrl}/upload/file`);
      xhr.timeout = 600000;
      if (authToken) xhr.setRequestHeader('Authorization', `Bearer ${authToken}`);
      const csrfToken = sessionStorage.getItem('csrf_token');
      if (csrfToken) xhr.setRequestHeader('X-CSRF-Token', csrfToken);

      xhr.upload.onprogress = (e) => {
        if (e.lengthComputable) setUploadProgress(Math.round((e.loaded / e.total) * 100));
      };

      let parsedLen = 0;
      xhr.onreadystatechange = () => {
        if (xhr.readyState === 3 || xhr.readyState === 4) {
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
            } catch (e) {}
          }
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
            } catch (e) {}
          }
          if (sseError || lastError) reject(new Error(sseError || lastError || 'Upload failed'));
          else resolve(result || { fileName: file.name });
        } else {
          let errMsg = 'Upload failed';
          try { const j = JSON.parse(xhr.responseText); if (j.error) errMsg = j.error; }
          catch (_) {
            for (const line of xhr.responseText.split('\n')) {
              if (!line.startsWith('data: ')) continue;
              try { const d = JSON.parse(line.slice(6)); if (d.type === 'error') errMsg = d.error; } catch (e) {}
            }
          }
          reject(new Error(errMsg));
        }
      };

      xhr.onerror = () => reject(new Error('Network error'));
      xhr.ontimeout = () => reject(new Error('Upload timed out. Try a smaller file.'));
      xhr.onabort = () => reject(new DOMException('Aborted', 'AbortError'));

      if (uploadAbortRef.current?.signal) {
        uploadAbortRef.current.signal.addEventListener('abort', () => xhr.abort());
      }
      xhr.send(formData);
    });
  };

  // Send message
  const sendMessage = useCallback(async (msgText, filesArr, image, isRetry = false) => {
    let finalMessage = String(msgText).trim();
    const files = filesArr || [];

    setFailedMessage({ text: finalMessage, files, image });

    const controller = new AbortController();
    abortControllerRef.current = controller;
    const uploadController = new AbortController();
    uploadAbortRef.current = uploadController;

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError('');

    // Build user message content
    const fileNames = files.map(f => f.name);
    const userMsgContent = fileNames.length > 0
      ? (finalMessage ? `${finalMessage}\n${fileNames.map(n => `📎 ${n}`).join('\n')}` : fileNames.map(n => `📎 ${n}`).join('\n'))
      : finalMessage;
    if (!isRetry) {
      setMessages(prev => [...prev, { role: 'user', content: userMsgContent, created_at: new Date().toISOString() }]);
    }
    setLoading(true);

    try {
      let topicIdToUse = activeTopic?.id || null;

      // Upload all files sequentially
      const uploadedResults = [];
      for (const f of files) {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'user') {
            const doneList = uploadedResults.map(r => `📎 ✅ \`${r.fileName}\``).join('\n');
            const stillUploading = files.slice(uploadedResults.length).map(n => `📎 \`${n.name}\``).join('\n');
            const textPart = finalMessage ? `${finalMessage}\n` : '';
            updated[updated.length - 1] = { ...last, content: `${textPart}${doneList}${doneList ? '\n' : ''}${stillUploading}\n⏳ Uploading \`${f.name}\`...` };
          }
          return updated;
        });

        const result = await uploadSingleFile(f, topicIdToUse);
        uploadedResults.push(result);
        setUploadedFiles(prev => [...prev, result]);
      }

      sessionStorage.removeItem('uploadSessionId');
      setTimeout(() => { setUploadProgress(0); setUploadMessage(''); }, 3000);

      // Update user message to show all uploads complete
      setMessages(prev => {
        const updated = [...prev];
        const last = updated[updated.length - 1];
        if (last && last.role === 'user') {
          const doneList = uploadedResults.map(r => `📎 ✅ \`${r.fileName}\``).join('\n');
          const textPart = finalMessage ? `${finalMessage}\n` : '';
          updated[updated.length - 1] = { ...last, content: `${textPart}${doneList}` };
        }
        return updated;
      });

      // Append file references to message
      if (uploadedResults.length > 0) {
        const refs = uploadedResults.map(r => `[File uploaded: ${r.fileName}]`).join('\n');
        finalMessage = finalMessage ? `${finalMessage}\n${refs}` : refs;
      }

      // ── Send to AI ──
      const apiUrl = process.env.NODE_ENV === 'production'
        ? 'https://multi-ai-chat-backend.vercel.app/api/chat/stream'
        : 'http://localhost:5000/api/chat/stream';
      const authToken = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: finalMessage,
          image,
          topicId: topicIdToUse,
          modelId: model.id,
          providerModelId,
          memoryMode,
          historyLimit: Number(historyLimit),
          ragEnabled,
          dbOnly,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let metadata = {};
      let streamingText = '';

      setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true, created_at: new Date().toISOString() }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        const text = decoder.decode(value);
        for (const line of text.split('\n')) {
          if (!line.startsWith('data: ')) continue;
          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') { setError(data.error); break; }
            if (data.type === 'chunk') {
              streamingText += data.text;
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: streamingText };
                return updated;
              });
            } else if (data.type === 'done') {
              metadata = data;
              fullReply = streamingText;
            } else if (data.type === 'cached') {
              fullReply = data.reply;
              metadata = { cacheHit: true, tokensUsed: 0 };
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: fullReply, ...metadata, streaming: false };
                return updated;
              });
              break;
            }
          } catch (e) {}
        }
      }

      // ── Save AI-generated file code blocks ──
      const generatedFiles = [];
      if (fullReply) {
        const fileBlockRegex = /```(\w+)\n([\s\S]*?)```/g;
        const fileLangs = new Set(['html','htm','js','jsx','ts','tsx','css','json','xml','md','svg','py','sql','sh']);
        let fileMatch;
        let fileIdx = 0;

        // Extract a meaningful name from code content
        const extractFileName = (code, lang, idx) => {
          const ext = lang === 'htm' ? 'html' : lang;
          const lines = code.split('\n');
          const firstLine = lines[0]?.trim() || '';
          const secondLine = lines[1]?.trim() || '';

          // 1. HTML <title> tag
          if (lang === 'html' || lang === 'htm') {
            const titleMatch = code.match(/<title>([^<]+)<\/title>/i);
            if (titleMatch) return `${titleMatch[1].trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_')}.${ext}`;
          }

          // 2. Single-line comment describing purpose (first line)
          const commentMatch = firstLine.match(/^(?:\/\/|#|<!--?|%)\s*(.+)/);
          const commentMatch2 = secondLine.match(/^(?:\/\/|#|<!--?|%)\s*(.+)/);
          const descComment = commentMatch?.[1] || commentMatch2?.[1];
          if (descComment) {
            const name = descComment.trim().replace(/[^a-zA-Z0-9 _-]/g, '').replace(/\s+/g, '_').substring(0, 40);
            if (name.length > 3) return `${name}.${ext}`;
          }

          // 3. Named declarations: function, class, const, let, var, def, export default
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

          // 4. CSS: extract first selector name
          if (lang === 'css') {
            const selMatch = code.match(/\.([\w-]+)\s*\{/);
            if (selMatch) return `${selMatch[1]}.css`;
          }

          // 5. Fallback: descriptive name based on lang + idx
          const labels = { html: 'page', js: 'script', jsx: 'component', ts: 'module', tsx: 'component', css: 'styles', json: 'data', xml: 'config', md: 'document', svg: 'graphic', py: 'script', sql: 'query', sh: 'script' };
          return `${labels[lang] || 'file'}_${idx + 1}.${ext}`;
        };

        while ((fileMatch = fileBlockRegex.exec(fullReply)) !== null) {
          const lang = fileMatch[1];
          if (fileLangs.has(lang)) {
            const content = fileMatch[2].trim();
            const ext = lang === 'htm' ? 'html' : lang;
            const fileName = extractFileName(content, lang, fileIdx);
            try {
              const res = await api.post('/upload/generate-file', {
                topicId: topicIdToUse, fileName, content, fileType: lang,
              });
              if (res.data?.file) generatedFiles.push(res.data.file);
            } catch (e) { console.error('[saveGeneratedFile]', e); }
            fileIdx++;
          }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false, model: metadata.model, tokensUsed: metadata.tokensUsed, cacheHit: metadata.cacheHit, generatedFiles };
        return updated;
      });

      if (generatedFiles.length > 0) setSidebarRefresh(p => p + 1);
      setFailedMessage(null);

      if (metadata.topicId && !activeTopic) {
        setActiveTopic({ id: metadata.topicId });
        setSidebarRefresh(p => p + 1);
      } else if (metadata.topicId && activeTopic?.id !== metadata.topicId) {
        setActiveTopic({ id: metadata.topicId });
      }

      await refreshTokenStats();
    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') {
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'assistant') updated[updated.length - 1] = { ...last, streaming: false };
          return updated;
        });
        return;
      }
      const msg = err.response?.data?.error || err.message || 'Something went wrong.';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${msg}` }]);
    } finally {
      setLoading(false);
      setUploadProgress(0);
      abortControllerRef.current = null;
      uploadAbortRef.current = null;
      uploadSessionIdRef.current = null;
      sessionStorage.removeItem('uploadSessionId');
    }
  }, [model, activeTopic, memoryMode, historyLimit, ragEnabled, providerModelId, refreshTokenStats]);

  useEffect(() => {
    if (!loading && messageQueue.length > 0) {
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      sendMessage(next.text, next.files, next.image);
    }
  }, [loading, messageQueue, sendMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim() && pendingFiles.length === 0) return;

    if (loading) {
      setMessageQueue(prev => [...prev, { text: input, files: [...pendingFiles], image: pendingImage }]);
      setInput('');
      setPendingFiles([]);
      setPendingImage(null);
      return;
    }

    setInput('');
    const filesToSend = [...pendingFiles];
    setPendingFiles([]);
    setPendingImage(null);
    await sendMessage(input, filesToSend, pendingImage);

  }, [input, pendingFiles, pendingImage, loading, sendMessage]);

  const handleRetry = useCallback(() => {
    if (!failedMessage) return;
    const { text, files, image } = failedMessage;
    setFailedMessage(null);
    setError('');
    setMessages(prev => prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev);
    sendMessage(text, files, image, true);
  }, [failedMessage, sendMessage]);

  const removeFromQueue = useCallback((index) => {
    setMessageQueue(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleStop = useCallback(() => {
    // Abort current AI request only (not file uploads)
    if (abortControllerRef.current) {
      abortControllerRef.current.abort();
      abortControllerRef.current = null;
    }
    // Clear the queue
    setMessageQueue([]);
    setQueuePopoverOpen(false);
    setLoading(false);
  }, []);

  // Close queue popover on outside click
  useEffect(() => {
    const handleClickOutside = (e) => {
      if (queuePopoverRef.current && !queuePopoverRef.current.contains(e.target)) {
        setQueuePopoverOpen(false);
      }
    };
    if (queuePopoverOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [queuePopoverOpen]);

  // Ctrl+Enter or Enter (without shift) to send
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
  };

  const handleInputChange = (e) => {
    setInput(e.target.value);
  };


  return (
    <div className="chat-root">
      <Sidebar
        activeTopic={activeTopic}
        onTopicSelect={handleTopicSelect}
        onNewChat={handleNewChat}
        refreshTrigger={sidebarRefresh}
      />

      <main className="chat-main">
        {/* Token bar at top */}


        {/* Toolbar */}
        <div className="chat-toolbar">
          <MobileNav
            activeTopic={activeTopic}
            onTopicSelect={handleTopicSelect}
            onNewChat={handleNewChat}
            refreshTrigger={sidebarRefresh}
          />

          <ModelSelector
            selectedModel={model}
            onModelChange={(nextModel) => {
              setModel(nextModel);
              setProviderModelId(null);
            }}
            onUnifiedProviderSelect={setUnifiedProvider}
          />

          {activeTopic && (
            <span className="topic-hint">
              Continuing topic · {messages.length} messages
            </span>
          )}
        </div>

        {/* Token bar */}
        <TokenBar />

        {/* AI Responding Animation - Floating Orbs (outside messages-area to avoid mobile fixed-position issues) */}
        {loading && (
          <div className="ai-loading-overlay">
            <div className="floating-orbs">
              <div className="float-orb" />
              <div className="float-orb" />
              <div className="float-orb" />
            </div>
          </div>
        )}

        {/* Messages area */}
        <div className="messages-area" ref={messagesAreaRef} onScroll={handleScroll}>

          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb" />
              <h2>Welcome to Miles Intelligence</h2>
              <p>Select a model and start chatting with your AI assistant</p>
              <div className="suggestion-chips">
                {['Explain quantum computing', 'Write a Python script', 'Translate to French', 'Debug my code'].map(s => (
                  <button key={s} className="chip" onClick={() => setInput(s)}>{s}</button>
                ))}
              </div>
            </div>
          ) : (
            messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
          )}

          {/* Upload progress bar — shows byte upload then server-side phase */}
          {uploadProgress > 0 && (
            <div className="upload-progress-bar">
              <div className="upload-progress-track">
                <div className="upload-progress-fill" style={{ width: `${uploadProgress}%` }} />
              </div>
              <span className="upload-progress-label">
                {uploadMessage || `${uploadProgress}%`}
              </span>
              <button
                className="upload-cancel-btn"
                onClick={() => {
                  // 1. Call cancel endpoint to stop backend processing + DB cleanup
                  const sid = uploadSessionIdRef.current;
                  if (sid) {
                    const baseUrl = process.env.NODE_ENV === 'production'
                      ? 'https://multi-ai-chat-backend.vercel.app/api'
                      : 'http://localhost:5000/api';
                    const token = localStorage.getItem('auth_token') || sessionStorage.getItem('auth_token');
                    fetch(`${baseUrl}/upload/cancel/${sid}`, {
                      method: 'POST',
                      headers: token ? { Authorization: `Bearer ${token}` } : {},
                    }).catch(() => {});
                    uploadSessionIdRef.current = null;
                  }
                  // 2. Abort upload XHR
                  if (uploadAbortRef.current) {
                    uploadAbortRef.current.abort();
                    uploadAbortRef.current = null;
                  }
                  // 3. Also abort AI request (upload may have finished, AI streaming)
                  if (abortControllerRef.current) {
                    abortControllerRef.current.abort();
                    abortControllerRef.current = null;
                  }
                  sessionStorage.removeItem('uploadSessionId');
                  setLoading(false);
                  setUploadProgress(0);
                  setUploadMessage('');
                }}
                title="Cancel upload"
              >
                ✕
              </button>
            </div>
          )}

          {/* Typing indicator — only show when no streaming message exists yet */}
          {loading && !isStreaming && (
            <div className="message-row assistant">
              <div className="msg-avatar assistant"><Loader2 size={14} className="spin" /></div>
              <div className="msg-bubble assistant typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          )}

          {/* Scroll to bottom button */}
          {showScrollBtn && messages.length > 0 && (
            <button className="scroll-to-bottom-btn" onClick={scrollToBottom} title="Scroll to bottom">
              ↓
            </button>
          )}
          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="input-area">
          {error && (
            <div className="chat-error">
              <span>{error}</span>
              {failedMessage && !loading && (
                <button className="retry-btn" onClick={handleRetry}>
                  ↻ Retry
                </button>
              )}
            </div>
          )}

          <div className="memory-controls">
            <button
              type="button"
              className={`memory-mode-btn ${memoryMode === 'summarized' ? 'active' : ''}`}
              onClick={() => {
                setMemoryMode('summarized');
                setHistoryLimit(5);
                setRagEnabled(false);
              }}
            >
              Summarized+
            </button>
            <button
              type="button"
              className={`memory-mode-btn ${memoryMode === 'accurate' ? 'active' : ''}`}
              onClick={() => {
                setMemoryMode('accurate');
                setHistoryLimit(8);
                setRagEnabled(true);
              }}
            >
              Accurate+
            </button>
            <button
              type="button"
              className="memory-advanced-btn"
              onClick={() => setShowAdvancedMemory(p => !p)}
            >
              Advanced
            </button>

            <label className="memory-toggle-control">
              <input
                type="checkbox"
                checked={dbOnly}
                onChange={e => setDbOnly(e.target.checked)}
              />
              🔒 Only DB
            </label>

            {showAdvancedMemory && (
              <>
                <label className="memory-limit-control">
                  Last
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={historyLimit}
                    onChange={e => {
                      const val = parseInt(e.target.value, 10);
                      setHistoryLimit(isNaN(val) ? 2 : Math.max(2, Math.min(20, val)));
                    }}
                  />
                  msgs
                </label>

                <label className="memory-toggle-control">
                  <input
                    type="checkbox"
                    checked={ragEnabled}
                    onChange={e => setRagEnabled(e.target.checked)}
                  />
                  RAG on
                </label>
              </>
            )}

          </div>

          <div className="input-box">
            <FileUpload
              topicId={activeTopic?.id}
              onFileSelect={(files) => setPendingFiles(prev => [...prev, ...files])}
              disabled={loading || !model}
            />

            {pendingFiles.length > 0 && (
              <div className="pending-files-list">
                {pendingFiles.map((f, i) => (
                  <div key={i} className="pending-file-tag">
                    <span className="file-pill">📎 {f.name}</span>
                    <button
                      className="remove-file-btn"
                      onClick={() => setPendingFiles(prev => prev.filter((_, idx) => idx !== i))}
                      title="Remove attachment"
                    >
                      &times;
                    </button>
                  </div>
                ))}
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={model ? 'Ask me anything' : 'Select a model first…'}
              disabled={!model}
              rows={1}
              onPaste={handlePaste}
            />

            {pendingImage && (
              <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
                <img src={pendingImage} alt="Pasted" style={{ maxHeight: 120, borderRadius: 8 }} />
                <button
                  onClick={() => setPendingImage(null)}
                  style={{ position: 'absolute', top: -6, right: -6, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer' }}
                >
                  ✕
                </button>
              </div>
            )}
            <button
              className={`send-btn ${loading ? 'stop-btn' : ''}`}
              onClick={loading ? handleStop : handleSend}
              disabled={loading ? false : (!input.trim() && pendingFiles.length === 0) || !model}
            >
              {loading ? <StopCircle size={18} /> : <Send size={18} />}
            </button>
            {messageQueue.length > 0 && (
              <div className="queue-badge-wrapper" ref={queuePopoverRef}>
                <div
                  className="queue-badge"
                  onClick={() => setQueuePopoverOpen(p => !p)}
                >
                  {messageQueue.length} queued {queuePopoverOpen ? '▲' : '▼'}
                </div>
                {queuePopoverOpen && (
                  <div className="queue-popover">
                    <div className="queue-popover-header">Queued Messages ({messageQueue.length})</div>
                    <div className="queue-popover-list">
                      {messageQueue.map((q, i) => (
                        <div key={i} className="queue-popover-item" title={q.text || q.file?.name || 'message'}>
                          <span className="queue-popover-num">{i + 1}.</span>
                          <span className="queue-popover-text">{q.text || q.file?.name || 'message'}</span>
                          <button
                            className="queue-popover-remove"
                            onClick={(e) => { e.stopPropagation(); removeFromQueue(i); }}
                            title="Remove from queue"
                          >
                            ✕
                          </button>
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            )}
          </div>

          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </main>
      {llmError && (
        <div className="llm-error-backdrop">
          <div className="llm-error-modal">
            <h3>Selected LLM unavailable</h3>
            <p>{llmError.error}</p>
            <p className="llm-error-note">Choose another model from the dropdown, then continue.</p>
            <div className="llm-error-actions">
              <button onClick={() => setLlmError(null)}>Cancel</button>
              <button
                onClick={() => {
                  if (failedMessage) setInput(failedMessage.text);
                  setLlmError(null);
                }}
              >
                Continue with new LLM
              </button>
            </div>
          </div>
        </div>
      )}
      {unifiedProvider && (
        <UnifiedModelModal
          provider={unifiedProvider}
          onClose={() => setUnifiedProvider(null)}
          onSelect={(providerModel) => {
            setModel({
              ...unifiedProvider,
              label: `${unifiedProvider.label}: ${providerModel.label}`,
              paid: providerModel.paid,
            });
            setProviderModelId(providerModel.id);
            setUnifiedProvider(null);
          }}
        />
      )}
    </div>
  );
};

export default ChatPage;