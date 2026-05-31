import React from 'react';
import { Send, StopCircle } from 'lucide-react';
import FileUpload from './FileUpload';
import ChatMemoryControls from './ChatMemoryControls';
import ChatQueuePopover from './ChatQueuePopover';

const ChatInputPanel = ({
  session,
  composer,
  showAdvancedMemory,
  setShowAdvancedMemory,
  handleSend,
  handleKeyDown,
}) => (
  <div className="input-area">
    {session.error && (
      <div className="chat-error">
        <span>{session.error}</span>
        {session.failedMessage && !session.loading && (
          <button className="retry-btn" onClick={session.handleRetry}>↻ Retry</button>
        )}
      </div>
    )}

    <ChatMemoryControls
      memoryMode={session.memoryMode}
      setMemoryMode={session.setMemoryMode}
      historyLimit={session.historyLimit}
      setHistoryLimit={session.setHistoryLimit}
      ragEnabled={session.ragEnabled}
      setRagEnabled={session.setRagEnabled}
      showAdvancedMemory={showAdvancedMemory}
      setShowAdvancedMemory={setShowAdvancedMemory}
    />

    <div className="input-box">
      <FileUpload
        topicId={session.activeTopic?.id}
        onFileSelect={(files) => composer.setPendingFiles((prev) => [...prev, ...files])}
        disabled={session.loading || !session.model}
      />

      {composer.pendingFiles.length > 0 && (
        <div className="pending-files-list">
          {composer.pendingFiles.map((file, index) => (
            <div key={index} className="pending-file-tag">
              <span className="file-pill">📎 {file.name}</span>
              <button className="remove-file-btn" onClick={() => composer.removePendingFile(index)} title="Remove attachment">
                &times;
              </button>
            </div>
          ))}
        </div>
      )}

      <textarea
        ref={composer.textareaRef}
        value={composer.input}
        onChange={(event) => composer.setInput(event.target.value)}
        onKeyDown={handleKeyDown}
        placeholder={session.model ? 'Ask me anything' : 'Select a model first…'}
        disabled={!session.model}
        rows={1}
        onPaste={(event) => composer.handlePaste(event, session.model)}
      />

      {composer.pendingImage && (
        <div style={{ position: 'relative', display: 'inline-block', marginBottom: 8 }}>
          <img src={composer.pendingImage} alt="Pasted" style={{ maxHeight: 120, borderRadius: 8 }} />
          <button
            onClick={() => composer.setPendingImage(null)}
            style={{ position: 'absolute', top: -6, right: -6, background: 'red', color: 'white', border: 'none', borderRadius: '50%', width: 20, height: 20, cursor: 'pointer' }}
          >
            ✕
          </button>
        </div>
      )}

      <button
        type="button"
        className={`web-toggle-btn ${composer.webEnabled ? 'active' : ''}`}
        onClick={() => composer.setWebEnabled((prev) => !prev)}
        disabled={session.loading || !session.model}
        title="Enable web search for this query"
      >
        <span className={`web-toggle-dot ${composer.webEnabled ? 'on' : 'off'}`} />
        Web
      </button>

      <button
        className={`send-btn ${session.loading ? 'stop-btn' : ''}`}
        onClick={session.loading ? session.handleStop : handleSend}
        disabled={session.loading ? false : (!composer.input.trim() && composer.pendingFiles.length === 0) || !session.model}
      >
        {session.loading ? <StopCircle size={18} /> : <Send size={18} />}
      </button>

      <ChatQueuePopover
        messageQueue={session.messageQueue}
        queuePopoverOpen={session.queuePopoverOpen}
        setQueuePopoverOpen={session.setQueuePopoverOpen}
        queuePopoverRef={session.queuePopoverRef}
        removeFromQueue={session.removeFromQueue}
      />
    </div>

    <p className="input-hint">Enter to send · Shift+Enter for new line</p>
  </div>
);

export default ChatInputPanel;
