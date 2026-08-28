import React from 'react';

// Only the numeric/boolean knobs live here now — Summarized+/Accurate+ moved
// into the composer's "+" menu, and the Advanced button that reveals this row
// now lives in the footer next to Thinking.
const ChatMemoryControls = ({
  historyLimit,
  setHistoryLimit,
  ragEnabled,
  setRagEnabled,
  storeInDb,
  setStoreInDb,
}) => (
  <div className="memory-advanced-row">
    <label className="memory-limit-control">
      Last
      <input
        type="number"
        min="2"
        max="200"
        value={historyLimit}
        onChange={(event) => {
          const value = parseInt(event.target.value, 10);
          setHistoryLimit(Number.isNaN(value) ? 2 : Math.max(2, Math.min(200, value)));
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
  </div>
);

export default ChatMemoryControls;
