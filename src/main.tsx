import {StrictMode} from 'react';
import {createRoot} from 'react-dom/client';
import App from './App.tsx';
import './index.css';
import {installCrawlerMemoryInterceptor} from './services/crawlMemory';
import {installScraiMemoryBridge} from './services/scraiMemory';

installCrawlerMemoryInterceptor();
installScraiMemoryBridge();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
