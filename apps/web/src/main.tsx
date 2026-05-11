import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import App from './App';
import { WalletContextProvider } from './providers/WalletProvider';
import './index.css';

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <BrowserRouter>
      <WalletContextProvider>
        <App />
      </WalletContextProvider>
    </BrowserRouter>
  </StrictMode>,
);

