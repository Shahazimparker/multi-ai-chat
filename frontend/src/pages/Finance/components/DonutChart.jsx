// ============================================================
// FILE: frontend/src/pages/Finance/components/DonutChart.jsx
// PURPOSE: Invoice status distribution donut chart widget
// ============================================================

import React from 'react';

const MOCK_INVOICE_STATUS = [
  { label: 'Cleared', count: 253, pct: 52.6, color: '#188A2E' },
  { label: 'Open',    count: 142, pct: 29.5, color: '#0070F2' },
  { label: 'Pending', count: 57,  pct: 11.8, color: '#E8A000' },
  { label: 'Overdue', count: 29,  pct: 6.1,  color: '#BB0000' },
];

const DonutChart = ({ onAskChat }) => {
  const total = MOCK_INVOICE_STATUS.reduce((s, d) => s + d.count, 0);
  let offset = 0;
  const R = 38, CIRC = 2 * Math.PI * R;

  return (
    <div className="finance-card">
      <div className="finance-card-header">
        <div className="finance-card-title">
          <div className="finance-card-dot" style={{ background: '#0EBFA1' }} />
          Invoice Status Distribution
        </div>
        <span className="finance-ask-ai" onClick={() => onAskChat('What should I do about pending and overdue invoices?')}>
          Ask AI ↗
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'center', gap: 18 }}>
        <svg width="110" height="110" viewBox="0 0 110 110" style={{ flexShrink: 0 }}>
          <circle cx="55" cy="55" r={R} fill="none" stroke="var(--fin-border, #E0E0E0)" strokeWidth="16" />
          {MOCK_INVOICE_STATUS.map(seg => {
            const dash = (seg.pct / 100) * CIRC;
            const gap  = CIRC - dash;
            const el = (
              <circle
                key={seg.label}
                cx="55" cy="55" r={R}
                fill="none" stroke={seg.color} strokeWidth="16"
                strokeDasharray={`${dash} ${gap}`}
                strokeDashoffset={-offset}
                transform="rotate(-90 55 55)"
              />
            );
            offset += dash;
            return el;
          })}
          <text x="55" y="51" textAnchor="middle" fontFamily="IBM Plex Mono" fontSize="14" fontWeight="500" fill="var(--fin-text-primary, #32363A)">{total}</text>
          <text x="55" y="64" textAnchor="middle" fontFamily="IBM Plex Sans" fontSize="9" fill="var(--fin-text-muted, #6A6D70)">invoices</text>
        </svg>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 7 }}>
          {MOCK_INVOICE_STATUS.map(seg => (
            <div key={seg.label} style={{ display: 'flex', alignItems: 'center', gap: 7, fontSize: 11.5 }}>
              <div style={{ width: 8, height: 8, borderRadius: '50%', background: seg.color, flexShrink: 0 }} />
              <span style={{ flex: 1, color: 'var(--fin-text-primary, #32363A)' }}>{seg.label}</span>
              <span style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 11, color: 'var(--fin-text-muted, #6A6D70)', marginLeft: 10 }}>
                {seg.count} ({seg.pct}%)
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
};

export default DonutChart;
