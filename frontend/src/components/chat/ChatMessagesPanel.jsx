import React from 'react';
import { Loader2 } from 'lucide-react';
import MessageBubble from './MessageBubble';
import ChatUploadProgress from './ChatUploadProgress';

const ChatMessagesPanel = ({
  messages,
  loading,
  isStreaming,
  uploadProgress,
  uploadMessage,
  cancelUploadAndStream,
  showScrollBtn,
  scrollToBottom,
  bottomRef,
  messagesAreaRef,
  handleScroll,
  setSuggestionInput,
  onApprovalComplete,
  onClarificationSubmit,
}) => (
  <div className="messages-area" ref={messagesAreaRef} onScroll={handleScroll}>
    {messages.length === 0 ? (
      <div className="empty-state">
        <div className="empty-orb" />
        <h2>Welcome to Miles Intelligence</h2>
        <p>Select a model and start chatting with your AI assistant</p>
        <div className="suggestion-chips">
          {['Explain quantum computing', 'Write a Python script', 'Translate to French', 'Debug my code'].map((suggestion) => (
            <button key={suggestion} className="chip" onClick={() => setSuggestionInput(suggestion)}>{suggestion}</button>
          ))}
        </div>
      </div>
    ) : (
      messages.map((msg, index) => (
        <MessageBubble
          key={index}
          message={msg}
          onApprovalComplete={onApprovalComplete}
          onClarificationSubmit={onClarificationSubmit}
        />
      ))
    )}

    <ChatUploadProgress
      uploadProgress={uploadProgress}
      uploadMessage={uploadMessage}
      cancelUploadAndStream={cancelUploadAndStream}
    />

    {loading && !isStreaming && (
      <div className="message-row assistant">
        <div className="msg-avatar assistant"><Loader2 size={14} className="spin" /></div>
        <div className="msg-bubble assistant typing-indicator">
          <span /><span /><span />
        </div>
      </div>
    )}

    {showScrollBtn && messages.length > 0 && (
      <button className="scroll-to-bottom-btn" onClick={scrollToBottom} title="Scroll to bottom">↓</button>
    )}
    <div ref={bottomRef} />
  </div>
);

export default ChatMessagesPanel;
