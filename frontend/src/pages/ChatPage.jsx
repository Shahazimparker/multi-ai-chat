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

  const bottomRef = useRef(null);
  const textareaRef = useRef(null);
  const abortControllerRef = useRef(null);
  const [memoryMode, setMemoryMode] = useState('summarized');
  const [historyLimit, setHistoryLimit] = useState(5);
  const [ragEnabled, setRagEnabled] = useState(false);
  const [showAdvancedMemory, setShowAdvancedMemory] = useState(false);
  const [unifiedProvider, setUnifiedProvider] = useState(null);
  const [providerModelId, setProviderModelId] = useState(null);
  const [failedMessage, setFailedMessage] = useState(null);
  const [llmError, setLlmError] = useState(null);
  const [uploadedFiles, setUploadedFiles] = useState([]);

  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-grow textarea
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = e.target.value ? `${Math.min(ta.scrollHeight, 160)}px` : '24px'; }
  };

  // Load messages when switching topics
  const handleTopicSelect = async (topic) => {
    setActiveTopic(topic);
    setMessages([]);
    try {
      const res = await api.get(`/history/topics/${topic.id}/messages`);
      setMessages(res.data.messages.map(m => ({
        role: m.role, content: m.content, model: m.model, tokensUsed: m.tokens_used,
      })));
    } catch { setMessages([]); }
  };

  const handleNewChat = () => {
    setActiveTopic(null);
    setMessages([]);
    setError('');
  };

  // Send message
  const handleSend = useCallback(async () => {
    if (loading) {
      if (abortControllerRef.current) {
        abortControllerRef.current.abort();
      }
      return;
    }

    if ((!input.trim() && !pendingFile) || !model) return;

    let finalMessage = String(input).trim();
    const fileToUpload = pendingFile;

    setFailedMessage(finalMessage);
    setInput('');
    setPendingFile(null);

    const controller = new AbortController();
    abortControllerRef.current = controller;

    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError('');

    const optimisticMsg = finalMessage || (fileToUpload ? `Attached: ${fileToUpload.name}` : '');
    setMessages(prev => [...prev, { role: 'user', content: optimisticMsg }]);
    setLoading(true);

    try {
      let topicIdToUse = activeTopic?.id || null;

      if (fileToUpload) {
        const formData = new FormData();
        formData.append('file', fileToUpload);
        formData.append('modelId', model.id);
        formData.append('ragEnabled', ragEnabled);  // ← ADD THIS
        if (topicIdToUse) formData.append('topicId', topicIdToUse);

        const uploadRes = await api.post('/upload/file', formData, {
          headers: { 'Content-Type': 'multipart/form-data' },
          signal: controller.signal,
        });

        setUploadedFiles(prev => [...prev, uploadRes.data]);

        // ← CHANGE: Update userMsg with file content
        if (uploadRes.data.extractedText) {
          const fileContent = uploadRes.data.extractedText;
          finalMessage = `[File: ${uploadRes.data.fileName}]\n${fileContent}\n\nPlease analyze this file.`;
        } else if (uploadRes.data.fileType === 'zip') {
          finalMessage = `[ZIP: ${uploadRes.data.fileName}] Please analyze all extracted files.`;
        }
      }

      // ← Move streaming call HERE (outside file upload block)
      const apiUrl = process.env.NODE_ENV === 'production'
        ? 'https://multi-ai-chat-backend.vercel.app/api/chat/stream'
        : 'http://localhost:5000/api/chat/stream';

      const authToken =
        localStorage.getItem('auth_token') ||
        sessionStorage.getItem('auth_token');

      const headers = {
        'Content-Type': 'application/json',
      };

      if (authToken) {
        headers.Authorization = `Bearer ${authToken}`;
      }

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers,
        body: JSON.stringify({
          message: finalMessage,  // ← Use updated variable
          topicId: topicIdToUse,
          modelId: model.id,
          providerModelId,
          memoryMode,
          historyLimit: Number(historyLimit),
          ragEnabled,
        }),
        signal: controller.signal,
      });


      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let fullReply = '';
      let metadata = {};
      let streamingText = '';

      // Add empty assistant message for streaming
      setMessages(prev => [...prev, { role: 'assistant', content: '', streaming: true }]);

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;

        const text = decoder.decode(value);
        const lines = text.split('\n');

        for (const line of lines) {
          if (!line.startsWith('data: ')) continue;

          try {
            const data = JSON.parse(line.slice(6));
            if (data.type === 'error') {
              setError(data.error);
              break;
            }
            if (data.type === 'chunk') {
              streamingText += data.text;
              // Update last message with streamed content
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: streamingText
                };
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
                updated[updated.length - 1] = {
                  ...updated[updated.length - 1],
                  content: fullReply,
                  ...metadata,
                  streaming: false
                };
                return updated;
              });
              break;
            }
          } catch (e) {
            // Ignore parse errors
          }
        }
      }

      // Update final message metadata
      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = {
          ...updated[updated.length - 1],
          streaming: false,
          model: metadata.model,
          tokensUsed: metadata.tokensUsed,
          cacheHit: metadata.cacheHit,
        };
        return updated;
      });

      setInput('');
      setFailedMessage(null);

      // Update topic if new
      if (metadata.topicId && !activeTopic) {
        console.log('[DEBUG] Setting topic after response:', metadata.topicId);
        setActiveTopic({ id: metadata.topicId });
        setSidebarRefresh(p => p + 1);
      } else if (metadata.topicId && activeTopic?.id !== metadata.topicId) {
        console.log('[DEBUG] Updating topic:', metadata.topicId);
        setActiveTopic({ id: metadata.topicId });
      }

      await refreshTokenStats();

    } catch (err) {
      if (err.name === 'CanceledError' || err.name === 'AbortError') {
        setMessages(prev => [...prev.slice(0, -1), { role: 'assistant', content: '_Query stopped by user._' }]);
        return;
      }

      const msg = err.response?.data?.error || err.message || 'Something went wrong.';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${msg}` }]);
    } finally {
      setLoading(false);
      abortControllerRef.current = null;
    }
  }, [input, pendingFile, loading, model, activeTopic, memoryMode, historyLimit, ragEnabled, providerModelId, refreshTokenStats]);

  // Ctrl+Enter or Enter (without shift) to send
  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSend();
    }
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
        <div className="messages-area">

          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb" />
              <h2>Welcome to Azim's ChatBot</h2>
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

          {/* Typing indicator */}
          {loading && (
            <div className="message-row assistant">
              <div className="msg-avatar assistant"><Loader2 size={14} className="spin" /></div>
              <div className="msg-bubble assistant typing-indicator">
                <span /><span /><span />
              </div>
            </div>
          )}

          <div ref={bottomRef} />
        </div>

        {/* Input area */}
        <div className="input-area">
          {error && <div className="chat-error">{error}</div>}

          <div className="memory-controls">
            <button
              type="button"
              className={`memory-mode-btn ${memoryMode === 'summarized' ? 'active' : ''}`}
              onClick={() => {
                setMemoryMode('summarized');
                setHistoryLimit(8);
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
                setHistoryLimit(12);
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

            {showAdvancedMemory && (
              <>
                <label className="memory-limit-control">
                  Last
                  <input
                    type="number"
                    min="2"
                    max="20"
                    value={historyLimit}
                    onChange={e => setHistoryLimit(e.target.value)}
                  />
                  msgs
                </label>

                <label className="memory-toggle-control">
                  <input
                    type="checkbox"
                    checked={ragEnabled}
                    onChange={e => setRagEnabled(e.target.checked)}
                  />
                  RAG on for Accurate+ by default
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
              disabled={loading || !model}
              rows={1}
            />

            <button
              className="send-btn"
              onClick={handleSend}
              disabled={(!input.trim() && !pendingFile && !loading) || !model}
            >
              {loading ? <StopCircle size={18} /> : <Send size={18} />}
            </button>
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
                  if (failedMessage) setInput(failedMessage);
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