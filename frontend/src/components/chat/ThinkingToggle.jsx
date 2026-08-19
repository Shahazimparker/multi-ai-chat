// ============================================================
// FILE: frontend/src/components/chat/ThinkingToggle.jsx
// PURPOSE: Thinking on/off plus the per-model effort level submenu.
// ============================================================
// Sits beside the Web toggle, but behaves differently: Web is a per-query
// intent, thinking is a property of the model. The button therefore has three
// states driven entirely by the capability the server reports on the model —
// never by a hardcoded list here, so adding a model to config/models.js is
// enough to light this up.
//
//   no `reasoning`      -> disabled and greyed (Mistral cannot think)
//   canDisable: false   -> locked on, not clickable (Gemini always reasons)
//   otherwise           -> a normal toggle
//
// The button is a brain icon; its label lives in the tooltip and aria-label,
// which use the provider's own word for the feature ("Extended thinking" on
// Haiku 4.5). The caret and level submenu appear only when the model exposes
// more than one level, so Claude Haiku (thinks, no dial) shows a bare icon.

import { useEffect, useRef, useState } from 'react';
import { Brain, ChevronUp } from 'lucide-react';
import './ThinkingToggle.css';

// Provider vocabularies differ (minimal/low/medium/high/xhigh/max); this is
// display only — the server validates the value against the model.
const LEVEL_LABELS = {
  minimal: 'Minimal',
  low: 'Low',
  medium: 'Medium',
  high: 'High',
  xhigh: 'Extra high',
  max: 'Max',
};

const levelLabel = (level) => LEVEL_LABELS[level] || level;

const ThinkingToggle = ({
  model,
  thinkingEnabled,
  setThinkingEnabled,
  reasoningEffort,
  setReasoningEffort,
  disabled,
}) => {
  const [menuOpen, setMenuOpen] = useState(false);
  const wrapperRef = useRef(null);

  const capability = model?.reasoning || null;
  const levels = capability?.levels || [];
  const canDisable = capability ? capability.canDisable !== false : true;
  const supported = Boolean(capability);
  // Gemini has no off switch, so the UI must not offer one.
  const isOn = supported && (!canDisable || thinkingEnabled);
  const hasLevels = supported && levels.length > 0;
  const activeLevel = reasoningEffort || capability?.default || null;

  useEffect(() => {
    if (!menuOpen) return undefined;
    const onDocClick = (event) => {
      if (wrapperRef.current && !wrapperRef.current.contains(event.target)) setMenuOpen(false);
    };
    const onKey = (event) => { if (event.key === 'Escape') setMenuOpen(false); };
    document.addEventListener('mousedown', onDocClick);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDocClick);
      document.removeEventListener('keydown', onKey);
    };
  }, [menuOpen]);

  // A model switch can leave a submenu open for a model that has no levels.
  useEffect(() => { setMenuOpen(false); }, [model?.id]);

  // Providers name this differently — Haiku 4.5's is "extended thinking". One
  // button drives them all; the tooltip uses the provider's own word so the
  // mapping is obvious.
  const featureName = capability?.label || 'Thinking';

  let title;
  if (!model) title = 'Select a model first';
  else if (!supported) title = `${model.label} does not support thinking`;
  else if (!canDisable) title = `${model.label} always reasons — this cannot be turned off`;
  else title = isOn
    ? `${featureName} on for ${model.label} — click to turn off`
    : `${featureName} off for ${model.label} — click to turn on`;

  const toggleDisabled = disabled || !supported || !canDisable;

  return (
    <div className="thinking-toggle" ref={wrapperRef}>
      <div className={`thinking-group ${isOn ? 'active' : ''} ${!supported ? 'unsupported' : ''}`}>
        <button
          type="button"
          className="thinking-btn"
          onClick={() => setThinkingEnabled((prev) => !prev)}
          disabled={toggleDisabled}
          title={title}
          aria-pressed={isOn}
          aria-label={featureName}
        >
          <Brain size={15} className="thinking-icon" />
          {/* Icon-only when off. Once thinking is on, the level rides alongside
              so the current setting is readable without opening the menu —
              nothing else on screen would show it. */}
          {isOn && hasLevels && activeLevel && (
            <span className="thinking-level-chip">{levelLabel(activeLevel)}</span>
          )}
        </button>

        {hasLevels && (
          <button
            type="button"
            className="thinking-caret-btn"
            onClick={() => setMenuOpen((v) => !v)}
            disabled={disabled || !isOn}
            title="Choose reasoning effort"
            aria-haspopup="menu"
            aria-expanded={menuOpen}
            aria-label="Choose reasoning effort"
          >
            <ChevronUp size={12} className={`thinking-caret ${menuOpen ? 'open' : ''}`} />
          </button>
        )}
      </div>

      {menuOpen && hasLevels && (
        <div className="thinking-menu" role="menu">
          <div className="thinking-menu-header">Reasoning effort</div>
          {levels.map((level) => (
            <button
              key={level}
              type="button"
              role="menuitemradio"
              aria-checked={activeLevel === level}
              className={`thinking-menu-item ${activeLevel === level ? 'active' : ''}`}
              onClick={() => { setReasoningEffort(level); setMenuOpen(false); }}
            >
              <span>{levelLabel(level)}</span>
              {capability.default === level && <span className="thinking-menu-default">default</span>}
            </button>
          ))}
        </div>
      )}
    </div>
  );
};

export default ThinkingToggle;
