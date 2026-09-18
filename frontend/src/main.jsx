import React from 'react';
import ReactDOM from 'react-dom/client';

// Inter en local (paquet npm) plutôt que depuis Google Fonts : la CSP stricte
// prévue en Phase 11 interdit les ressources externes, et l'ancien site chargeait
// ses polices depuis un CDN.
import '@fontsource/inter/400.css';
import '@fontsource/inter/500.css';
import '@fontsource/inter/600.css';
import '@fontsource/inter/700.css';

import App from './App.jsx';
import './styles/globals.css';

ReactDOM.createRoot(document.getElementById('root')).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
