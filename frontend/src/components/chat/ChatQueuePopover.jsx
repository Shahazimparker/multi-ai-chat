import React from 'react';

const ChatQueuePopover = ({
  messageQueue,
  queuePopoverOpen,
  setQueuePopoverOpen,
  queuePopoverRef,
  removeFromQueue,
}) => {
  if (messageQueue.length === 0) return null;

  return (
    <div className="queue-badge-wrapper" ref={queuePopoverRef}>
      <div className="queue-badge" onClick={() => setQueuePopoverOpen((prev) => !prev)}>
        {messageQueue.length} queued {queuePopoverOpen ? '▲' : '▼'}
      </div>
      {queuePopoverOpen && (
        <div className="queue-popover">
          <div className="queue-popover-header">Queued Messages ({messageQueue.length})</div>
          <div className="queue-popover-list">
            {messageQueue.map((queued, index) => (
              <div key={index} className="queue-popover-item" title={queued.text || queued.file?.name || 'message'}>
                <span className="queue-popover-num">{index + 1}.</span>
                <span className="queue-popover-text">{queued.text || queued.file?.name || 'message'}</span>
                <button
                  className="queue-popover-remove"
                  onClick={(event) => {
                    event.stopPropagation();
                    removeFromQueue(index);
                  }}
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
  );
};

export default ChatQueuePopover;
