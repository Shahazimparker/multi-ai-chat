import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, Zap, DollarSign, X } from 'lucide-react';
import api from '../../config/api';
import './ModelSelector.css';

const PROVIDER_META = {
  deepseek: { label: 'DeepSeek', color: '#4d6bfe', emoji: 'D' },
  gemini: { label: 'Google Gemini', color: '#4285f4', emoji: 'G' },
  groq: { label: 'Groq', color: '#f97316', emoji: 'Q' },
  mistral: { label: 'Mistral AI', color: '#7c3aed', emoji: 'M' },
  claude: { label: 'Anthropic Claude', color: '#f59e0b', emoji: 'A' },
  openrouter: { label: 'OpenRouter', color: '#8b5cf6', emoji: 'R' },
};

const MOBILE_BREAKPOINT = 768;

// Display only — the server validates the level against the model, so a new
// provider vocabulary shows through as-is rather than being dropped.
const LEVEL_LABELS = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Med',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
};

const ModelSelector = ({
  selectedModel,
  onModelChange,
  onUnifiedProviderSelect,
  reasoningEffort,
  setReasoningEffort,
  thinkingEnabled,
}) => {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT);
  const wrapperRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  const updateDropdownPosition = () => {
    if (!wrapperRef.current || isMobile) return;

    const rect = wrapperRef.current.getBoundingClientRect();
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
    if (!open || isMobile) return;

    updateDropdownPosition();
    window.addEventListener('resize', updateDropdownPosition);
    window.addEventListener('scroll', updateDropdownPosition, true);

    return () => {
      window.removeEventListener('resize', updateDropdownPosition);
      window.removeEventListener('scroll', updateDropdownPosition, true);
    };
  }, [open, isMobile]);

  useEffect(() => {
    api.get('/chat/models')
      .then((res) => {
        const nextModels = res.data.models || [];
        setModels(nextModels);

        if (!selectedModel && nextModels.length > 0) {
          // Default to deepseek-v4-flash if available, otherwise first model
          const defaultModel = nextModels.find(m => m.id === 'deepseek-v4-flash') || nextModels[0];
          onModelChange(defaultModel);
        }
      })
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [selectedModel, onModelChange]);

  useEffect(() => {
    if (!open || !isMobile) return;

    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    return () => {
      document.body.style.overflow = previousOverflow;
    };
  }, [open, isMobile]);

  const grouped = models.reduce((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push(model);
    return acc;
  }, {});

  const selectedMeta = selectedModel ? PROVIDER_META[selectedModel.provider] : null;

  const handleSelect = (model) => {
    if (model.unified) {
      onUnifiedProviderSelect?.(model);
    } else {
      onModelChange(model);
    }
    setOpen(false);
  };

  const renderGroups = () =>
    Object.entries(grouped).map(([provider, providerModels]) => {
      const meta = PROVIDER_META[provider] || {
        label: provider,
        emoji: 'AI',
        color: '#ffffff',
      };

      return (
        <div key={provider} className="model-group">
          <div className="model-group-header" style={{ color: meta.color }}>
            <span>{meta.emoji}</span>
            <span>{meta.label}</span>
          </div>

          {providerModels.map((model) => {
            const isSelected = selectedModel?.id === model.id;
            const levels = model.reasoning?.levels || [];
            // The submenu belongs to the chosen model: showing every model's
            // levels at once would be a wall of chips. It also stays visible
            // when thinking is off, so the level can be set before enabling.
            const showLevels = isSelected && levels.length > 0;
            const activeLevel = reasoningEffort || model.reasoning?.default || null;

            return (
              <div key={model.id} className="model-option-row">
                <button
                  type="button"
                  className={`model-option ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelect(model)}
                >
                  <span className="option-label">{model.label}</span>
                  {model.reasoning && <span className="model-think-tag">Thinks</span>}
                  <span className={`model-badge sm ${model.paid ? 'paid' : 'free'}`}>
                    {model.paid ? 'Paid' : 'Free'}
                  </span>
                </button>

                {showLevels && (
                  <div className={`model-levels ${thinkingEnabled === false ? 'muted' : ''}`}>
                    <span className="model-levels-label">Effort</span>
                    {levels.map((level) => (
                      <button
                        key={level}
                        type="button"
                        className={`model-level-chip ${activeLevel === level ? 'active' : ''}`}
                        onClick={() => setReasoningEffort?.(level)}
                        title={`Set reasoning effort to ${level}`}
                      >
                        {LEVEL_LABELS[level] || level}
                      </button>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    });

  const desktopDropdown = (
    <>
      <div className="model-dropdown" style={dropdownStyle}>
        {renderGroups()}
      </div>
      <div className="dropdown-overlay" onClick={() => setOpen(false)} />
    </>
  );

  const mobileSheet = (
    <>
      <div className="model-sheet-overlay" onClick={() => setOpen(false)} />
      <div className="model-sheet" role="dialog" aria-modal="true" aria-label="Select AI model">
        <div className="model-sheet-handle" />
        <div className="model-sheet-header">
          <div>
            <h3>Select AI Model</h3>
            <p>Choose the model you want to chat with</p>
          </div>
          <button
            type="button"
            className="model-sheet-close"
            onClick={() => setOpen(false)}
            title="Close"
            aria-label="Close model selector"
          >
            <X size={18} />
          </button>
        </div>

        <div className="model-sheet-body">
          {renderGroups()}
        </div>
      </div>
    </>
  );

  return (
    <div className="model-selector" ref={wrapperRef}>
      <button
        type="button"
        className="model-trigger"
        onClick={() => setOpen((prev) => !prev)}
        disabled={loading}
      >
        {loading ? (
          <span className="model-loading">Loading models...</span>
        ) : selectedModel ? (
          <>
            <span className="model-emoji">{selectedMeta?.emoji}</span>
            <span className="model-name">{selectedModel.label}</span>
            <span className={`model-badge ${selectedModel.paid ? 'paid' : 'free'}`}>
              {selectedModel.paid ? (
                <>
                  <DollarSign size={10} />
                  Paid
                </>
              ) : (
                <>
                  <Zap size={10} />
                  Free
                </>
              )}
            </span>
            <ChevronDown size={14} className={`chevron ${open ? 'open' : ''}`} />
          </>
        ) : (
          <span>Select Model</span>
        )}
      </button>

      {open && createPortal(isMobile ? mobileSheet : desktopDropdown, document.body)}
    </div>
  );
};

export default ModelSelector;
