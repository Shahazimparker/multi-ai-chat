// ============================================================
// FILE: frontend/src/components/chat/ModelSelector.jsx
// PURPOSE: Dropdown to select AI model grouped by provider
//          Shows free/paid badge, provider color coding
// ============================================================

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Zap, DollarSign } from 'lucide-react';
import api from '../../config/api';
import './ModelSelector.css';

// Provider display config — color + icon emoji
const PROVIDER_META = {
  gemini: { label: 'Google Gemini', color: '#4285f4', emoji: '✦' },
  groq: { label: 'Groq', color: '#f97316', emoji: '⚡' },
  mistral: { label: 'Mistral AI', color: '#7c3aed', emoji: '🌀' },
  cohere: { label: 'Cohere', color: '#0ea5e9', emoji: '🔷' },
  openai: { label: 'OpenAI GPT', color: '#10b981', emoji: '🤖' },
  claude: { label: 'Anthropic Claude', color: '#f59e0b', emoji: '🧠' },
};

const ModelSelector = ({ selectedModel, onModelChange, onUnifiedProviderSelect }) => {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const wrapperRef = useRef(null);

  const updateDropdownPosition = () => {
    if (!wrapperRef.current) return;

    const rect = wrapperRef.current.getBoundingClientRect();
    const isMobile = window.innerWidth <= 768;

    if (isMobile) {
      setDropdownStyle({
        position: 'fixed',
        top: '72px',
        left: '12px',
        right: '12px',
        width: 'auto',
        minWidth: '0',
        maxHeight: 'calc(100vh - 96px)',
      });
      return;
    }

    const top = rect.bottom + 8;
    const maxHeight = Math.min(420, window.innerHeight - rect.bottom - 24);

    setDropdownStyle({
      position: 'fixed',
      top: `${top}px`,
      left: `${rect.left}px`,
      minWidth: '300px',
      maxHeight: `${maxHeight}px`,
    });
  };


  useLayoutEffect(() => {
    if (!open) return;
    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);
    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open]);

  // Fetch models from backend on mount
  useEffect(() => {
    api.get('/chat/models')
      .then(res => {
        setModels(res.data.models);
        // Set default if none selected
        if (!selectedModel && res.data.models.length > 0) {
          onModelChange(res.data.models[0]);
        }
      })
      .catch(() => { })
      .finally(() => setLoading(false));
  }, []);

  // Group models by provider
  const grouped = models.reduce((acc, m) => {
    if (!acc[m.provider]) acc[m.provider] = [];
    acc[m.provider].push(m);
    return acc;
  }, {});

  const selectedMeta = selectedModel
    ? PROVIDER_META[selectedModel.provider]
    : null;

  return (
    <div className="model-selector" ref={wrapperRef}>
      <button
        className="model-trigger"
        onClick={() => setOpen(p => !p)}
        disabled={loading}
      >
        {loading ? (
          <span className="model-loading">Loading models…</span>
        ) : selectedModel ? (
          <>
            <span className="model-emoji">{selectedMeta?.emoji}</span>
            <span className="model-name">{selectedModel.label}</span>
            <span className={`model-badge ${selectedModel.paid ? 'paid' : 'free'}`}>
              {selectedModel.paid ? <><DollarSign size={10} /> Paid</> : <><Zap size={10} /> Free</>}
            </span>
            <ChevronDown size={14} className={`chevron ${open ? 'open' : ''}`} />
          </>
        ) : (
          <span>Select Model</span>
        )}
      </button>

      {open && createPortal(
        <>
          <div className="model-dropdown" style={dropdownStyle}>
            {Object.entries(grouped).map(([provider, providerModels]) => {
              const meta = PROVIDER_META[provider] || { label: provider, emoji: '🤖' };
              return (
                <div key={provider} className="model-group">
                  <div className="model-group-header" style={{ color: meta.color }}>
                    <span>{meta.emoji}</span>
                    <span>{meta.label}</span>
                  </div>
                  {providerModels.map(model => (
                    <button
                      key={model.id}
                      className={`model-option ${selectedModel?.id === model.id ? 'active' : ''}`}
                      onClick={() => {
                        if (model.unified) {
                          onUnifiedProviderSelect?.(model);
                        } else {
                          onModelChange(model);
                        }
                        setOpen(false);
                      }}
                    >
                      <span className="option-label">{model.label}</span>
                      <span className={`model-badge sm ${model.paid ? 'paid' : 'free'}`}>
                        {model.paid ? 'Paid' : 'Free'}
                      </span>
                    </button>
                  ))}
                </div>
              );
            })}
          </div>
          <div className="dropdown-overlay" onClick={() => setOpen(false)} />
        </>,
        document.body
      )}
    </div>
  );
};

export default ModelSelector;
