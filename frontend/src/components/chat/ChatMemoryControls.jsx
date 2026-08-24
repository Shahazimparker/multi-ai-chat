import React from 'react';

const ChatMemoryControls = ({
  memoryMode,
  setMemoryMode,
  historyLimit,
  setHistoryLimit,
  ragEnabled,
  setRagEnabled,
  storeInDb,
  setStoreInDb,
  showAdvancedMemory,
  setShowAdvancedMemory,
}) => (
  <div className="memory-controls">
    <button
      type="button"
      className={`memory-mode-btn ${memoryMode === 'summarized' ? 'active' : ''}`}
      onClick={() => {
        setMemoryMode('summarized');
        setHistoryLimit(5);
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
        setHistoryLimit(8);
        setRagEnabled(true);
      }}
    >
      Accurate+
    </button>
    <button type="button" className="memory-advanced-btn" onClick={() => setShowAdvancedMemory((prev) => !prev)}>
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
            onChange={(event) => {
              const value = parseInt(event.target.value, 10);
              setHistoryLimit(Number.isNaN(value) ? 2 : Math.max(2, Math.min(20, value)));
            }}
          />
          msgs
        </label>

        <label className="memory-toggle-control">
          <input type="checkbox" checked={ragEnabled} onChange={(event) => setRagEnabled(event.target.checked)} />
          RAG on
        </label>

        <label className="memory-toggle-control" title="Store full file binary directly in PostgreSQL database instead of Vercel Blob storage (max 4.5MB)">
          <input
            type="checkbox"
            checked={Boolean(storeInDb)}
            onChange={(event) => setStoreInDb?.(event.target.checked)}
          />
          upgDB
        </label>
      </>
    )}
  </div>
);

export default ChatMemoryControls;
