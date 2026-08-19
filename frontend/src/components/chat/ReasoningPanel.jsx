// ============================================================
// FILE: frontend/src/components/chat/ReasoningPanel.jsx
// PURPOSE: Collapsible "Thought process" panel for reasoning models.
// ============================================================
// Reasoning arrives before the first answer token, so on a slow model this is
// what fills the silence. Collapsed by default — the thought process is there
// for the curious, not something to read past on every message.

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronRight } from 'lucide-react';
import './ReasoningPanel.css';

/** "14s" / "1m 04s" — a counter, so keep it short. */
const formatDuration = (ms) => {
  const totalSeconds = Math.max(0, Math.round(ms / 1000));
  if (totalSeconds < 60) return `${totalSeconds}s`;
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${minutes}m ${String(seconds).padStart(2, '0')}s`;
};

/**
 * @param {string}  reasoning        accumulated chain of thought
 * @param {number}  [startedAt]      epoch ms of the first reasoning delta
 * @param {number}  [elapsedMs]      frozen duration once thinking finished
 * @param {boolean} [done]           false while deltas are still arriving
 */
const ReasoningPanel = ({ reasoning, startedAt, elapsedMs, done }) => {
  const [open, setOpen] = useState(false);
  const [tick, setTick] = useState(0);
  const bodyRef = useRef(null);

  // Re-render once a second purely to advance the counter. Only while thinking
  // is live, so a finished message costs nothing.
  useEffect(() => {
    if (done || !startedAt) return undefined;
    const id = setInterval(() => setTick((n) => n + 1), 1000);
    return () => clearInterval(id);
  }, [done, startedAt]);

  // Follow the text as it streams, but only when the reader has opened the
  // panel — scrolling a collapsed element would yank the page around.
  useEffect(() => {
    if (open && !done && bodyRef.current) {
      bodyRef.current.scrollTop = bodyRef.current.scrollHeight;
    }
  }, [reasoning, open, done]);

  if (!reasoning) return null;

  // `tick` is read here so the interval above actually repaints the label.
  void tick;
  const duration = done
    ? elapsedMs
    : (startedAt ? Date.now() - startedAt : null);
  const label = done
    ? (duration != null ? `Thought for ${formatDuration(duration)}` : 'Thought process')
    : `Thinking${duration != null ? ` for ${formatDuration(duration)}` : ''}...`;

  return (
    <div className={`reasoning-panel ${done ? '' : 'is-thinking'}`}>
      <button
        type="button"
        className="reasoning-toggle"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
      >
        <ChevronRight size={14} className={`reasoning-caret ${open ? 'is-open' : ''}`} />
        <Brain size={14} className="reasoning-icon" />
        <span className="reasoning-label">{label}</span>
      </button>

      {open && (
        <div className="reasoning-body" ref={bodyRef}>
          {reasoning}
        </div>
      )}
    </div>
  );
};

export default ReasoningPanel;
