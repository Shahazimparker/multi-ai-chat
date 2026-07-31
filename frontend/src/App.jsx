// ============================================================
// FILE: frontend/src/App.jsx
// PURPOSE: Root component — sets up router and auth provider
// ============================================================

import React, { Suspense, lazy } from 'react';
import { BrowserRouter, Routes, Route, Navigate } from 'react-router';
import { AuthProvider, useAuth } from './context/AuthContext';
import { ThemeProvider } from './context/ThemeContext';
import LoginPage        from './pages/LoginPage';
import ChatPage         from './pages/ChatPage';

// Admin-only, and the sole consumer of recharts. Loading it lazily keeps that
// chart library out of the bundle every non-admin user downloads.
const AdminPage = lazy(() => import('./pages/AdminPage'));

// ── Protected route wrapper ────────────────────────────────
const ProtectedRoute = ({ children, adminOnly = false }) => {
  const { user, loading } = useAuth();
  if (loading) return <div className="loading-screen"><div className="spinner" /></div>;
  if (!user)   return <Navigate to="/login" replace />;
  if (adminOnly && user.role !== 'admin') return <Navigate to="/chat" replace />;
  return children;
};

const AppRoutes = () => (
  <Suspense fallback={<div className="loading-screen"><div className="spinner" /></div>}>
    <Routes>
      <Route path="/login"     element={<LoginPage />} />
      <Route path="/chat"      element={<ProtectedRoute><ChatPage /></ProtectedRoute>} />
      <Route path="/admin"     element={<ProtectedRoute adminOnly><AdminPage /></ProtectedRoute>} />
      <Route path="*"          element={<Navigate to="/login" replace />} />
    </Routes>
  </Suspense>
);

const App = () => (
  <ThemeProvider>
    <AuthProvider>
      <BrowserRouter>
        <AppRoutes />
      </BrowserRouter>
    </AuthProvider>
  </ThemeProvider>
);

export default App;
