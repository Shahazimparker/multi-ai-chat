// ============================================================
// FILE: frontend/src/components/layout/Toast.jsx
// PURPOSE: Lightweight toast notifications, replacing window.alert().
//          Self-contained — no external toast dependency.
// ============================================================

import React, { useCallback, useEffect, useRef, useState } from 'react';
import { CheckCircle, AlertCircle, Info, X } from 'lucide-react';
import './Toast.css';

let nextToastId = 0;

const ICONS = {
  success: CheckCircle,
  error: AlertCircle,
  info: Info,
};

/**
 * Toast state for a page.
 *
 * @returns {{toasts: Array, showToast: Function, dismissToast: Function}}
 *   showToast(message, variant = 'error', duration = 5000) — duration 0 keeps
 *   the toast until dismissed manually.
 */
export const useToasts = () => {
  const [toasts, setToasts] = useState([]);
  // Timers are cleared on unmount so a dismissal can't fire after teardown.
  const timers = useRef(new Map());

  const dismissToast = useCallback((id) => {
    const timer = timers.current.get(id);
    if (timer) {
      clearTimeout(timer);
      timers.current.delete(id);
    }
    setToasts((prev) => prev.filter((t) => t.id !== id));
  }, []);

  const showToast = useCallback((message, variant = 'error', duration = 5000) => {
    if (!message) return null;
    const id = ++nextToastId;
    setToasts((prev) => [...prev, { id, message: String(message), variant }]);
    if (duration > 0) {
      timers.current.set(id, setTimeout(() => dismissToast(id), duration));
    }
    return id;
  }, [dismissToast]);

  useEffect(() => {
    const pending = timers.current;
    return () => {
      pending.forEach(clearTimeout);
      pending.clear();
    };
  }, []);

  return { toasts, showToast, dismissToast };
};

export const ToastStack = ({ toasts, onDismiss }) => {
  if (!toasts?.length) return null;

  return (
    <div className="toast-stack" role="region" aria-label="Notifications">
      {toasts.map(({ id, message, variant }) => {
        const Icon = ICONS[variant] || ICONS.info;
        return (
          <div
            key={id}
            className={`toast toast-${variant}`}
            // Errors interrupt assistive tech; successes are announced politely.
            role={variant === 'error' ? 'alert' : 'status'}
          >
            <Icon size={18} className="toast-icon" aria-hidden="true" />
            <span className="toast-message">{message}</span>
            <button
              type="button"
              className="toast-close"
              onClick={() => onDismiss(id)}
              aria-label="Dismiss notification"
            >
              <X size={15} />
            </button>
          </div>
        );
      })}
    </div>
  );
};

export default ToastStack;
