// ============================================================
// FILE: frontend/src/components/chat/ComposerPlusMenu.jsx
// PURPOSE: The "+" button at the head of the composer. It collects the things
//          you can add to a message besides its text — today the knowledge
//          bases to search — so the composer row stays a row of icons.
// ============================================================

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { Plus, Database, Check, ChevronRight, ChevronLeft, Settings2 } from 'lucide-react';
import { useNavigate } from 'react-router';
import { useKnowledgeCollections, toggleCollectionId } from './useKnowledgeCollections';
import './ComposerPlusMenu.css';

const PANEL_WIDTH = 288;

const ComposerPlusMenu = ({ selectedCollectionIds = [], onSelectionChange, disabled }) => {
  const { collections, loading } = useKnowledgeCollections();
  const [open, setOpen] = useState(false);
  const [pane, setPane] = useState('root');
  const [panelStyle, setPanelStyle] = useState({});
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  const selectedCount = collections.filter((c) => selectedCollectionIds.includes(c.id)).length;

  // The trigger sits at the bottom of the viewport, so the panel is pinned to
  // the top edge of the button and grows upward into the space above it.
  const updatePanelPosition = () => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - PANEL_WIDTH - 12));

    setPanelStyle({
      position: 'fixed',
      bottom: `${Math.max(12, window.innerHeight - rect.top + 8)}px`,
      left: `${left}px`,
      width: `${PANEL_WIDTH}px`,
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

  const goManage = () => {
    setOpen(false);
    navigate('/knowledge');
  };

  const rootPane = (
    <div className="plus-pane">
      <button
        type="button"
        className={`plus-menu-item ${selectedCount > 0 ? 'active' : ''}`}
        onClick={() => setPane('knowledge')}
      >
        <Database size={16} className="plus-item-icon" />
        <span className="plus-item-label">Knowledge Base</span>
        {selectedCount > 0 && <span className="plus-item-count">{selectedCount}</span>}
        <ChevronRight size={14} className="plus-item-chevron" />
      </button>

      <button type="button" className="plus-menu-item" onClick={goManage}>
        <Settings2 size={16} className="plus-item-icon" />
        <span className="plus-item-label">Manage knowledge bases</span>
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
