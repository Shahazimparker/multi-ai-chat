// ============================================================
// FILE: frontend/src/pages/Finance/components/Dashboard.jsx
// PURPOSE: Main dashboard content area — KPIs + charts + table
// ============================================================

import React from 'react';
import KPIGrid from './KPIGrid';
import RevenueChart from './RevenueChart';
import DonutChart from './DonutChart';
import InvoiceTable from './InvoiceTable';

const CFO_QUERIES = [
  { icon: '📅', label: "Yesterday's Sales", query: "Yesterday ki total sales kitni thi?" },
  { icon: '💰', label: "This Week Profit",  query: "Is week ka total profit breakdown karo" },
  { icon: '⚠️', label: "Overdue Invoices",  query: "Top 5 overdue invoices and recommended action" },
  { icon: '🔮', label: "30-Day Forecast",   query: "Cash flow forecast for next 30 days" },
  { icon: '📊', label: "Budget vs Actual",  query: "Compare actual vs budget — where are the biggest variances?" },
  { icon: '👥', label: "DSO by Customer",   query: "Which customers have highest outstanding DSO?" },
  { icon: '📈', label: "EBITDA Comparison", query: "EBITDA this quarter vs last quarter" },
  { icon: '🔍', label: "ACDOCA Anomalies",  query: "Any anomalies or unusual transactions this week in ACDOCA?" },
];

const Dashboard = ({ onAskChat }) => {
  return (
    <main className="finance-dashboard">
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between" }}>
        <div>
          <h1>Finance Overview</h1>
          <p className="finance-dashboard-subtitle">
            Fiscal Year 2025 · Company Code: 1000 · Live from SAP S/4HANA via OData
          </p>
        </div>
        <div style={{ display: "flex", gap: 8 }}>
          {[
            { label: "↓ Export", primary: false },
            { label: "⟳ Refresh", primary: false },
            { label: "+ New Invoice", primary: true },
          ].map(b => (
            <button key={b.label} className={`finance-action-btn ${b.primary ? 'primary' : ''}`}>
              {b.label}
            </button>
          ))}
        </div>
      </div>

      <KPIGrid onAskChat={onAskChat} />

      <div className="finance-cfo-panel">
        <div className="finance-card-title" style={{ marginBottom: 10 }}>
          <div className="finance-card-dot" style={{ background: '#E8A000' }} />
          CFO Quick Decisions
        </div>
        <div className="finance-cfo-chips">
          {CFO_QUERIES.map(q => (
            <button key={q.label} className="finance-cfo-chip" onClick={() => onAskChat(q.query)}>
              <span style={{ fontSize: 13 }}>{q.icon}</span>
              {q.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 14 }}>
        <RevenueChart onAskChat={onAskChat} />
        <DonutChart onAskChat={onAskChat} />
      </div>

      <InvoiceTable onAskChat={onAskChat} />

      <div style={{ height: 8 }} />
    </main>
  );
};

export default Dashboard;
