// ============================================================
// FILE: frontend/src/pages/AnonymousPage.jsx
// PURPOSE: Anonymous chat — uses sessionStorage only.
//          No login required, no history saved to DB.
//          All messages cleared on tab/browser close.
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, Ghost, ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ModelSelector from '../components/chat/ModelSelector';
import MessageBubble from '../components/chat/MessageBubble';
import api from '../config/api';
import './AnonymousPage.css';

const SESSION_KEY = 'anon_messages'; // sessionStorage key

const AnonymousPage = () => {
  const navigate  = useNavigate();
  const bottomRef = useRef(null);
  const taRef     = useRef(null);

  // Load from sessionStorage (persists within tab, gone on close)
  const [messages, setMessages] = useState(() => {
    try { return JSON.parse(sessionStorage.getItem(SESSION_KEY) || '[]'); }
    catch { return []; }
  });
  const [input,   setInput]   = useState('');
  const [model,   setModel]   = useState(null);
  const [loading, setLoading] = useState(false);
  const [error,   setError]   = useState('');

  // Persist to sessionStorage on every change
  useEffect(() => {
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(messages));
    bottomRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages]);

  const handleInputChange = (e) => {
    setInput(e.target.value);
    if (taRef.current) {
      taRef.current.style.height = 'auto';
      taRef.current.style.height = Math.min(taRef.current.scrollHeight, 140) + 'px';
    }
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !model) return;
    const userMsg = input.trim();
    setInput('');
    setError('');
    if (taRef.current) taRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    try {
      // No topicId, no auth token — fully anonymous call
      const res = await api.post('/chat/message', {
        modelId: model.id,
        message: userMsg,
      });

      const { reply, tokensUsed, model: modelLabel, cacheHit } = res.data;
      setMessages(prev => [...prev, { role: 'assistant', content: reply, model: modelLabel, tokensUsed, cacheHit }]);
    } catch (err) {
      const msg = err.response?.data?.error || 'Request failed';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }]);
    } finally {
      setLoading(false);
    }
  };

  const handleKeyDown = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  const clearSession = () => {
    if (window.confirm('Clear all messages?')) {
      setMessages([]);
      sessionStorage.removeItem(SESSION_KEY);
    }
  };

  return (
    <div className="anon-root">
      {/* Header */}
      <header className="anon-header">
        <button className="back-btn" onClick={() => navigate('/login')}>
          <ArrowLeft size={16} /> Back
        </button>
        <div className="anon-title">
          <Ghost size={18} />
          <span>Anonymous Mode</span>
        </div>
        <div className="anon-notice">Session only · Not saved</div>
        <div className="anon-header-right">
          <ModelSelector selectedModel={model} onModelChange={setModel} />
          {messages.length > 0 && (
            <button className="clear-btn" onClick={clearSession}>Clear</button>
          )}
        </div>
      </header>

      {/* Messages */}
      <div className="anon-messages">
        {messages.length === 0 ? (
          <div className="anon-empty">
            <Ghost size={40} className="ghost-icon" />
            <h3>No account needed</h3>
            <p>Your messages are only stored in this browser session. Close the tab and they're gone.</p>
          </div>
        ) : (
          messages.map((msg, i) => <MessageBubble key={i} message={msg} />)
        )}

        {loading && (
          <div className="message-row assistant">
            <div className="msg-avatar assistant"><Loader2 size={14} className="spin-icon" /></div>
            <div className="msg-bubble assistant typing-indicator">
              <span /><span /><span />
            </div>
          </div>
        )}

        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="anon-input-area">
        {error && <div className="anon-error">{error}</div>}
        <div className="anon-input-box">
          <textarea
            ref={taRef}
            value={input}
            onChange={handleInputChange}
            onKeyDown={handleKeyDown}
            placeholder={model ? `Message ${model.label}…` : 'Select a model first…'}
            disabled={loading || !model}
            rows={1}
          />
          <button className="anon-send" onClick={handleSend} disabled={!input.trim() || loading || !model}>
            <Send size={16} />
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnonymousPage;
