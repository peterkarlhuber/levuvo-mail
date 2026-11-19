import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RootBoundary } from './ModuleBoundary';
import './styles/index.css';

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </React.StrictMode>
);
