import React, { useMemo, useState } from 'react';
import { X, Search } from 'lucide-react';
import './UnifiedModelModal.css';

const UnifiedModelModal = ({ provider, onClose, onSelect }) => {
  const [query, setQuery] = useState('');

  const models = provider?.models || [];

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;
    return models.filter(m =>
      m.label.toLowerCase().includes(q) ||
      m.id.toLowerCase().includes(q)
    );
  }, [models, query]);

  if (!provider) return null;

  return (
    <div className="unified-modal-backdrop">
      <div className="unified-modal">
        <div className="unified-modal-header">
          <div>
            <h3>{provider.label}</h3>
            <p>Select a model from this unified provider</p>
          </div>
          <button onClick={onClose} title="Close">
            <X size={16} />
          </button>
        </div>

        <div className="unified-search">
          <Search size={15} />
          <input
            value={query}
            onChange={e => setQuery(e.target.value)}
            placeholder="Search models..."
          />
        </div>

        <div className="unified-model-list">
          {filtered.map(model => (
            <button
              key={model.id}
              className="unified-model-option"
              onClick={() => onSelect(model)}
            >
              <span>{model.label}</span>
              <small>{model.paid ? 'Paid' : 'Free'}</small>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
};

export default UnifiedModelModal;