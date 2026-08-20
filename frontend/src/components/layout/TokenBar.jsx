// ============================================================
// FILE: frontend/src/components/layout/TokenBar.jsx
// PURPOSE: Top bar showing total/used/remaining token stats
//          for logged-in users. Updates after each AI call.
// ============================================================

import React from 'react';
import { Zap } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import './TokenBar.css';

const TokenBar = ({ children }) => {
  const { user } = useAuth();
  if (!user) return null;

  const total = user.total_tokens ?? user.totalTokens ?? 0;
  const used = user.used_tokens ?? user.usedTokens ?? 0;
  const remaining = Math.max(total - used, 0);
  const pct = total > 0 ? Math.min((used / total) * 100, 100) : 0;


  // Color the bar based on usage %
  const barColor =
    pct < 60 ? '#10b981' :   // green
      pct < 80 ? '#f59e0b' :   // amber
        '#ef4444';    // red

  return (
    <div className="token-bar">
      {children && <div className="token-bar-addon">{children}</div>}

      <div className="token-bar-stats">
        <Zap size={13} className="token-icon" />
        <span className="token-label">Tokens:</span>

        <div className="token-track">
          <div
            className="token-fill"
            style={{ width: `${pct}%`, background: barColor }}
          />
        </div>

        <span className="token-stat used">{used.toLocaleString()}</span>
        <span className="token-sep">/</span>
        <span className="token-stat total">{total.toLocaleString()}</span>

        <span className="token-remaining" style={{ color: barColor }}>
          ({remaining.toLocaleString()} left)
        </span>
      </div>
    </div>
  );
};

export default TokenBar;
