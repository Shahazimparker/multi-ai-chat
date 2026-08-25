// ============================================================
// FILE: frontend/src/components/chat/ModelSelector.jsx
// PURPOSE: Model picker plus the per-model reasoning-effort submenu.
// ============================================================
// The control sits under the composer, so the list opens upward. Every model
// that exposes more than one effort level carries a caret on its row; hovering
// it (tapping, on mobile) opens a flyout with that model's own levels, so the
// model and the effort are picked in one gesture instead of two. The levels
// come from the capability block the server reports — nothing about a provider
// is hardcoded here beyond the display spelling of a level name.

import React, { useState, useEffect, useLayoutEffect, useRef } from 'react';
import { createPortal } from 'react-dom';
import { ChevronUp, ChevronRight, Zap, DollarSign, X } from 'lucide-react';
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
const LEVEL_MENU_WIDTH = 168;
const LEVEL_ITEM_HEIGHT = 34;

// Display only — the server validates the level against the model, so a new
// provider vocabulary shows through as-is rather than being dropped.
const LEVEL_LABELS = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'X-High',
  max: 'Max',
};

const levelLabel = (level) => LEVEL_LABELS[level] || level;

const ModelSelector = ({
  selectedModel,
  onModelChange,
  onUnifiedProviderSelect,
  reasoningEffort,
  onLevelSelect,
  thinkingEnabled,
}) => {
  const [models, setModels] = useState([]);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(true);
  const [dropdownStyle, setDropdownStyle] = useState({});
  const [isMobile, setIsMobile] = useState(window.innerWidth <= MOBILE_BREAKPOINT);
  // { modelId, style } on desktop; { modelId } on mobile, where the levels
  // expand inline under the row because a flyout has nowhere to go.
  const [levelMenu, setLevelMenu] = useState(null);
  const wrapperRef = useRef(null);
  const closeTimerRef = useRef(null);

  useEffect(() => {
    const handleResize = () => {
      setIsMobile(window.innerWidth <= MOBILE_BREAKPOINT);
    };

    handleResize();
    window.addEventListener('resize', handleResize);
    return () => window.removeEventListener('resize', handleResize);
  }, []);

  // Opens upward: the trigger lives at the bottom of the screen, so the list is
  // pinned to the top edge of the trigger and grows into the space above it.
  const updateDropdownPosition = () => {
    if (!wrapperRef.current || isMobile) return;

    const rect = wrapperRef.current.getBoundingClientRect();
    const maxHeight = Math.max(180, Math.min(440, rect.top - 24));
    const left = Math.max(12, Math.min(rect.left, window.innerWidth - 332));

    setDropdownStyle({
      position: 'fixed',
      bottom: `${Math.max(12, window.innerHeight - rect.top + 8)}px`,
      left: `${left}px`,
      minWidth: '320px',
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
          // Default to ministral-8b if available, otherwise first model
          const defaultModel = nextModels.find(m => m.id === 'ministral-8b') || nextModels[0];
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

  // A flyout anchored to a row that is no longer on screen would float free, so
  // the submenu never outlives the list it belongs to.
  useEffect(() => {
    if (!open) setLevelMenu(null);
  }, [open]);

  const cancelClose = () => {
    if (closeTimerRef.current) {
      clearTimeout(closeTimerRef.current);
      closeTimerRef.current = null;
    }
  };

  // The gap between a row and its flyout costs a mouseleave, so closing is
  // deferred long enough for the pointer to cross it.
  const scheduleClose = () => {
    cancelClose();
    closeTimerRef.current = setTimeout(() => setLevelMenu(null), 160);
  };

  useEffect(() => cancelClose, []);

  const levelsOf = (model) => model.reasoning?.levels || [];

  // The selected model shows the level actually in force; the rest show the
  // default they would start on, which is what picking them would apply.
  const activeLevelOf = (model) => (
    model.id === selectedModel?.id
      ? (reasoningEffort || model.reasoning?.default || null)
      : (model.reasoning?.default || null)
  );

  const openLevelMenu = (model, anchorEl) => {
    cancelClose();
    const levels = levelsOf(model);
    if (levels.length === 0) {
      setLevelMenu(null);
      return;
    }

    if (isMobile) {
      setLevelMenu((prev) => (prev?.modelId === model.id ? null : { modelId: model.id }));
      return;
    }

    const rect = anchorEl.getBoundingClientRect();
    const height = levels.length * LEVEL_ITEM_HEIGHT + 34;
    const top = Math.max(12, Math.min(rect.top - 8, window.innerHeight - height - 12));
    let left = rect.right + 8;
    if (left + LEVEL_MENU_WIDTH > window.innerWidth - 12) {
      left = Math.max(12, rect.left - LEVEL_MENU_WIDTH - 8);
    }

    setLevelMenu({
      modelId: model.id,
      style: { position: 'fixed', top: `${top}px`, left: `${left}px`, width: `${LEVEL_MENU_WIDTH}px` },
    });
  };

  const grouped = models.reduce((acc, model) => {
    if (!acc[model.provider]) acc[model.provider] = [];
    acc[model.provider].push(model);
    return acc;
  }, {});

  const selectedMeta = selectedModel ? PROVIDER_META[selectedModel.provider] : null;
  const selectedCapability = selectedModel?.reasoning || null;
  // A model with no off switch (Gemini) is always thinking, so its level is
  // always in force and worth showing on the trigger.
  const selectedThinking = selectedCapability
    ? (selectedCapability.canDisable === false || thinkingEnabled)
    : false;
  const triggerLevel = selectedThinking && (selectedCapability?.levels?.length || 0) > 0
    ? (reasoningEffort || selectedCapability.default)
    : null;

  const handleSelect = (model) => {
    if (model.unified) {
      onUnifiedProviderSelect?.(model);
    } else {
      onModelChange(model);
    }
    setLevelMenu(null);
    setOpen(false);
  };

  // Picking a level is also picking the model. The parent owns both writes so
  // the effort lands on this model's key rather than on whichever model
  // happened to be selected a moment earlier.
  const handleLevelSelect = (model, level) => {
    onLevelSelect?.(model, level);
    setLevelMenu(null);
    setOpen(false);
  };

  const renderLevelItems = (model) =>
    levelsOf(model).map((level) => {
      const active = activeLevelOf(model) === level;

      return (
        <button
          key={level}
          type="button"
          role="menuitemradio"
          aria-checked={active}
          className={`model-level-item ${active ? 'active' : ''}`}
          onClick={() => handleLevelSelect(model, level)}
        >
          <span>{levelLabel(level)}</span>
          {model.reasoning?.default === level && <span className="model-level-default">default</span>}
        </button>
      );
    });

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
            const hasLevels = levelsOf(model).length > 0;
            const level = activeLevelOf(model);
            const submenuOpen = levelMenu?.modelId === model.id;

            return (
              <div
                key={model.id}
                className={`model-row ${isSelected ? 'selected' : ''} ${submenuOpen ? 'submenu-open' : ''}`}
                onMouseEnter={(event) => { if (!isMobile) openLevelMenu(model, event.currentTarget); }}
                onMouseLeave={() => { if (!isMobile) scheduleClose(); }}
              >
                <button
                  type="button"
                  className={`model-option ${isSelected ? 'active' : ''}`}
                  onClick={() => handleSelect(model)}
                >
                  <span className="option-label">{model.label}</span>
                  {hasLevels && level && <span className="option-level">{levelLabel(level)}</span>}
                  {/* A model that thinks at a single fixed depth has no level to
                      show, so it says so in words instead. */}
                  {model.reasoning && !hasLevels && <span className="model-think-tag">Thinks</span>}
                  <span className={`model-badge sm ${model.paid ? 'paid' : 'free'}`}>
                    {model.paid ? 'Paid' : 'Free'}
                  </span>
                </button>

                {hasLevels && (
                  <button
                    type="button"
                    className="model-level-caret"
                    onClick={(event) => {
                      event.stopPropagation();
                      openLevelMenu(model, event.currentTarget.parentElement);
                    }}
                    title={`Reasoning effort for ${model.label}`}
                    aria-haspopup="menu"
                    aria-expanded={submenuOpen}
                    aria-label={`Reasoning effort for ${model.label}`}
                  >
                    <ChevronRight size={14} className={submenuOpen ? 'open' : ''} />
                  </button>
                )}

                {isMobile && submenuOpen && hasLevels && (
                  <div className="model-level-inline" role="menu">
                    <span className="model-level-inline-label">Reasoning effort</span>
                    <div className="model-level-inline-items">{renderLevelItems(model)}</div>
                  </div>
                )}
              </div>
            );
          })}
        </div>
      );
    });

  const levelFlyoutModel = !isMobile && levelMenu
    ? models.find((entry) => entry.id === levelMenu.modelId)
    : null;

  const desktopDropdown = (
    <>
      <div className="model-dropdown" style={dropdownStyle} onScroll={() => setLevelMenu(null)}>
        {renderGroups()}
      </div>

      {levelFlyoutModel && (
        <div
          className="model-level-menu"
          style={levelMenu.style}
          role="menu"
          onMouseEnter={cancelClose}
          onMouseLeave={scheduleClose}
        >
          <div className="model-level-menu-header">Reasoning effort</div>
          {renderLevelItems(levelFlyoutModel)}
        </div>
      )}

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
        aria-haspopup="menu"
        aria-expanded={open}
      >
        {loading ? (
          <span className="model-loading">Loading models...</span>
        ) : selectedModel ? (
          <>
            <span className="model-emoji">{selectedMeta?.emoji}</span>
            <span className="model-name">{selectedModel.label}</span>
            {triggerLevel && <span className="model-trigger-level">{levelLabel(triggerLevel)}</span>}
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
            <ChevronUp size={14} className={`chevron ${open ? 'open' : ''}`} />
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
