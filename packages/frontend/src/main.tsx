import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { App } from './App';
import { initTitlebarInset, initExternalLinkHandler, cleanupServiceWorkers } from './utils/tauri';

initTitlebarInset();
initExternalLinkHandler();
cleanupServiceWorkers();

const rootElement = document.getElementById('root');

if (!rootElement) {
  throw new Error('Root element not found');
}

createRoot(rootElement).render(
  <StrictMode>
    <App />
  </StrictMode>
);
