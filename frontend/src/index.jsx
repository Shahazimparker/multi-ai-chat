// ============================================================
// FILE: frontend/src/index.jsx
// PURPOSE: React DOM entry point
// ============================================================

import React       from 'react';
import ReactDOM    from 'react-dom/client';
import './index.css';
import App         from './App';

const root = ReactDOM.createRoot(document.getElementById('root'));
root.render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
