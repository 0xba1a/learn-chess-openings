// app.js — SPA Router and application entry point (ES module)
//
// Hash-based client-side routing. Manages page lifecycle
// (mount/unmount) and active nav link.

import * as db from './db.js';
import studyPage from './pages/study.js';
import browsePage from './pages/browse.js';
import practicePage from './pages/practice.js';
import managePage from './pages/manage.js';

const routes = {
  '/study': studyPage,
  '/browse': browsePage,
  '/practice': practicePage,
  '/manage': managePage,
};

let currentPage = null;

/**
 * Parse the current hash into a path and params object.
 * @returns {{path: string, params: Object}}
 */
function parseHash() {
  const hash = window.location.hash.slice(1) || '/practice';
  const [path, queryString] = hash.split('?');
  const params = Object.fromEntries(new URLSearchParams(queryString || ''));
  return { path, params };
}

/**
 * Update the active class on nav links.
 * @param {string} path
 */
function updateActiveNav(path) {
  document.querySelectorAll('nav a').forEach((a) => {
    const href = a.getAttribute('href') || '';
    const linkPath = href.replace('#', '');
    if (linkPath === path) {
      a.classList.add('active');
    } else {
      a.classList.remove('active');
    }
  });
}

/**
 * Navigate to the current hash route.
 */
async function navigate() {
  if (currentPage) {
    currentPage.unmount();
    currentPage = null;
  }

  const { path, params } = parseHash();
  const page = routes[path];

  if (!page) {
    window.location.hash = '#/practice';
    return;
  }

  const container = document.getElementById('page-container');
  container.innerHTML = '';
  currentPage = page;
  updateActiveNav(path);

  // Pass navigate function to pages that need it (browse)
  params.navigate = (url) => {
    window.location.hash = url;
  };

  await page.mount(container, params);
}

// Register service worker
if ('serviceWorker' in navigator) {
  navigator.serviceWorker.register('./sw.js').catch(() => {
    // SW registration may fail in dev/test environments
  });
}

// Event listeners
window.addEventListener('hashchange', navigate);

window.addEventListener('DOMContentLoaded', async () => {
  await db.openDB();
  navigate();
});
