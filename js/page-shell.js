import { initializeTheme } from './theme.js';
import { initializeNavigation } from './navbar.js';
import { registerServiceWorker } from './pwa.js';

initializeNavigation();
initializeTheme();
registerServiceWorker();
