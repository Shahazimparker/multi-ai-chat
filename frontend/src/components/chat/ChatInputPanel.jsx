import React, { useLayoutEffect } from 'react';
import { Send, StopCircle } from 'lucide-react';
import ComposerPlusMenu from './ComposerPlusMenu';
import ChatMemoryControls from './ChatMemoryControls';
import ChatQueuePopover from './ChatQueuePopover';
import ThinkingToggle from './ThinkingToggle';
import ModelSelector from './ModelSelector';

// Grows the textarea with its content, capped at the CSS max-height so a long
// paste scrolls instead of taking over the composer.
const autoGrow = (el) => {
  if (!el) return;
  el.style.height = 'auto';
  el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
};

const ChatInputPanel = ({
  session,
  composer,
  showAdvancedMemory,
  setShowAdvancedMemory,
  handleSend,
  handleKeyDown,
  handleModelChange,
  handleLevelSelect,
}) => {
  // Driven off the value rather than the keystroke: a suggestion chip and the
  // reset after send both set `input` without ever firing onChange, and those
  // have to resize the box too.
  useLayoutEffect(() => {
    autoGrow(composer.textareaRef.current);
  }, [composer.input, composer.textareaRef]);

  return (
  <div className="input-area">
    {session.error && (
      <div className="chat-error">
        <span>{session.error}</span>
        {session.failedMessage && !session.loading && (
          <button className="retry-btn" onClick={session.handleRetry}>↻ Retry</button>
        )}
      </div>
    )}

    {(composer.pendingFiles.length > 0 || composer.pendingImage) && (
      <div className="composer-attachments">
        {composer.pendingFiles.map((file, index) => (
          <div key={index} className="pending-file-tag">
            <span className="file-pill">📎 {file.name}</span>
            <button className="remove-file-btn" onClick={() => composer.removePendingFile(index)} title="Remove attachment">
              &times;
            </button>
          </div>
        ))}

        {composer.pendingImage && (
          <div className="pending-image-preview">
            <img src={composer.pendingImage} alt="Pasted" />
            <button onClick={() => composer.setPendingImage(null)} className="remove-image-btn" title="Remove image">
              ✕
            </button>
          </div>
        )}
      </div>
    )}

    <div className="input-box">
      {/* Everything you can add to a message that is not the text itself —
          knowledge bases, web search, file attachments, and memory mode — so
          the row around the textarea stays down to text in, send out. */}
      <ComposerPlusMenu
        selectedCollectionIds={session.selectedCollectionIds}
        onSelectionChange={session.setSelectedCollectionIds}
        disabled={session.loading || !session.model}
        webEnabled={composer.webEnabled}
        setWebEnabled={composer.setWebEnabled}
        onFileSelect={(files) => composer.setPendingFiles((prev) => [...prev, ...files])}
        memoryMode={session.memoryMode}
        setMemoryMode={session.setMemoryMode}
        setHistoryLimit={session.setHistoryLimit}
        setRagEnabled={session.setRagEnabled}
      />

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

      <button
        className={`send-btn ${session.loading ? 'stop-btn' : ''}`}
        onClick={session.loading ? session.handleStop : handleSend}
        disabled={session.loading ? false : (!composer.input.trim() && composer.pendingFiles.length === 0 && !composer.pendingImage) || !session.model}
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

    {/* The model lives under the composer, next to the controls that qualify
        it (thinking) and the disclosure for the advanced memory row, rather
        than in the page toolbar — they are all properties of the message
        being written. */}
    <div className="input-footer">
      <div className="input-footer-left">
        <ModelSelector
          selectedModel={session.model}
          onModelChange={handleModelChange}
          onUnifiedProviderSelect={session.setUnifiedProvider}
          reasoningEffort={session.reasoningEffort}
          onLevelSelect={handleLevelSelect}
          thinkingEnabled={session.thinkingEnabled}
        />

        <ThinkingToggle
          model={session.model}
          thinkingEnabled={session.thinkingEnabled}
          setThinkingEnabled={session.setThinkingEnabled}
          reasoningEffort={session.reasoningEffort}
          setReasoningEffort={session.setReasoningEffort}
          disabled={session.loading || !session.model}
        />

        <button
          type="button"
          className="memory-advanced-btn"
          onClick={() => setShowAdvancedMemory((prev) => !prev)}
          aria-expanded={showAdvancedMemory}
        >
          Advanced
        </button>
      </div>

      <p className="input-hint">Enter to send · Shift+Enter for new line</p>
    </div>

    {showAdvancedMemory && (
      <ChatMemoryControls
        historyLimit={session.historyLimit}
        setHistoryLimit={session.setHistoryLimit}
        ragEnabled={session.ragEnabled}
        setRagEnabled={session.setRagEnabled}
        storeInDb={session.storeInDb}
        setStoreInDb={session.setStoreInDb}
      />
    )}
  </div>
  );
};

export default ChatInputPanel;
