// ============================================================
// FILE: frontend/src/pages/Finance/FinancePage.jsx
// PURPOSE: Finance page — full-screen, no global sidebar.
//          Minimal top bar: Back to Chat | ModelSelector | ThemeToggle | Logout
// ============================================================

import React, { useState, useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { LogOut, ArrowLeft } from 'lucide-react';
import { useAuth } from '../../context/AuthContext';
import ThemeToggle from '../../components/layout/ThemeToggle';
import ModelSelector from '../../components/chat/ModelSelector';
import TokenBar from '../../components/layout/TokenBar';
import FinanceLayout from './FinanceLayout';
import api from '../../config/api';
import './FinancePage.css';

const FinancePage = () => {
  const { user, logout } = useAuth();
  const navigate = useNavigate();
  const [models, setModels] = useState([]);
  const [model, setModel] = useState(null);

  useEffect(() => {
    api.get('/chat/models')
      .then(res => setModels(res.data.models || []))
      .catch(() => {});
  }, []);

  const handleLogout = () => {
    logout();
    navigate('/login');
  };

  return (
    <div className="finance-page-root">
      {/* ── Minimal Top Bar ── */}
      <header className="finance-topbar">
        <div className="finance-topbar-left">
          <button
            className="finance-back-btn"
            onClick={() => navigate('/chat')}
            title="Back to Chat"
          >
            <ArrowLeft size={16} />
            <span>Back to Chat</span>
          </button>
        </div>

        <div className="finance-topbar-center">
          <span className="finance-topbar-title">💰 Finance AI · SAP S/4HANA</span>
        </div>

        <div className="finance-topbar-right">
          <ModelSelector
            selectedModel={model}
            onModelChange={setModel}
            onUnifiedProviderSelect={() => {}}
          />
          <ThemeToggle />
          <button
            className="finance-logout-btn"
            onClick={handleLogout}
            title="Logout"
          >
            <LogOut size={15} />
          </button>
        </div>
      </header>

      {/* ── Token Bar ── */}
      <TokenBar />

      {/* ── Full-screen Finance Layout ── */}
      <div className="finance-page-content">
        <FinanceLayout selectedModel={model} />
      </div>
    </div>
  );
};

export default FinancePage;
