// ============================================================
// FILE: frontend/src/pages/ChatPage.jsx
// PURPOSE: Main chat UI — message list, input box, model selector
//          Token bar on top, sidebar for history
// ============================================================

import React, { useState, useRef, useEffect, useCallback } from 'react';
import { Send, StopCircle, Loader2 } from 'lucide-react';
import Sidebar       from '../components/chat/Sidebar';
import ModelSelector from '../components/chat/ModelSelector';
import MessageBubble from '../components/chat/MessageBubble';
import TokenBar      from '../components/layout/TokenBar';
import { useAuth }   from '../context/AuthContext';
import api           from '../config/api';
import './ChatPage.css';

const ChatPage = () => {
  const { refreshTokenStats } = useAuth();

  const [messages,   setMessages]  = useState([]);
  const [input,      setInput]     = useState('');
  const [loading,    setLoading]   = useState(false);
  const [model,      setModel]     = useState(null);   // selected AI model object
  const [activeTopic, setActiveTopic] = useState(null);
  const [sidebarRefresh, setSidebarRefresh] = useState(0);
  const [error,      setError]     = useState('');

  const bottomRef    = useRef(null);
  const textareaRef  = useRef(null);
  const [memoryMode, setMemoryMode] = useState('summarized');
  const [historyLimit, setHistoryLimit] = useState(10);
  const [showAdvancedMemory, setShowAdvancedMemory] = useState(false);


  // Auto-scroll to latest message
  useEffect(() => {
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, loading]);

  // Auto-grow textarea
  const handleInputChange = (e) => {
    setInput(e.target.value);
    const ta = textareaRef.current;
    if (ta) { ta.style.height = 'auto'; ta.style.height = Math.min(ta.scrollHeight, 160) + 'px'; }
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
    if (!input.trim() || loading || !model) return;
    const userMsg = input.trim();
    setInput('');
    if (textareaRef.current) textareaRef.current.style.height = 'auto';
    setError('');

    // Optimistically add user message to UI
    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      const res = await api.post('/chat/message', {
        modelId: model.id,
        message: userMsg,
        topicId: activeTopic?.id || undefined,
		memoryMode,
		historyLimit,
      });

      const { reply, tokensUsed, topicId, cacheHit, model: modelLabel } = res.data;

      // Add assistant reply
      setMessages(prev => [...prev, {
        role: 'assistant', content: reply,
        model: modelLabel, tokensUsed, cacheHit,
      }]);

      // Update active topic (if new chat, topicId is freshly created)
      if (topicId && !activeTopic) {
        setActiveTopic({ id: topicId });
        setSidebarRefresh(p => p + 1);   // refresh sidebar topics list
      }

      await refreshTokenStats(); // refresh token bar
    } catch (err) {
      const msg = err.response?.data?.error || 'Something went wrong. Try again.';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ Error: ${msg}` }]);
    } finally {
      setLoading(false);
    }
  }, [input, loading, model, activeTopic, refreshTokenStats]);

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
        <TokenBar />

        {/* Toolbar */}
        <div className="chat-toolbar">
          <ModelSelector selectedModel={model} onModelChange={setModel} />
          {activeTopic && (
            <span className="topic-hint">
              Continuing topic · {messages.length} messages
            </span>
          )}
        </div>

        {/* Messages area */}
        <div className="messages-area">
          {messages.length === 0 ? (
            <div className="empty-state">
              <div className="empty-orb" />
              <h2>What can I help you with?</h2>
              <p>Select a model above and start chatting</p>
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
    title="Token friendly. Summarizes older context and sends only the latest raw messages."
    onClick={() => setMemoryMode('summarized')}
  >
    Summarized+
  </button>

  <button
    type="button"
    className={`memory-mode-btn ${memoryMode === 'accurate' ? 'active' : ''}`}
    title="Higher token use. Sends more raw chat history for better exact continuity."
    onClick={() => setMemoryMode('accurate')}
  >
    Accurate+
  </button>

  <button
    type="button"
    className="memory-advanced-btn"
    title="Change how many previous messages can be used for memory."
    onClick={() => setShowAdvancedMemory(p => !p)}
  >
    Advanced
  </button>

  {showAdvancedMemory && (
    <label className="memory-limit-control" title="Previous messages include both user messages and AI replies.">
      Last
      <input
        type="number"
        min="2"
        max="20"
        value={historyLimit}
        onChange={e => setHistoryLimit(e.target.value)}
        onBlur={() => setHistoryLimit(Math.max(2, Math.min(20, Number(historyLimit) || 10)))}
      />
      msgs
    </label>
  )}
</div>

          <div className="input-box">
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
              disabled={!input.trim() || loading || !model}
            >
              {loading ? <StopCircle size={18} /> : <Send size={18} />}
            </button>
          </div>
          <p className="input-hint">Enter to send · Shift+Enter for new line</p>
        </div>
      </main>
    </div>
  );
};

export default ChatPage;
