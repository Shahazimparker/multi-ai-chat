// ============================================================
// FILE: frontend/src/pages/Finance/components/DashboardNav.jsx
// PURPOSE: Finance-specific left sidebar — SAP module navigation
// ============================================================

import React, { useState } from 'react';

const SECTIONS = [
  {
    label: 'Finance',
    items: [
      { icon: '📊', label: 'Overview', badge: null },
      { icon: '🧾', label: 'Sales Invoices', badge: 4 },
      { icon: '💳', label: 'Accounts Payable', badge: null },
      { icon: '📥', label: 'Accounts Receivable', badge: null },
      { icon: '📈', label: 'Profit & Loss', badge: null },
    ],
  },
  {
    label: 'Operations',
    items: [
      { icon: '🏭', label: 'Cost Centers', badge: null },
      { icon: '📦', label: 'Purchase Orders', badge: null },
      { icon: '🔄', label: 'GR/GI Postings', badge: null },
      { icon: '💰', label: 'Budget vs Actual', badge: null },
    ],
  },
  {
    label: 'CFO Tools',
    items: [
      { icon: '🎯', label: 'KPI Targets', badge: null },
      { icon: '⚠️', label: 'Risk Alerts', badge: 3 },
      { icon: '🤖', label: 'AI Insights', badge: null },
    ],
  },
  {
    label: 'Config',
    items: [
      { icon: '🔗', label: 'OData APIs', badge: null },
      { icon: '🔑', label: 'API Keys', badge: null },
    ],
  },
];

const DashboardNav = ({ onAskChat }) => {
  const [active, setActive] = useState('Overview');

  return (
    <aside className="finance-dashboard-nav">
      {SECTIONS.map(sec => (
        <React.Fragment key={sec.label}>
          <div className="finance-nav-section-label">{sec.label}</div>
          {sec.items.map(item => (
            <button
              key={item.label}
              onClick={() => setActive(item.label)}
              className={`finance-nav-item ${active === item.label ? 'active' : ''}`}
            >
              <div className="finance-nav-item-icon">{item.icon}</div>
              <span style={{ flex: 1 }}>{item.label}</span>
              {item.badge && (
                <span className="finance-nav-badge">{item.badge}</span>
              )}
            </button>
          ))}
        </React.Fragment>
      ))}
    </aside>
  );
};

export default DashboardNav;
