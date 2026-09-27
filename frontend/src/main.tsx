import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import ProductRouter from './product-router.js';
import { SessionProvider } from './session.js';
import './accessibility.css';

const root = document.getElementById('root');
if (!root) throw new Error('LedgerGuard root element is missing');

createRoot(root).render(
  <StrictMode>
    <SessionProvider>
      <ProductRouter />
    </SessionProvider>
  </StrictMode>
);
