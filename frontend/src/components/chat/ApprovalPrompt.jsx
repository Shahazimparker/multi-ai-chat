import React, { useState, useCallback, useRef, useEffect } from 'react';
import api from '../../config/api';
import './ApprovalPrompt.css';

const MAX_INSTRUCTIONS = 500;

const ApprovalPrompt = ({ approvalId, toolType, toolLabel, message, summary, onComplete }) => {
  // pending | other | submitting | approved | modified | rejected
  const [status, setStatus] = useState('pending');
  const [instructions, setInstructions] = useState('');
  const [error, setError] = useState('');
  const textareaRef = useRef(null);

  useEffect(() => {
    if (status === 'other') textareaRef.current?.focus();
  }, [status]);

  const respond = useCallback(async (response, reason = '') => {
    setError('');
    try {
      const res = await api.post(`/approval/${approvalId}/respond`, { response, reason });
      if (!res.data.success) throw new Error('Unexpected response');
    } catch (err) {
      setError(err.response?.data?.error || 'Request failed — please try again');
      throw err;
    }
  }, [approvalId]);

  const handleYes = useCallback(async () => {
    if (status !== 'pending') return;
    setStatus('submitting');
    try {
      await respond(true, '');
      setStatus('approved');
      onComplete?.('approved');
    } catch {
      setStatus('pending');
    }
  }, [status, respond, onComplete]);

  const handleNo = useCallback(async () => {
    if (status !== 'pending') return;
    setStatus('rejected');
    try {
      await respond(false, 'Cancelled by user');
      onComplete?.('rejected');
    } catch {
      setStatus('pending');
    }
  }, [status, respond, onComplete]);

  const handleSubmitInstructions = useCallback(async () => {
    const trimmed = instructions.trim();
    if (!trimmed) { textareaRef.current?.focus(); return; }
    setStatus('submitting');
    try {
      await respond(true, trimmed);
      setStatus('modified');
      onComplete?.('modified');
    } catch {
      setStatus('other');
    }
  }, [instructions, respond, onComplete]);

  // ── Terminal states ──────────────────────────────────────────
  if (status === 'approved') {
    return (
      <div className="ap ap--approved">
        <span className="ap__icon">✓</span>
        <span className="ap__state-text">Approved — generating…</span>
      </div>
    );
  }
  if (status === 'modified') {
    return (
      <div className="ap ap--modified">
        <span className="ap__icon">✎</span>
        <span className="ap__state-text">Changes noted — revising plan…</span>
      </div>
    );
  }
  if (status === 'rejected') {
    return (
      <div className="ap ap--rejected">
        <span className="ap__icon">✕</span>
        <span className="ap__state-text">Cancelled</span>
      </div>
    );
  }

  const isSubmitting = status === 'submitting';

  return (
    <div className="ap">
      {/* Header */}
      <div className="ap__header">
        <span className="ap__badge">{toolLabel || toolType || 'Generate'}</span>
        <span className="ap__title">{message || `Ready to generate — review and confirm`}</span>
      </div>

      {/* Summary */}
      {summary && (
        <div className="ap__summary">
          {summary.split('\n').map((line, i) => (
            <div key={i} className={line.startsWith('  ') ? 'ap__summary-indent' : 'ap__summary-line'}>
              {line}
            </div>
          ))}
        </div>
      )}

      {/* "Other" textarea */}
      {status === 'other' && (
        <div className="ap__instructions-wrap">
          <label className="ap__instructions-label">What changes do you want?</label>
          <textarea
            ref={textareaRef}
            className="ap__textarea"
            placeholder="e.g. Add a slide on market trends, use a dark theme, include more data points…"
            value={instructions}
            onChange={e => setInstructions(e.target.value.slice(0, MAX_INSTRUCTIONS))}
            rows={3}
          />
          <div className="ap__instructions-footer">
            <span className="ap__char-count">{instructions.length}/{MAX_INSTRUCTIONS}</span>
            <div className="ap__instructions-actions">
              <button className="ap__btn ap__btn--ghost" onClick={() => { setStatus('pending'); setInstructions(''); }} disabled={isSubmitting}>
                Back
              </button>
              <button className="ap__btn ap__btn--primary" onClick={handleSubmitInstructions} disabled={isSubmitting || !instructions.trim()}>
                {isSubmitting ? 'Sending…' : '↩ Revise & re-approve'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Main action buttons */}
      {status !== 'other' && (
        <div className="ap__actions">
          <button className="ap__btn ap__btn--approve" onClick={handleYes} disabled={isSubmitting}>
            {isSubmitting ? 'Approving…' : '✅ Yes, generate'}
          </button>
          <button className="ap__btn ap__btn--other" onClick={() => setStatus('other')} disabled={isSubmitting}>
            ✎ Other
          </button>
          <button className="ap__btn ap__btn--reject" onClick={handleNo} disabled={isSubmitting}>
            ❌ No
          </button>
        </div>
      )}

      {error && <div className="ap__error">{error}</div>}
    </div>
  );
};

export default React.memo(ApprovalPrompt);
