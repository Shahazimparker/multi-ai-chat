// ============================================================
// FILE: frontend/src/components/chat/KnowledgeSelector.jsx
// PURPOSE: Knowledge Collection selector dropdown in chat toolbar
// ============================================================

import React, { useState, useEffect, useRef } from 'react';
import { Database, Check, ChevronDown, X, Plus } from 'lucide-react';
import { useNavigate } from 'react-router';
import api from '../../config/api';
import './KnowledgeSelector.css';

const KnowledgeSelector = ({ selectedCollectionIds = [], onSelectionChange }) => {
  const [collections, setCollections] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const wrapperRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    let isMounted = true;
    const fetchCollections = async () => {
      try {
        setLoading(true);
        const res = await api.get('/knowledge/collections');
        if (isMounted) {
          setCollections(res.data?.collections || []);
        }
      } catch (err) {
        console.warn('[KnowledgeSelector] Fetch collections error:', err);
      } finally {
        if (isMounted) setLoading(false);
      }
    };

    fetchCollections();
    return () => { isMounted = false; };
  }, []);

  useEffect(() => {
    const handleClickOutside = (e) => {
      if (wrapperRef.current && !wrapperRef.current.contains(e.target)) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  const toggleCollection = (colId) => {
    if (selectedCollectionIds.includes(colId)) {
      onSelectionChange(selectedCollectionIds.filter((id) => id !== colId));
    } else {
      onSelectionChange([...selectedCollectionIds, colId]);
    }
  };

  const selectedCollections = collections.filter((c) =>
    selectedCollectionIds.includes(c.id)
  );

  return (
    <div className="knowledge-selector-root" ref={wrapperRef}>
      <button
        type="button"
        className={`knowledge-trigger-btn ${selectedCollections.length > 0 ? 'active' : ''}`}
        onClick={() => setOpen((prev) => !prev)}
        title="Attach Knowledge Bases (RAG 2.0)"
      >
        <Database size={15} className="k-icon" />
        <span className="k-label">
          {selectedCollections.length === 0
            ? 'Knowledge Base'
            : `${selectedCollections.length} Collection${selectedCollections.length > 1 ? 's' : ''}`}
        </span>
        <ChevronDown size={13} className={`chevron ${open ? 'open' : ''}`} />
      </button>

      {open && (
        <div className="knowledge-dropdown">
          <div className="dropdown-header">
            <h4>Select Knowledge Bases</h4>
            <button
              type="button"
              className="manage-kb-btn"
              onClick={() => {
                setOpen(false);
                navigate('/knowledge');
              }}
            >
              <Plus size={13} /> Manage
            </button>
          </div>

          <div className="dropdown-list">
            {loading ? (
              <div className="dropdown-empty">Loading collections...</div>
            ) : collections.length === 0 ? (
              <div className="dropdown-empty">
                <p>No knowledge collections yet.</p>
                <button
                  type="button"
                  className="create-first-btn"
                  onClick={() => {
                    setOpen(false);
                    navigate('/knowledge');
                  }}
                >
                  Create Knowledge Base
                </button>
              </div>
            ) : (
              collections.map((col) => {
                const isSelected = selectedCollectionIds.includes(col.id);
                return (
                  <div
                    key={col.id}
                    className={`dropdown-item ${isSelected ? 'selected' : ''}`}
                    onClick={() => toggleCollection(col.id)}
                  >
                    <div className="item-checkbox">
                      {isSelected && <Check size={13} />}
                    </div>
                    <div className="item-info">
                      <span className="item-name">{col.name}</span>
                      <span className="item-meta">{col.documentCount || 0} docs · {col.chunkCount || 0} chunks</span>
                    </div>
                  </div>
                );
              })
            )}
          </div>

          {selectedCollections.length > 0 && (
            <div className="dropdown-footer">
              <button
                type="button"
                className="clear-btn"
                onClick={() => onSelectionChange([])}
              >
                Clear Selection
              </button>
            </div>
          )}
        </div>
      )}
    </div>
  );
};

export default KnowledgeSelector;
