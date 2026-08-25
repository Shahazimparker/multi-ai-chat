// ============================================================
// FILE: frontend/src/components/layout/PWAInstallModal.jsx
// PURPOSE: Modal providing installation guidance for iOS and desktop
// ============================================================

import React from 'react';
import { X, Share2, PlusSquare, Smartphone, Sparkles, CheckCircle2 } from 'lucide-react';
import './PWAInstallModal.css';

const PWAInstallModal = ({ isOpen, onClose }) => {
  if (!isOpen) return null;

  return (
    <div className="pwa-modal-overlay" onClick={onClose} role="dialog" aria-modal="true">
      <div className="pwa-modal-card" onClick={(e) => e.stopPropagation()}>
        <button className="pwa-modal-close" onClick={onClose} aria-label="Close modal">
          <X size={18} />
        </button>

        <div className="pwa-modal-header">
          <div className="pwa-modal-icon-badge">
            <Sparkles size={24} className="pwa-sparkle-icon" />
          </div>
          <h3>Install Miles AI App</h3>
          <p className="pwa-modal-subtitle">
            Get instant access, full-screen chat, and offline speed on your mobile device.
          </p>
        </div>

        <div className="pwa-modal-steps">
          <div className="pwa-step-item">
            <div className="pwa-step-number">1</div>
            <div className="pwa-step-content">
              <div className="pwa-step-title">
                <span>Tap the Share Button</span>
                <Share2 size={16} className="pwa-action-icon" />
              </div>
              <p>In Safari, tap the share icon at the bottom of your screen.</p>
            </div>
          </div>

          <div className="pwa-step-item">
            <div className="pwa-step-number">2</div>
            <div className="pwa-step-content">
              <div className="pwa-step-title">
                <span>Add to Home Screen</span>
                <PlusSquare size={16} className="pwa-action-icon" />
              </div>
              <p>Scroll down the menu and tap <strong>Add to Home Screen</strong>.</p>
            </div>
          </div>

          <div className="pwa-step-item">
            <div className="pwa-step-number">3</div>
            <div className="pwa-step-content">
              <div className="pwa-step-title">
                <span>Confirm Installation</span>
                <CheckCircle2 size={16} className="pwa-action-icon" />
              </div>
              <p>Tap <strong>Add</strong> in the top-right corner to place the app on your home screen.</p>
            </div>
          </div>
        </div>

        <div className="pwa-modal-footer">
          <button className="pwa-btn-got-it" onClick={onClose}>
            Got it
          </button>
        </div>
      </div>
    </div>
  );
};

export default PWAInstallModal;
