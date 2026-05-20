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

  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [loading, setLoading] = useState(false);
  const [model, setModel] = useState(null);   // selected AI model object
  const [activeTopic, setActiveTopic] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [error, setError] = useState('');

  const [pendingFile, setPendingFile] = useState(null);
  const [pendingImage, setPendingImage] = useState(null);

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
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

  // Track if user is near the bottom of the messages area
  const handleScroll = useCallback(() => {
    const el = messagesAreaRef.current;
    if (!el) return;
    const threshold = 100; // px from bottom counts as "at bottom"
    isUserAtBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight < threshold;
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



  // Load messages when switching topics
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
  };

  const handleNewChat = () => {
    setActiveTopic(null);
    setMessages([]);
    setError('');
  };

  // Send message
  const sendMessage = useCallback(async (msgText, file, image, isRetry = false) => {
    let finalMessage = String(msgText).trim();
    const fileToUpload = file;

    setFailedMessage({ text: finalMessage, file: fileToUpload, image });
    setPendingFile(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError('');

    const fileName = fileToUpload?.name;
    // If both text and file exist, show both
    const userMsgContent = fileName
      ? (finalMessage ? `${finalMessage}\n📎 ${fileName}` : `📎 ${fileName}`)
      : finalMessage;
    if (!isRetry) {
      setMessages(prev => [...prev, { role: 'user', content: userMsgContent, created_at: new Date().toISOString() }]);
    }
    setLoading(true);

    try {
      let topicIdToUse = activeTopic?.id || null;

      if (fileToUpload) {
        // Show uploading status — preserve text if user typed something
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'user') {
            const textPart = finalMessage ? `${finalMessage}\n` : '';
            updated[updated.length - 1] = { ...last, content: `${textPart}📎 ⏳ Uploading \`${fileName}\`...` };
          }
          return updated;
        });

        const formData = new FormData();
        formData.append('file', fileToUpload);
        formData.append('modelId', model.id);
        formData.append('ragEnabled', ragEnabled);
        if (topicIdToUse) formData.append('topicId', topicIdToUse);

        const uploadRes = await api.post('/upload/file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          signal: controller.signal,
        });

        setUploadedFiles(prev => [...prev, uploadRes.data]);

        // Update user message to show upload complete — preserve text
        setMessages(prev => {
          const updated = [...prev];
          const last = updated[updated.length - 1];
          if (last && last.role === 'user') {
            const textPart = finalMessage ? `${finalMessage}\n` : '';
            updated[updated.length - 1] = { ...last, content: `${textPart}📎 ✅ \`${fileName}\` uploaded` };
          }
          return updated;
        });

        // HYBRID: Don't inject file content into message — AI sees file names via listUserFiles
        // and uses SEARCH_FILES / GET_FILE tools to access content on demand
        // Preserve user's original text + append file reference (was overwriting before!)
        finalMessage = finalMessage
          ? `${finalMessage}\n[File uploaded: ${uploadRes.data.fileName}]`
          : `[File uploaded: ${uploadRes.data.fileName}]`;
      }

      const apiUrl = process.env.NODE_ENV === 'production'
        ? 'https://multi-ai-chat-backend.vercel.app/api/chat/stream'
        : 'http://localhost:5000/api/chat/stream';

      const authToken =
        localStorage.getItem('auth_token') ||
        sessionStorage.getItem('auth_token');

      const headers = { 'Content-Type': 'application/json' };
      if (authToken) headers.Authorization = `Bearer ${authToken}`;

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: finalMessage,
          image: image,
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
        const lines = text.split('\n');

        for (const line of lines) {
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
          } catch (e) { }
        }
      }

      // ── Save AI-generated file code blocks ──────────────────
      const generatedFiles = [];
      if (fullReply) {
        const fileBlockRegex = /```(\w+)\n([\s\S]*?)```/g;
        const fileLangs = new Set([
          'html','htm','js','jsx','ts','tsx','css','scss','sass','less',
          'json','xml','yaml','yml','md','svg','py','rb','php','java',
          'c','cpp','h','hpp','cs','go','rs','swift','kt','sql','r',
          'sh','bash','ps1','bat','pl','lua',
        ]);
        let fileMatch;
        let fileIdx = 0;
        while ((fileMatch = fileBlockRegex.exec(fullReply)) !== null) {
          const lang = fileMatch[1];
          if (fileLangs.has(lang)) {
            const content = fileMatch[2].trim();
            const ext = lang === 'jsx' ? 'jsx' : lang === 'tsx' ? 'tsx' : lang === 'htm' ? 'html' : lang;
            const fileName = `generated_${fileIdx + 1}.${ext}`;
            try {
              const res = await api.post('/upload/generate-file', {
                topicId: topicIdToUse,
                fileName,
                content,
                fileType: lang,
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

      setPendingImage(null);
      setFailedMessage(null); // clear failed data on success

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
          if (last && last.role === 'assistant') {
            updated[updated.length - 1] = { ...last, streaming: false };
          }
          return updated;
        });
        return;
      }
      const msg = err.response?.data?.error || err.message || 'Something went wrong.';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${msg}` }]);
      // failedMessage kept so retry can use it
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [model, activeTopic, memoryMode, historyLimit, ragEnabled, providerModelId, refreshTokenStats]);

  useEffect(() => {
    if (!loading && messageQueue.length > 0) {
      const [next, ...rest] = messageQueue;
      setMessageQueue(rest);
      sendMessage(next.text, next.file, next.image);
    }
  }, [loading, messageQueue, sendMessage]);

  const handleSend = useCallback(async () => {
    if (!input.trim() && !pendingFile) return;

    if (loading) {
      setMessageQueue(prev => [...prev, { text: input, file: pendingFile, image: pendingImage }]);
      setInput('');
      setPendingFile(null);
      setPendingImage(null);
      return;
    }

    setInput('');
    setPendingFile(null);
    setPendingImage(null);
    await sendMessage(input, pendingFile, pendingImage);


    // Process queue after send completes

  }, [input, pendingFile, pendingImage, loading, sendMessage]);

  const handleRetry = useCallback(() => {
    if (!failedMessage) return;
    const { text, file, image } = failedMessage;
    setFailedMessage(null);
    setError('');
    // Remove the last failed assistant message before re-sending
    setMessages(prev => prev[prev.length - 1]?.role === 'assistant' ? prev.slice(0, -1) : prev);
    sendMessage(text, file, image, true);
  }, [failedMessage, sendMessage]);

  const removeFromQueue = useCallback((index) => {
    setMessageQueue(prev => prev.filter((_, i) => i !== index));
  }, []);

  const handleStop = useCallback(() => {
    // Abort current AI request
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

          {/* Typing indicator — only show when no streaming message exists yet */}
          {loading && !isStreaming && (
            <div className="message-row assistant">
              <div className="msg-avatar assistant"><Loader2 size={14} className="spin" /></div>
              <div className="msg-bubble assistant typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          )}

          {/* AI Responding Animation - Floating Orbs */}
          {loading && (
            <div className="ai-loading-overlay">
              <div className="floating-orbs">
                <div className="float-orb" />
                <div className="float-orb" />
                <div className="float-orb" />
              </div>
            </div>
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
              onFileSelect={setPendingFile}
              disabled={loading || !model}
            />

            {pendingFile && (
              <div className="pending-file-tag">
                <span className="file-pill">📎 {pendingFile.name}</span>
                <button
                  className="remove-file-btn"
                  onClick={() => setPendingFile(null)}
                  title="Remove attachment"
                >
                  &times;
                </button>
              </div>
            )}

            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleInputChange}
              onKeyDown={handleKeyDown}
              placeholder={model ? `Message ${model.label}…` : 'Select a model first…'}
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
              disabled={loading ? false : (!input.trim() && !pendingFile) || !model}
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