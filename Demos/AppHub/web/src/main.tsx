import { createRoot } from 'react-dom/client';
import App from './App';
import './style.css';

const container = document.getElementById('app');
if (!container) throw new Error('#app container not found');

if ('scrollRestoration' in window.history)
    window.history.scrollRestoration = 'manual';

createRoot(container).render(<App />);

requestAnimationFrame(() => window.scrollTo({ top: 0, left: 0 }));
