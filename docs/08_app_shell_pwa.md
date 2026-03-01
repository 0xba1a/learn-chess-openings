# Design Doc 8: App Shell, SPA Routing, PWA & Manage Page

**Modules:** `index.html`, `js/app.js`, `sw.js`, `manifest.json`, `css/style.css`, `js/pages/manage.js`
**Dependencies:** All other modules (this is the integration layer)
**Parallel with:** All other docs — this is infrastructure that can be scaffolded early

---

## 1. Context

You are building the application shell: the HTML entry point, the SPA router, CSS styling, service worker for offline support, PWA manifest, and the Manage (data import/export/settings) page. This is the glue that ties all modules together.

### Architecture Position

```
┌───────────────────────────────────────────────────────────┐
│  index.html + app.js (SPA router)   ← YOU ARE HERE       │
│       │                                                    │
│   ┌───┴───┬──────────┬──────────┐                         │
│   │study  │ browse   │ practice │  manage (also yours)    │
│   │(Doc 6)│ (Doc 7)  │ (Doc 5)  │                         │
│   └───┬───┴────┬─────┴────┬─────┘                         │
│       │        │          │                                │
│  board.js  dag.js     sm2.js                              │
│  (Doc 4)   (Doc 2)    (Doc 3)                             │
│                │          │                                │
│              db.js (Doc 1)                                 │
│                │                                           │
│            IndexedDB                                       │
│                                                            │
│  sw.js — service worker (also yours)                      │
└───────────────────────────────────────────────────────────┘
```

---

## 2. Project Structure (your files)

```
/
├── index.html              # SPA shell, nav bar, page container
├── manifest.json           # PWA manifest
├── sw.js                   # Service worker
├── css/
│   ├── style.css           # App layout, nav, typography, theme
│   ├── chessground.base.css    # Vendored (provided, don't modify)
│   ├── chessground.brown.css   # Vendored (provided, don't modify)
│   └── chessground.cburnett.css # Vendored (provided, don't modify)
├── js/
│   ├── app.js              # SPA router, nav controller, page lifecycle
│   └── pages/
│       └── manage.js       # Export / import / clear data / settings
└── lib/                    # Vendored libs (provided, don't modify)
```

---

## 3. HTML Entry Point (`index.html`)

Single HTML file — the SPA shell. All pages render into `#page-container`.

```html
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Chess Opening Trainer</title>
    <link rel="manifest" href="manifest.json">
    <link rel="stylesheet" href="css/chessground.base.css">
    <link rel="stylesheet" href="css/chessground.brown.css">
    <link rel="stylesheet" href="css/chessground.cburnett.css">
    <link rel="stylesheet" href="css/style.css">
</head>
<body>
    <nav>
        <a href="#/study">Study</a>
        <a href="#/browse">Browse</a>
        <a href="#/practice">Practice</a>
        <a href="#/manage">Manage</a>
    </nav>
    <main id="page-container"></main>
    <script type="module" src="js/app.js"></script>
</body>
</html>
```

**Important:** All JS uses ES modules (`<script type="module">`). No build step. No bundler.

---

## 4. SPA Router (`app.js`)

Hash-based client-side routing. No server-side routing needed.

### 4.1 Routes

| Hash | Page Module | Description |
|------|-------------|-------------|
| `#/study` | `pages/study.js` | Feed in new opening lines |
| `#/browse` | `pages/browse.js` | Explore and name the repertoire DAG |
| `#/practice` | `pages/practice.js` | SM2-driven practice (optional `?fen=...` query) |
| `#/manage` | `pages/manage.js` | Export, import, settings |
| (default) | Redirect to `#/practice` | Landing page shows practice |

### 4.2 Page Lifecycle

Each page module (from Docs 5, 6, 7, and manage.js below) exports:

```javascript
export default {
    mount(container, params) {
        // Called when navigating TO this page
        // container: the DOM element to render into
        // params: parsed URL parameters (e.g., { fen: "..." })
        // Set up DOM, event listeners, board instances
    },
    unmount() {
        // Called when navigating AWAY from this page
        // Clean up event listeners, destroy board instances
        // Save any pending state
    }
};
```

### 4.3 Router Implementation

```javascript
// app.js — ES module
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

function parseHash() {
    const hash = window.location.hash.slice(1) || '/practice'; // default
    const [path, queryString] = hash.split('?');
    const params = Object.fromEntries(new URLSearchParams(queryString || ''));
    return { path, params };
}

async function navigate() {
    if (currentPage) currentPage.unmount();
    const { path, params } = parseHash();
    const page = routes[path];
    if (!page) { window.location.hash = '#/practice'; return; }
    const container = document.getElementById('page-container');
    container.innerHTML = '';
    currentPage = page;
    await page.mount(container, params);
    // Update active nav link styling
}

window.addEventListener('hashchange', navigate);
window.addEventListener('DOMContentLoaded', async () => {
    await db.openDB();
    navigate();
});
```

### 4.4 Active Nav Link

Highlight the current nav link. On each route change, add an `active` class to the matching `<a>` in `<nav>`.

---

## 5. PWA Manifest (`manifest.json`)

```json
{
    "name": "Chess Opening Trainer",
    "short_name": "ChessTrainer",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#312e2b",
    "theme_color": "#312e2b",
    "icons": [
        { "src": "lib/assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
        { "src": "lib/assets/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
}
```

---

## 6. Service Worker (`sw.js`)

**Strategy:** Cache-first for all static assets. No network requests needed after first load.

```
Install event:
    Cache all files: index.html, CSS files, JS files, lib/ files, piece SVGs

Fetch event:
    If request matches cache → return cached response
    Else → fetch from network, cache the response, return it
```

**Cache versioning:** A version string (e.g., `const CACHE_VERSION = 'v1.0.0'`) triggers cache invalidation on updates. Old caches are cleaned up in the `activate` event.

### Registration

In `app.js`, register the service worker:

```javascript
if ('serviceWorker' in navigator) {
    navigator.serviceWorker.register('/sw.js');
}
```

### Offline Guarantee

- All JavaScript is vendored locally (chessground, chess.js) — no CDN dependencies
- All CSS is vendored locally — including chessground themes and piece SVGs
- IndexedDB is the sole data store — no server calls
- Service worker caches everything on first load — subsequent visits are fully offline
- No external API calls — no analytics, no telemetry, no external fonts

---

## 7. Manage Page (`pages/manage.js`)

### 7.1 Layout

```
┌──────────────────────────────────────────────────────┐
│  Data Management                                      │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Export JSON │  │ Import JSON  │  │  Clear All   │ │
│  └─────────────┘  └──────────────┘  └─────────────┘ │
│                                                       │
│  Statistics:                                          │
│  • Total nodes: 47                                    │
│  • Total edges: 52                                    │
│  • Total lines: 12                                    │
│  • Lines due today: 3                                 │
│  • Average ease factor: 2.35                          │
│                                                       │
│  Settings:                                            │
│  • Auto-play delay: [500ms ▾]                         │
│  • Auto quality rating: [✓]                           │
│  • Board theme: [Brown ▾]                             │
│  • Piece set: [CBurnett ▾]                            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

### 7.2 Export

1. Read all four object stores: `db.getAll("nodes")`, `db.getAll("edges")`, `db.getAll("lines")`, `db.getAll("settings")`.
2. Build the export JSON object:

```json
{
    "version": 1,
    "exportedAt": "2026-03-01T12:00:00Z",
    "data": {
        "nodes": [...],
        "edges": [...],
        "lines": [...],
        "settings": [...]
    }
}
```

3. Trigger download as `chess-trainer-backup-YYYY-MM-DD.json` using a Blob + download link.

### 7.3 Import

1. File upload via `<input type="file" accept=".json">`.
2. Parse JSON, validate structure (see §7.5).
3. Offer two modes:
   - **Merge:** For each record, if a record with the same key exists, skip it. If not, insert it. Lines are matched by `(rootFen, leafFen, color)` tuple.
   - **Replace:** Wipe all stores via `db.clearStore()`, then insert all records from the import file via `db.bulkPut()`.

### 7.4 Clear All

1. Show confirmation dialog: "Type DELETE to confirm".
2. On match: wipe all four stores via `db.clearStore()`.
3. Refresh statistics display.

### 7.5 Import Validation

On import, validate:
- `version` field matches expected version (currently `1`)
- All required fields present in each record
- All FENs are well-formed (4 space-separated parts after normalization)
- All `fens[]` arrays in lines are consistent with `moves[]` arrays
- Edge references point to existing nodes (or nodes present in the import)

Show validation errors to the user before proceeding.

### 7.6 Statistics

Real-time counts from IndexedDB:
- Total nodes: `(await db.getAll("nodes")).length`
- Total edges: `(await db.getAll("edges")).length`
- Total lines: `(await db.getAll("lines")).length`
- Lines due today: `(await sm2.getDueLines()).length`
- Average ease factor: computed from all lines

### 7.7 Settings

Saved to the `settings` store, loaded on app startup.

| Key | Type | Default | Description |
|-----|------|---------|-------------|
| `practiceDelay` | `number` | `500` | Delay (ms) before auto-playing opponent moves |
| `autoRating` | `boolean` | `true` | Auto-calculate SM2 quality from accuracy |
| `boardTheme` | `string` | `"brown"` | Board color theme |
| `pieceSet` | `string` | `"cburnett"` | Piece set |

---

## 8. CSS (`css/style.css`)

Create the application stylesheet covering:

- **Nav bar:** Horizontal nav with links. Active link highlighted.
- **Page container:** Full remaining height below nav.
- **Two-panel layout:** Used by Study, Browse, and Practice pages. Left panel (board), right panel (controls). Use CSS Grid or Flexbox.
- **Board container:** Fixed dimensions required by chessground (e.g., 400×400px).
- **Move list:** Scrollable list with move numbers and reason text.
- **Tree view:** Expandable tree with indentation, toggle icons.
- **Buttons:** Consistent button styling.
- **Highlights:** `.hint` and `.error` classes for square highlighting on the board.
- **Color coding:** `.move-white` and `.move-black` for tree view.
- **Modal/dialog:** For confirmation dialogs and pivot prompts.
- **Typography:** Clean, readable font stack.
- **Theme:** Dark background matching Lichess aesthetic (#312e2b).

---

## 9. Deployment

### Local Development

```bash
# Any static file server works
npx serve .
# or
python3 -m http.server 8000
```

Service worker only activates over HTTPS or localhost.

### GitHub Pages

```bash
# Repo root IS the site root — no build step needed
git push origin main
# Enable GitHub Pages in repo settings → Source: main branch, root folder
```

### Netlify / Vercel

Drag-and-drop deploy of the repo root. No build command, no output directory needed.

---

## 10. Testing Checklist

- [ ] `index.html` loads without errors
- [ ] Nav links navigate between pages
- [ ] Default route (`/` or `#/`) redirects to `#/practice`
- [ ] Active nav link is highlighted
- [ ] Page `mount()` is called on navigation with correct params
- [ ] Page `unmount()` is called when navigating away
- [ ] URL parameter parsing works (e.g., `#/practice?fen=...`)
- [ ] Service worker caches all assets on install
- [ ] App works fully offline after first load
- [ ] PWA "Add to Home Screen" prompt appears on mobile
- [ ] Export generates valid JSON and triggers download
- [ ] Import (Merge) adds new records without overwriting existing
- [ ] Import (Replace) wipes and restores all data
- [ ] Import validation rejects malformed files with clear error messages
- [ ] Clear All requires typing "DELETE" and wipes all stores
- [ ] Statistics display accurate counts
- [ ] Settings persist across page reloads
- [ ] Settings changes are reflected immediately (e.g., practice delay)
