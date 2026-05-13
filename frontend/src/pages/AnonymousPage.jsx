// ============================================================
// FILE: frontend/src/pages/AnonymousPage.jsx
// PURPOSE: Anonymous chat — uses sessionStorage only.
//          No login required, no history saved to DB.
//          All messages cleared on tab/browser close.
//          Uses streaming SSE for real-time responses.
// ============================================================

import React, { useState, useRef, useEffect } from 'react';
import { Send, StopCircle, Ghost, ArrowLeft, Loader2 } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import ModelSelector from '../components/chat/ModelSelector';
import MessageBubble from '../components/chat/MessageBubble';
import './AnonymousPage.css';

const SESSION_KEY = 'anon_messages'; // sessionStorage key

const AnonymousPage = () => {
  const navigate  = useNavigate();
  const bottomRef = useRef(null);
  const taRef     = useRef(null);
  const abortRef  = useRef(null);

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

  const handleStop = () => {
    if (abortRef.current) {
      abortRef.current.abort();
      abortRef.current = null;
    }
    setLoading(false);
  };

  const handleSend = async () => {
    if (!input.trim() || loading || !model) return;
    const userMsg = input.trim();
    setInput('');
    setError('');
    if (taRef.current) taRef.current.style.height = 'auto';

    setMessages(prev => [...prev, { role: 'user', content: userMsg }]);
    setLoading(true);

    const controller = new AbortController();
    abortRef.current = controller;

    try {
      // Streaming SSE endpoint for anonymous users too
      const apiUrl = process.env.NODE_ENV === 'production'
        ? 'https://multi-ai-chat-backend.vercel.app/api/chat/stream'
        : 'http://localhost:5000/api/chat/stream';

      const response = await fetch(apiUrl, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          message: userMsg,
          modelId: model.id,
          memoryMode: 'accurate',
          historyLimit: 5,
          ragEnabled: false,
        }),
        signal: controller.signal,
      });

      if (!response.ok) throw new Error('Stream failed');

      const reader = response.body.getReader();
      const decoder = new TextDecoder();
      let streamingText = '';
      let metadata = {};

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
            } else if (data.type === 'cached') {
              streamingText = data.reply;
              metadata = { cacheHit: true, tokensUsed: 0 };
              setMessages(prev => {
                const updated = [...prev];
                updated[updated.length - 1] = { ...updated[updated.length - 1], content: streamingText, ...metadata, streaming: false };
                return updated;
              });
              break;
            }
          } catch (e) { }
        }
      }

      setMessages(prev => {
        const updated = [...prev];
        updated[updated.length - 1] = { ...updated[updated.length - 1], streaming: false, model: metadata.model, tokensUsed: metadata.tokensUsed, cacheHit: metadata.cacheHit };
        return updated;
      });
    } catch (err) {
      if (err.name === 'AbortError') {
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
      const msg = err.message || 'Request failed';
      setError(msg);
      setMessages(prev => [...prev, { role: 'assistant', content: `❌ ${msg}` }]);
    } finally {
      setLoading(false);
      abortRef.current = null;
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
          <button className="anon-send" onClick={loading ? handleStop : handleSend} disabled={loading ? false : (!input.trim() || !model)}>
            {loading ? <StopCircle size={16} /> : <Send size={16} />}
          </button>
        </div>
      </div>
    </div>
  );
};

export default AnonymousPage;
