// ============================================================
// FILE: frontend/src/pages/Finance/components/FinanceChatPanel.jsx
// PURPOSE: Right-side chat panel for Finance AI — SAP-aware
// ============================================================

import React, { useState, useRef, useEffect } from 'react';

const CHAT_QUICK_QUERIES = [
  { label: "📅 Yesterday's Sales", query: "Yesterday ki total sales kitni thi?" },
  { label: "💰 This Week Profit",  query: "Is week ka total profit breakdown karo" },
  { label: "👥 Top Debtors",       query: "Top 5 customers by outstanding amount" },
  { label: "📊 EBITDA Summary",    query: "EBITDA this quarter vs last — CFO ke liye summary" },
  { label: "⚠️ Overdue List",      query: "Kaunse invoices 30 din se zyada overdue hain?" },
  { label: "🔮 Cash Forecast",     query: "Next month cash flow forecast karo" },
];

const SOURCE_STYLE = {
  odata:    { bg: '#E8F5FF', color: '#0057A8', label: '⚡ OData' },
  hana:     { bg: '#FFF3E0', color: '#A05A00', label: '🗄 ACDOCA' },
  mock:     { bg: '#EDE7F6', color: '#5E35B1', label: '📋 Mock' },
};

function parseBold(text) {
  const parts = text.split(/\*\*(.*?)\*\*/g);
  return parts.map((p, i) =>
    i % 2 === 1 ? <strong key={i}>{p}</strong> : p
  );
}

function renderText(text) {
  return text.split('\n').map((line, i) => {
    const codeInline = line.split(/`([^`]+)`/g);
    const formatted = codeInline.map((seg, j) =>
      j % 2 === 1
        ? <code key={j} style={{ fontFamily: "'IBM Plex Mono',monospace", background: 'var(--fin-bg-hover, #F5F6F7)', padding: '1px 4px', borderRadius: 3, fontSize: 11 }}>{seg}</code>
        : parseBold(seg)
    );
    return <span key={i}>{formatted}{i < text.split('\n').length - 1 && <br />}</span>;
  });
}

function Message({ msg }) {
  const isAI = msg.role === 'ai';
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start', flexDirection: isAI ? 'row' : 'row-reverse' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: 'white',
        background: isAI ? 'linear-gradient(135deg, #0070F2, #0EBFA1)' : '#32363A',
      }}>{isAI ? 'AI' : 'SA'}</div>

      <div style={{ maxWidth: '82%', display: 'flex', flexDirection: 'column', gap: 3 }}>
        {isAI && (
          <div style={{ fontSize: 9.5, fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', color: 'var(--fin-text-muted, #6A6D70)' }}>
            FinanceAI
          </div>
        )}

        <div className={isAI ? 'finance-msg-ai-bubble' : 'finance-msg-user-bubble'}>
          {renderText(msg.text)}
        </div>

        {isAI && msg.sources && (
          <div style={{ display: 'flex', alignItems: 'center', gap: 5, flexWrap: 'wrap' }}>
            {msg.sources.map(s => {
              const st = SOURCE_STYLE[s];
              if (!st) return null;
              return (
                <span key={s} style={{
                  display: 'inline-flex', alignItems: 'center', gap: 3,
                  padding: '1px 7px', borderRadius: 8, fontSize: 9.5, fontWeight: 600,
                  background: st.bg, color: st.color,
                }}>{st.label}</span>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}

function ThinkingBubble() {
  return (
    <div style={{ display: 'flex', gap: 8, alignItems: 'flex-start' }}>
      <div style={{
        width: 28, height: 28, borderRadius: '50%', flexShrink: 0,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        fontSize: 11, fontWeight: 600, color: 'white',
        background: 'linear-gradient(135deg, #0070F2, #0EBFA1)',
      }}>AI</div>
      <div className="finance-msg-ai-bubble" style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
        {['#0070F2', '#0EBFA1', '#E8A000'].map((c, i) => (
          <div key={i} style={{
            width: 7, height: 7, borderRadius: '50%', background: c,
            animation: `thinkpulse 1.2s ${i * 0.2}s infinite`,
          }} />
        ))}
      </div>
    </div>
  );
}

const FinanceChatPanel = ({ messages, thinking, onSend, externalQuery, onExternalQueryConsumed, selectedModel }) => {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef(null);
  const textareaRef = useRef(null);

  useEffect(() => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, thinking]);

  useEffect(() => {
    if (externalQuery) {
      onSend(externalQuery);
      onExternalQueryConsumed();
    }
  }, [externalQuery]);

  const handleSend = () => {
    if (!input.trim()) return;
    onSend(input.trim());
    setInput('');
    textareaRef.current?.focus();
  };

  const handleKey = (e) => {
    if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); handleSend(); }
  };

  return (
    <aside className="finance-chat-panel">
      <div className="finance-chat-header">
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            <div style={{
              width: 28, height: 28, borderRadius: 6,
              background: 'linear-gradient(135deg, #0070F2, #0EBFA1)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14,
            }}>🤖</div>
            <span style={{ fontSize: 13.5, fontWeight: 600, color: 'white' }}>SAP FinanceAI</span>
          </div>
          {selectedModel && (
            <span style={{
              fontSize: 10, fontWeight: 500, color: 'rgba(255,255,255,0.55)',
              background: 'rgba(255,255,255,0.1)', padding: '3px 8px', borderRadius: 8,
            }}>
              {selectedModel.label || selectedModel.id}
            </span>
          )}
        </div>
      </div>

      <div className="finance-config-notice">
        <strong>Mock Mode:</strong> Using local mock data. Backend integration coming in Phase 2.
      </div>

      <div className="finance-chat-messages">
        {messages.map(msg => (
          <Message key={msg.id} msg={msg} />
        ))}
        {thinking && <ThinkingBubble />}
        <div ref={messagesEndRef} />
      </div>

      <div className="finance-chat-quick">
        <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--fin-text-muted, #6A6D70)', marginBottom: 7, letterSpacing: '0.07em', textTransform: 'uppercase' }}>
          Frequent Queries
        </div>
        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 5 }}>
          {CHAT_QUICK_QUERIES.map(q => (
            <button key={q.label} className="finance-quick-chip" onClick={() => onSend(q.query)}>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div className="finance-chat-input-area">
        <div style={{ display: 'flex', gap: 8, alignItems: 'flex-end' }}>
          <textarea
            ref={textareaRef}
            value={input}
            onChange={e => setInput(e.target.value)}
            onKeyDown={handleKey}
            rows={1}
            placeholder="SAP ke baare mein poochho… e.g. Yesterday's revenue, overdue invoices"
            className="finance-chat-input"
          />
          <button className="finance-send-btn" onClick={handleSend}>↑</button>
        </div>
        <div style={{ fontSize: 10.5, color: 'var(--fin-text-muted, #6A6D70)', marginTop: 5, display: 'flex', alignItems: 'center', gap: 5 }}>
          {['⚡ OData', '🗄 ACDOCA', '📋 Mock'].map(s => (
            <span key={s} style={{ padding: '1px 7px', borderRadius: 8, background: 'var(--fin-bg-hover, #F5F6F7)', fontSize: 9.5, fontWeight: 600, color: 'var(--fin-text-muted, #6A6D70)' }}>{s}</span>
          ))}
          <span style={{ marginLeft: 4 }}>Enter to send · Shift+Enter new line</span>
        </div>
      </div>
    </aside>
  );
};

export default FinanceChatPanel;
