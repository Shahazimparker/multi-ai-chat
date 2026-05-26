// ============================================================
// FILE: frontend/src/pages/Finance/components/RevenueChart.jsx
// PURPOSE: Weekly revenue bar chart widget
// ============================================================

import React from 'react';

const MOCK_WEEKLY_REVENUE = [
  { day: 'Mon', value: 6000000, label: '₹60L' },
  { day: 'Tue', value: 8200000, label: '₹82L' },
  { day: 'Wed', value: 12000000, label: '₹1.2Cr' },
  { day: 'Thu', value: 7400000, label: '₹74L' },
  { day: 'Fri', value: 9100000, label: '₹91L' },
  { day: 'Sat', value: 4500000, label: '₹45L' },
  { day: 'Sun', value: 3000000, label: '₹30L' },
];

const RevenueChart = ({ onAskChat }) => {
  const max = Math.max(...MOCK_WEEKLY_REVENUE.map(d => d.value));
  return (
    <div className="finance-card">
      <div className="finance-card-header">
        <div className="finance-card-title">
          <div className="finance-card-dot" style={{ background: '#0070F2' }} />
          Daily Revenue (This Week)
        </div>
        <span className="finance-ask-ai" onClick={() => onAskChat('Explain this week daily revenue trend and reasons')}>
          Ask AI ↗
        </span>
      </div>

      <div style={{ display: 'flex', alignItems: 'flex-end', gap: 6, height: 80, marginBottom: 12 }}>
        {MOCK_WEEKLY_REVENUE.map(d => {
          const pct = (d.value / max) * 100;
          const isMax = d.value === max;
          const isMin = d.value === Math.min(...MOCK_WEEKLY_REVENUE.map(x => x.value));
          const bg = isMax ? '#0070F2' : isMin ? '#6A6D70' : '#0EBFA1';
          return (
            <div key={d.day} style={{ flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 4, height: '100%', justifyContent: 'flex-end' }}>
              <div style={{ width: '100%', borderRadius: '3px 3px 0 0', background: bg, height: `${pct}%`, minHeight: 4, transition: 'height 0.8s ease' }} />
              <div style={{ fontSize: 9, color: 'var(--fin-text-muted, #6A6D70)', fontFamily: "'IBM Plex Mono', monospace" }}>{d.day}</div>
            </div>
          );
        })}
      </div>

      <div style={{ display: 'flex', gap: 18 }}>
        {[
          { lbl: 'PEAK DAY', val: 'Wed ₹1.2 Cr', color: '#0070F2' },
          { lbl: 'LOWEST DAY', val: 'Sun ₹30 L', color: '#BB0000' },
          { lbl: 'WEEKLY TOTAL', val: '₹5.44 Cr', color: '#188A2E' },
        ].map(s => (
          <div key={s.lbl}>
            <div style={{ fontSize: 10, color: 'var(--fin-text-muted, #6A6D70)', marginBottom: 2 }}>{s.lbl}</div>
            <div style={{ fontFamily: "'IBM Plex Mono', monospace", fontSize: 13, fontWeight: 500, color: s.color }}>{s.val}</div>
          </div>
        ))}
      </div>
    </div>
  );
};

export default RevenueChart;
