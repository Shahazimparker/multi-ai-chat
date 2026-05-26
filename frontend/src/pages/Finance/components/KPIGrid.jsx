// ============================================================
// FILE: frontend/src/pages/Finance/components/KPIGrid.jsx
// PURPOSE: KPI cards grid — clickable, navigates to chat query
// ============================================================

import React from 'react';

const KPI_DATA = [
  { label: 'Total Sales Invoices', value: '₹4.82 Cr', delta: '+12.4% vs last month', up: true, color: 'blue', query: 'Total sales invoice value this month?' },
  { label: 'Net Profit (This Week)', value: '₹38.7 L', delta: '+7.1% vs last week', up: true, color: 'teal', query: 'What is the net profit for this week?' },
  { label: 'Open Invoices (Pending)', value: '142', delta: '18 overdue >30 days', up: false, color: 'gold', query: 'How many open invoices are pending?' },
  { label: 'Collection Efficiency', value: '87.3%', delta: '+3.2% this month', up: true, color: 'green', query: 'What is the collection efficiency this month?' },
];

const COLOR_MAP = {
  blue:  { accent: '#0070F2' },
  teal:  { accent: '#0EBFA1' },
  gold:  { accent: '#E8A000' },
  green: { accent: '#188A2E' },
};

const KPIGrid = ({ onAskChat }) => {
  return (
    <div className="finance-kpi-grid">
      {KPI_DATA.map(kpi => {
        const c = COLOR_MAP[kpi.color];
        return (
          <div
            key={kpi.label}
            className="finance-kpi-card"
            onClick={() => onAskChat(kpi.query)}
          >
            <div className="finance-kpi-bar" style={{ background: c.accent }} />
            <div className="finance-kpi-label">{kpi.label}</div>
            <div className="finance-kpi-value" style={{ color: c.accent }}>{kpi.value}</div>
            <div className="finance-kpi-delta" style={{ color: kpi.up ? '#188A2E' : '#BB0000' }}>
              {kpi.up ? '▲' : '▼'} {kpi.delta}
            </div>
          </div>
        );
      })}
    </div>
  );
};

export default KPIGrid;
