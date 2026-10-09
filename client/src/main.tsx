import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import '@fontsource/cinzel/400.css';
import '@fontsource/cinzel/600.css';
import '@fontsource/cormorant-garamond/400.css';
import '@fontsource/cormorant-garamond/500.css';
import './estilo.css';
import { App } from './App';

createRoot(document.getElementById('raiz')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
