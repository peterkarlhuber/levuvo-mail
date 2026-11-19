import React from 'react';
import { createRoot } from 'react-dom/client';
import App from './App';
import { RootBoundary } from './ModuleBoundary';
import './styles/index.css';
import { applyWindowFrame } from './window-frame';

applyWindowFrame(document.documentElement, navigator.userAgent);

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <RootBoundary>
      <App />
    </RootBoundary>
  </React.StrictMode>
);
