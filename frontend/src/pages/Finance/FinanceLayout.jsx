// ============================================================
// FILE: frontend/src/pages/Finance/FinanceLayout.jsx
// PURPOSE: Main Finance page layout — 3-column grid:
//          DashboardNav | Dashboard | FinanceChatPanel
// ============================================================

import React, { useState } from 'react';
import DashboardNav from './components/DashboardNav';
import Dashboard from './components/Dashboard';
import FinanceChatPanel from './components/FinanceChatPanel';
import useFinanceChat from './hooks/useFinanceChat';

const FinanceLayout = ({ selectedModel }) => {
  const [externalQuery, setExternalQuery] = useState(null);
  const { messages, thinking, send } = useFinanceChat();

  const askChat = (query) => setExternalQuery(query);

  return (
    <div className="finance-layout">
      <style>{`
        @import url('https://fonts.googleapis.com/css2?family=IBM+Plex+Sans:wght@300;400;500;600&family=IBM+Plex+Mono:wght@400;500&family=Playfair+Display:wght@600&display=swap');
        @keyframes thinkpulse {
          0%,80%,100%{opacity:0.15; transform:scale(0.8)}
          40%{opacity:1; transform:scale(1)}
        }
      `}</style>

      <div className="finance-grid">
        <DashboardNav onAskChat={askChat} />
        <Dashboard onAskChat={askChat} />
        <FinanceChatPanel
          messages={messages}
          thinking={thinking}
          onSend={send}
          externalQuery={externalQuery}
          onExternalQueryConsumed={() => setExternalQuery(null)}
          selectedModel={selectedModel}
        />
      </div>
    </div>
  );
};

export default FinanceLayout;
