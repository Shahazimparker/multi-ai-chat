import React, { useEffect, useMemo, useState } from 'react';
import { X, Search, RefreshCw } from 'lucide-react';
import api from '../../config/api';
import './UnifiedModelModal.css';

const UnifiedModelModal = ({ provider, onClose, onSelect }) => {
  const [query, setQuery] = useState('');
  const [models, setModels] = useState([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState('');

  const providerSlug = provider?.provider || provider?.id;

  const loadModels = async (refresh = false) => {
    if (!providerSlug) return;

    setError('');
    if (refresh) setRefreshing(true);
    else setLoading(true);

    try {
      const res = await api.get(`/chat/provider-models/${providerSlug}`, {
        params: refresh ? { refresh: true } : undefined,
      });

      setModels(res.data.models || []);
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to load models from provider');
      setModels(provider?.models || []);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  useEffect(() => {
    loadModels(false);
  }, [providerSlug]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return models;

    return models.filter((m) =>
      m.label?.toLowerCase().includes(q) ||
      m.id?.toLowerCase().includes(q) ||
      m.description?.toLowerCase().includes(q)
    );
  }, [models, query]);

  if (!provider) return null;

  return (
    <div className="unified-modal-backdrop">
      <div className="unified-modal">
        <div className="unified-modal-header">
          <div>
            <h3>{provider.label}</h3>
            <p>Select a live model from this provider</p>
          </div>

          <div className="unified-header-actions">
            <button type="button" onClick={() => loadModels(true)} disabled={refreshing} title="Refresh models">
              <RefreshCw size={15} className={refreshing ? 'spin' : ''} />
            </button>
            <button type="button" onClick={onClose} title="Close">
              <X size={16} />
            </button>
          </div>
        </div>

        <div className="unified-search">
          <Search size={15} />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search models..."
          />
        </div>

        {error && <div className="unified-error">{error}</div>}

        <div className="unified-model-list">
          {loading ? (
            <div className="unified-empty">Loading models...</div>
          ) : filtered.length === 0 ? (
            <div className="unified-empty">No models found</div>
          ) : (
            filtered.map((model) => (
              <button
                type="button"
                key={model.id}
                className="unified-model-option"
                onClick={() => onSelect(model)}
              >
                <span>
                  <strong>{model.label}</strong>
                  <em>{model.id}</em>
                  {model.contextLength && (
                    <em>{model.contextLength.toLocaleString()} context</em>
                  )}
                </span>
                <small className={model.paid ? 'paid' : 'free'}>
                  {model.paid ? 'Paid' : 'Free'}
                </small>
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
};

export default UnifiedModelModal;