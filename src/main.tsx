import React from 'react';
import { createRoot } from 'react-dom/client';
import './index.css';
import { App } from './ui/App';
import { registerPwa } from './pwa';
import { initKeyboardLayout } from './controls/bindings';

registerPwa();
void initKeyboardLayout();

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>,
);
