// ============================================================
// FILE: frontend/src/components/chat/ComposerPlusMenu.jsx
// PURPOSE: The "+" button at the head of the composer. It collects the things
//          you can add to a message besides its text — knowledge bases to
//          search, web search, file attachments, and the memory mode — so the
//          composer row itself stays a row of icons.
// ============================================================

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Database, Check, ChevronRight, ChevronLeft, Settings2, Globe, Paperclip, Zap, Target } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useKnowledgeCollections, toggleCollectionId } from './useKnowledgeCollections';
import { useFileAttach } from './FileUpload';
import './ComposerPlusMenu.css';

const PANEL_WIDTH = 288;

const ComposerPlusMenu = ({
  selectedCollectionIds = [],
  onSelectionChange,
  disabled,
  webEnabled,
  setWebEnabled,
  onFileSelect,
  memoryMode,
  setMemoryMode,
  setHistoryLimit,
  setRagEnabled,
}) => {
  const { collections, loading } = useKnowledgeCollections();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState('root');
  const [panelStyle, setPanelStyle] = useState({});
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  // The hidden input lives in the always-mounted wrapper below, not inside
  // the portaled panel, so the OS picker still opens after the panel that
  // triggered it has closed.
  const { inputRef: fileInputRef, openPicker, inputProps: fileInputProps } = useFileAttach({ onFileSelect });

  const selectedCount = collections.filter((c) => selectedCollectionIds.includes(c.id)).length;

  // The trigger sits at the bottom of the viewport, so the panel is pinned to
  // the top edge of the button and grows upward into the space above it.
  const updatePanelPosition = () => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();
    const panelWidth = Math.min(PANEL_WIDTH, window.innerWidth - 24);
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - panelWidth - 12));

    setPanelStyle({
      position: 'fixed',
      bottom: `${Math.max(12, window.innerHeight - rect.top + 8)}px`,
      left: `${left}px`,
      width: `${panelWidth}px`,
      maxHeight: `${Math.max(200, rect.top - 24)}px`,
    });
  };

  useLayoutEffect(() => {
    if (!open) return;

    updatePanelPosition();
    window.addEventListener('resize', updatePanelPosition);
    window.addEventListener('scroll', updatePanelPosition, true);

    return () => {
      window.removeEventListener('resize', updatePanelPosition);
      window.removeEventListener('scroll', updatePanelPosition, true);
    };
  }, [open]);

  // Reopening always lands on the root menu rather than wherever it was closed.
  useEffect(() => {
    if (!open) setPane('root');
  }, [open]);

  // A disabled trigger cannot be clicked shut, so the panel closes itself.
  useEffect(() => {
    if (disabled) setOpen(false);
  }, [disabled]);

  // The overlay swallows clicks meant for the composer while the panel is open,
  // so Escape needs to dismiss it too — otherwise the only way out is finding
  // the overlay to click, which looks like a frozen page.
  useEffect(() => {
    if (!open) return;

    const onKeyDown = (event) => {
      if (event.key === 'Escape') setOpen(false);
    };

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [open]);

  const goManage = () => {
    setOpen(false);
    navigate('/knowledge');
  };

  const handleAttachClick = () => {
    // Open before closing the menu — the click must land while the trigger
    // that called it is still the active element for some browsers to honor
    // a synchronous file-picker open.
    openPicker();
    setOpen(false);
  };

  const applyMemoryMode = (mode) => {
    setMemoryMode(mode);
    if (mode === 'summarized') {
      setHistoryLimit(20);
      setRagEnabled(false);
    } else {
      setHistoryLimit(60);
      setRagEnabled(true);
    }
    setOpen(false);
  };

  const rootPane = (
    <div className="plus-pane">
      <button
        type="button"
        role="menuitem"
        className={`plus-menu-item ${webEnabled ? 'is-on' : ''}`}
        onClick={() => setWebEnabled((prev) => !prev)}
        aria-pressed={webEnabled}
      >
        <Globe size={16} className="plus-item-icon" />
        <span className="plus-item-label">Web search</span>
        {webEnabled && <Check size={14} className="plus-item-check" />}
      </button>

      <button type="button" role="menuitem" className="plus-menu-item" onClick={handleAttachClick}>
        <Paperclip size={16} className="plus-item-icon" />
        <span className="plus-item-label">Attach files</span>
      </button>

      <button
        type="button"
        role="menuitem"
        className={`plus-menu-item ${selectedCount > 0 ? 'active' : ''}`}
        onClick={() => setPane('knowledge')}
      >
        <Database size={16} className="plus-item-icon" />
        <span className="plus-item-label">Knowledge Base</span>
        {selectedCount > 0 && <span className="plus-item-count">{selectedCount}</span>}
        <ChevronRight size={14} className="plus-item-chevron" />
      </button>

      <button type="button" role="menuitem" className="plus-menu-item" onClick={goManage}>
        <Settings2 size={16} className="plus-item-icon" />
        <span className="plus-item-label">Manage knowledge bases</span>
      </button>

      <div className="plus-menu-separator" />
      <div className="plus-menu-section-label">Memory</div>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={memoryMode === 'summarized'}
        className={`plus-menu-item ${memoryMode === 'summarized' ? 'active' : ''}`}
        onClick={() => applyMemoryMode('summarized')}
      >
        <Zap size={16} className="plus-item-icon" />
        <span className="plus-item-label">Summarized+</span>
        {memoryMode === 'summarized' && <Check size={14} className="plus-item-check" />}
      </button>

      <button
        type="button"
        role="menuitemradio"
        aria-checked={memoryMode === 'accurate'}
        className={`plus-menu-item ${memoryMode === 'accurate' ? 'active' : ''}`}
        onClick={() => applyMemoryMode('accurate')}
      >
        <Target size={16} className="plus-item-icon" />
        <span className="plus-item-label">Accurate+</span>
        {memoryMode === 'accurate' && <Check size={14} className="plus-item-check" />}
      </button>
    </div>
  );

  const knowledgePane = (
    <div className="plus-pane">
      <div className="plus-pane-header">
        <button
          type="button"
          className="plus-back-btn"
          onClick={() => setPane('root')}
          aria-label="Back to menu"
        >
          <ChevronLeft size={15} />
        </button>
        <h4>Knowledge Bases</h4>
        <button type="button" className="plus-manage-link" onClick={goManage}>Manage</button>
      </div>

      <div className="plus-pane-list">
        {loading ? (
          <div className="plus-pane-empty">Loading collections...</div>
        ) : collections.length === 0 ? (
          <div className="plus-pane-empty">
            <p>No knowledge collections yet.</p>
            <button type="button" className="plus-create-btn" onClick={goManage}>
              Create Knowledge Base
            </button>
          </div>
        ) : (
          collections.map((col) => {
            const isSelected = selectedCollectionIds.includes(col.id);
            return (
              <button
                key={col.id}
                type="button"
                className={`plus-kb-item ${isSelected ? 'selected' : ''}`}
                onClick={() => onSelectionChange(toggleCollectionId(selectedCollectionIds, col.id))}
                aria-pressed={isSelected}
              >
                <span className="plus-kb-checkbox">{isSelected && <Check size={12} />}</span>
                <span className="plus-kb-info">
                  <span className="plus-kb-name">{col.name}</span>
                  <span className="plus-kb-meta">
                    {col.documentCount || 0} docs · {col.chunkCount || 0} chunks
                  </span>
                </span>
              </button>
            );
          })
        )}
      </div>

      {selectedCount > 0 && (
        <div className="plus-pane-footer">
          <button type="button" className="plus-clear-btn" onClick={() => onSelectionChange([])}>
            Clear Selection
          </button>
        </div>
      )}
    </div>
  );

  return (
    <div className="composer-plus" ref={wrapperRef}>
      <button
        type="button"
        className={`composer-plus-btn ${open ? 'open' : ''} ${selectedCount > 0 ? 'has-selection' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        disabled={disabled}
        title="Add to this message"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label="Add to this message"
      >
        <Plus size={18} />
        {selectedCount > 0 && <span className="composer-plus-dot" />}
      </button>

      <input ref={fileInputRef} {...fileInputProps} />

      {open && createPortal(
        <>
          <div className="composer-plus-overlay" onClick={() => setOpen(false)} />
          <div className="composer-plus-panel" style={panelStyle} role="menu">
            {pane === 'root' ? rootPane : knowledgePane}
          </div>
        </>,
        document.body
      )}
    </div>
  );
};

export default ComposerPlusMenu;
