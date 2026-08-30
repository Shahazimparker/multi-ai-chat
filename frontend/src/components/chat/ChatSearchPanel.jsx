// ============================================================
// FILE: frontend/src/components/chat/ChatSearchPanel.jsx
// PURPOSE: Find something said earlier in a long conversation. Opened from
//          the magnifier in the chat toolbar; typing filters the messages
//          already on screen, and picking a result scrolls the transcript to
//          that turn and flashes it — the Teams pattern.
//          Searches THIS chat only. Finding a file across chats is the
//          sidebar's job; finding a sentence is this.
// ============================================================

import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ArrowDown, ArrowUp, Bot, Search, User, X } from 'lucide-react';
import { messageDomId, searchMessages } from './chatSearch';
import './ChatSearchPanel.css';

const HIGHLIGHT_CLASS = 'search-hit';
const HIGHLIGHT_MS = 1600;

const formatWhen = (value) => {
  if (!value) return '';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return '';
  return date.toLocaleString(undefined, {
    month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit',
  });
};

const ChatSearchPanel = ({ open, onClose, messages }) => {
  const [query, setQuery] = useState('');
  const [activeIndex, setActiveIndex] = useState(-1);
  const inputRef = useRef(null);
  const highlightTimer = useRef(null);
  const highlighted = useRef(null);

  // Recomputed as you type. The transcript is already in memory, so this is a
  // scan over an array rather than a request — no debounce to get wrong.
  // Gated on `open` because `messages` gets a new identity on every streamed
  // token: a closed panel would otherwise re-scan the whole transcript per token.
  const results = useMemo(
    () => (open ? searchMessages(messages, query) : []),
    [open, messages, query],
  );

  // A reply streaming in changes the result set under a held position. Reading
  // through this keeps "4 of 3" and a highlight on the wrong row off the screen.
  const safeActive = activeIndex < results.length ? activeIndex : -1;

  // Opening should land the caret in the box; nobody opens search to not type.
  useEffect(() => {
    if (!open) return undefined;
    // After the drawer's transform starts, or focus scrolls the page to where
    // the panel still is.
    const id = window.requestAnimationFrame(() => inputRef.current?.focus());
    return () => window.cancelAnimationFrame(id);
  }, [open]);

  // Escape closes from anywhere in the panel, not only from the input — after
  // picking a result the focus is on that result's button.
  useEffect(() => {
    if (!open) return undefined;
    const onEscape = (event) => {
      if (event.key === 'Escape') onClose();
    };
    window.addEventListener('keydown', onEscape);
    return () => window.removeEventListener('keydown', onEscape);
  }, [open, onClose]);

  const clearHighlight = useCallback(() => {
    if (highlightTimer.current) {
      clearTimeout(highlightTimer.current);
      highlightTimer.current = null;
    }
    highlighted.current?.classList.remove(HIGHLIGHT_CLASS);
    highlighted.current = null;
  }, []);

  // The flash is applied to the live node rather than through React state: the
  // messages list is owned by ChatMessagesPanel, and threading a transient
  // "which row is flashing" prop through it would make every message re-render
  // twice per jump.
  const goToResult = useCallback((result, position) => {
    setActiveIndex(position);
    const element = document.getElementById(messageDomId(result.index));
    if (!element) return;

    element.scrollIntoView({ behavior: 'smooth', block: 'center' });

    clearHighlight();
    element.classList.add(HIGHLIGHT_CLASS);
    highlighted.current = element;
    highlightTimer.current = setTimeout(() => {
      element.classList.remove(HIGHLIGHT_CLASS);
      if (highlighted.current === element) highlighted.current = null;
      highlightTimer.current = null;
    }, HIGHLIGHT_MS);
  }, [clearHighlight]);

  // Step through hits without leaving the keyboard, the way a find bar does.
  const step = useCallback((delta) => {
    if (results.length === 0) return;
    const next = safeActive < 0
      ? (delta > 0 ? 0 : results.length - 1)
      : (safeActive + delta + results.length) % results.length;
    goToResult(results[next], next);
  }, [results, safeActive, goToResult]);

  // A new query invalidates the old position, and the old flash with it.
  useEffect(() => {
    setActiveIndex(-1);
    clearHighlight();
  }, [query, clearHighlight]);

  useEffect(() => {
    if (!open) {
      setActiveIndex(-1);
      clearHighlight();
    }
  }, [open, clearHighlight]);

  // Nothing may outlive the component — a timer firing after unmount would
  // touch a node React has already dropped.
  useEffect(() => clearHighlight, [clearHighlight]);

  const onKeyDown = (event) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      step(event.shiftKey ? -1 : 1);
    }
  };

  const trimmed = query.trim();

  return (
    <>
      {open && <div className="chat-search-overlay" onClick={onClose} />}

      <aside className={`chat-search-panel ${open ? 'open' : ''}`} aria-hidden={!open}>
        <header className="chat-search-header">
          <div className="chat-search-title">
            <Search size={15} />
            <span>Search this chat</span>
          </div>
          <button type="button" className="chat-search-close" onClick={onClose} aria-label="Close search">
            <X size={16} />
          </button>
        </header>

        <div className="chat-search-box">
          <Search size={13} className="chat-search-box-icon" />
          <input
            ref={inputRef}
            type="text"
            placeholder="Find in conversation…"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            onKeyDown={onKeyDown}
            aria-label="Search this conversation"
          />
          {query && (
            <button type="button" className="chat-search-clear" onClick={() => setQuery('')} aria-label="Clear search">
              <X size={13} />
            </button>
          )}
        </div>

        {trimmed && (
          <div className="chat-search-status">
            <span>
              {results.length === 0
                ? 'No matches'
                : `${safeActive >= 0 ? `${safeActive + 1} of ` : ''}${results.length} ${results.length === 1 ? 'message' : 'messages'}`}
            </span>
            <div className="chat-search-steps">
              <button
                type="button"
                onClick={() => step(-1)}
                disabled={results.length === 0}
                title="Previous match (Shift+Enter)"
                aria-label="Previous match"
              >
                <ArrowUp size={13} />
              </button>
              <button
                type="button"
                onClick={() => step(1)}
                disabled={results.length === 0}
                title="Next match (Enter)"
                aria-label="Next match"
              >
                <ArrowDown size={13} />
              </button>
            </div>
          </div>
        )}

        <div className="chat-search-results">
          {!trimmed && (
            <p className="chat-search-empty">
              Type to find anything said in this conversation. Press Enter to jump between matches.
            </p>
          )}
          {trimmed && results.length === 0 && (
            <p className="chat-search-empty">Nothing in this chat matches “{trimmed}”.</p>
          )}

          {results.map((result, position) => (
            <button
              type="button"
              key={result.index}
              className={`chat-search-result ${position === safeActive ? 'active' : ''}`}
              onClick={() => goToResult(result, position)}
            >
              <span className="chat-search-result-head">
                <span className={`chat-search-who ${result.role}`}>
                  {result.role === 'user' ? <User size={11} /> : <Bot size={11} />}
                  {result.role === 'user' ? 'You' : 'Assistant'}
                </span>
                {result.matchCount > 1 && (
                  <span className="chat-search-count">{result.matchCount}×</span>
                )}
                {result.createdAt && (
                  <span className="chat-search-when">{formatWhen(result.createdAt)}</span>
                )}
              </span>
              <span className="chat-search-snippet">
                {result.before}
                <mark>{result.match}</mark>
                {result.after}
              </span>
            </button>
          ))}
        </div>
      </aside>
    </>
  );
};

export default ChatSearchPanel;
