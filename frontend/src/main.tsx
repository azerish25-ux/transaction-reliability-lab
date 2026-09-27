import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import App from './App.js';
import { SessionProvider } from './session.js';

const root = document.getElementById('root');
if (!root) throw new Error('LedgerGuard root element is missing');

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <App />
    </SessionProvider>
  </StrictMode>
);
