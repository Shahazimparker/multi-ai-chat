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
import UnifiedModelModal from '../components/chat/UnifiedModelModal';

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
  const [unifiedProvider, setUnifiedProvider] = useState(null);
  const [providerModelId, setProviderModelId] = useState(null);
  const [failedMessage, setFailedMessage] = useState(null);
  const [llmError, setLlmError] = useState(null);


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
	setFailedMessage(userMsg);
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
		providerModelId,
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
  if (err.response?.data?.retryable) {
    setLlmError(err.response.data);
    return;
  }

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
<<<<<<< HEAD
<div className="input-area">
  <div className="input-box">
    {/* 1. File Upload (Compact Icon) */}
    <FileUpload
      topicId={activeTopic?.id}
      onFileUploaded={(file) => {
        setUploadedFiles(prev => [...prev, file]);
        // Optional: remove this message if you want a cleaner chat
        setMessages(prev => [...prev, {
          role: 'assistant',
          content: `📎 File "${file.fileName}" uploaded successfully.`,
        }]);
      }}
      disabled={loading || !model}
    />

    {/* 2. Restored Textarea */}
    <textarea
      ref={textareaRef}
      value={input}
      onChange={handleInputChange}
      onKeyDown={handleKeyDown}
      placeholder={model ? `Message ${model.label}...` : "Select a model..."}
      rows={1}
      disabled={loading || !model}
    />
    
    {/* 3. Send button */}
    <button 
      className="send-btn" 
      onClick={handleSend} 
      disabled={loading || !model || !input.trim()}
    >
      {loading ? <StopCircle size={18} /> : <Send size={18} />}
    </button>
  </div>
  
<<<<<<< HEAD
  {error && <div className="chat-error">{error}</div>}
=======
  {/* Send button */}
  <button className="send-btn" onClick={handleSend} disabled={...}>
    {loading ? <StopCircle size={18} /> : <Send size={18} />}
  </button>
</div>
		
=======
        <div className="input-area">
>>>>>>> parent of 71fa551 (change:add attachment function)
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
>>>>>>> parent of 3d75602 (change:add attachment function fix2.1)

  <div className="memory-controls">
    <button
      type="button"
      className={`memory-mode-btn ${memoryMode === 'summarized' ? 'active' : ''}`}
      onClick={() => setMemoryMode('summarized')}
    >
      Summarized+
    </button>

    <button
      type="button"
      className={`memory-mode-btn ${memoryMode === 'accurate' ? 'active' : ''}`}
      onClick={() => setMemoryMode('accurate')}
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
      <label className="memory-limit-control">
        Limit: 
        <input 
          type="number" 
          value={historyLimit} 
          onChange={(e) => setHistoryLimit(parseInt(e.target.value))} 
        />
      </label>
    )}
  </div>
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
};

export default ChatPage;