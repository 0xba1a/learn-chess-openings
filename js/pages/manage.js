// manage.js — Manage Page module (ES module)
//
// Export, import, and clear repertoire data.
// View statistics and configure settings.

import * as db from '../db.js';
import * as sm2 from '../sm2.js';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} */
let containerEl = null;

// ---------------------------------------------------------------------------
// Statistics
// ---------------------------------------------------------------------------

async function loadStats() {
  const nodes = await db.getAll('nodes');
  const edges = await db.getAll('edges');
  const lines = await db.getAll('lines');
  const dueLines = await sm2.getDueLines();

  let avgEase = 0;
  if (lines.length > 0) {
    const total = lines.reduce((s, l) => s + (l.easeFactor || 2.5), 0);
    avgEase = (total / lines.length).toFixed(2);
  }

  return {
    nodeCount: nodes.length,
    edgeCount: edges.length,
    lineCount: lines.length,
    dueCount: dueLines.length,
    avgEase,
  };
}

function renderStats(stats) {
  const el = containerEl?.querySelector('#manage-stats');
  if (!el) return;

  el.innerHTML = `
    <li>Total nodes: <strong>${stats.nodeCount}</strong></li>
    <li>Total edges: <strong>${stats.edgeCount}</strong></li>
    <li>Total lines: <strong>${stats.lineCount}</strong></li>
    <li>Lines due today: <strong>${stats.dueCount}</strong></li>
    <li>Average ease factor: <strong>${stats.avgEase}</strong></li>
  `;
}

// ---------------------------------------------------------------------------
// Settings
// ---------------------------------------------------------------------------

const DEFAULT_SETTINGS = {
  practiceDelay: 500,
  autoRating: true,
  boardTheme: 'brown',
  pieceSet: 'cburnett',
};

async function loadSettings() {
  const settings = {};
  for (const [key, defaultVal] of Object.entries(DEFAULT_SETTINGS)) {
    const record = await db.get('settings', key);
    settings[key] = record ? record.value : defaultVal;
  }
  return settings;
}

async function saveSetting(key, value) {
  await db.put('settings', { key, value });
}

function renderSettings(settings) {
  const el = containerEl?.querySelector('#manage-settings');
  if (!el) return;

  el.innerHTML = `
    <label>
      Auto-play delay (ms):
      <input type="number" id="setting-delay" min="100" max="2000" step="100" value="${settings.practiceDelay}" />
    </label>
    <label>
      <input type="checkbox" id="setting-auto-rating" ${settings.autoRating ? 'checked' : ''} />
      Auto quality rating
    </label>
    <label>
      Board theme:
      <select id="setting-theme">
        <option value="brown" ${settings.boardTheme === 'brown' ? 'selected' : ''}>Brown</option>
        <option value="blue" ${settings.boardTheme === 'blue' ? 'selected' : ''}>Blue</option>
        <option value="green" ${settings.boardTheme === 'green' ? 'selected' : ''}>Green</option>
      </select>
    </label>
    <label>
      Piece set:
      <select id="setting-pieces">
        <option value="cburnett" ${settings.pieceSet === 'cburnett' ? 'selected' : ''}>CBurnett</option>
        <option value="merida" ${settings.pieceSet === 'merida' ? 'selected' : ''}>Merida</option>
        <option value="alpha" ${settings.pieceSet === 'alpha' ? 'selected' : ''}>Alpha</option>
      </select>
    </label>
  `;

  // Bind change handlers
  el.querySelector('#setting-delay').addEventListener('change', async (e) => {
    await saveSetting('practiceDelay', parseInt(e.target.value, 10));
    setStatus('Setting saved.');
  });

  el.querySelector('#setting-auto-rating').addEventListener('change', async (e) => {
    await saveSetting('autoRating', e.target.checked);
    setStatus('Setting saved.');
  });

  el.querySelector('#setting-theme').addEventListener('change', async (e) => {
    await saveSetting('boardTheme', e.target.value);
    setStatus('Setting saved.');
  });

  el.querySelector('#setting-pieces').addEventListener('change', async (e) => {
    await saveSetting('pieceSet', e.target.value);
    setStatus('Setting saved.');
  });
}

// ---------------------------------------------------------------------------
// Export
// ---------------------------------------------------------------------------

async function handleExport() {
  const [nodes, edges, lines, settings] = await Promise.all([
    db.getAll('nodes'),
    db.getAll('edges'),
    db.getAll('lines'),
    db.getAll('settings'),
  ]);

  const names = await db.getAll('names');

  const data = {
    version: 1,
    exportedAt: new Date().toISOString(),
    data: { nodes, edges, lines, settings, names },
  };

  const blob = new Blob([JSON.stringify(data, null, 2)], { type: 'application/json' });
  const url = URL.createObjectURL(blob);

  const dateStr = new Date().toISOString().split('T')[0];
  const a = document.createElement('a');
  a.href = url;
  a.download = `chess-trainer-backup-${dateStr}.json`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);

  setStatus('Export complete.');
}

// ---------------------------------------------------------------------------
// Import
// ---------------------------------------------------------------------------

function validateImport(data) {
  const errors = [];

  if (!data || typeof data !== 'object') {
    errors.push('Invalid JSON structure.');
    return errors;
  }

  if (data.version !== 1) {
    errors.push(`Unsupported version: ${data.version}. Expected 1.`);
  }

  if (!data.data || typeof data.data !== 'object') {
    errors.push('Missing "data" field.');
    return errors;
  }

  const { nodes, edges, lines } = data.data;

  if (!Array.isArray(nodes)) errors.push('"data.nodes" must be an array.');
  if (!Array.isArray(edges)) errors.push('"data.edges" must be an array.');
  if (!Array.isArray(lines)) errors.push('"data.lines" must be an array.');

  if (errors.length > 0) return errors;

  // Validate nodes
  for (let i = 0; i < nodes.length; i++) {
    if (!nodes[i].fen) errors.push(`Node ${i}: missing fen.`);
    else {
      const parts = nodes[i].fen.split(' ');
      if (parts.length < 4) errors.push(`Node ${i}: malformed FEN "${nodes[i].fen}".`);
    }
  }

  // Validate edges
  for (let i = 0; i < edges.length; i++) {
    if (!edges[i].parentFen) errors.push(`Edge ${i}: missing parentFen.`);
    if (!edges[i].childFen) errors.push(`Edge ${i}: missing childFen.`);
    if (!edges[i].moveSan) errors.push(`Edge ${i}: missing moveSan.`);
  }

  // Validate lines
  for (let i = 0; i < lines.length; i++) {
    if (!Array.isArray(lines[i].fens)) errors.push(`Line ${i}: missing fens array.`);
    if (!Array.isArray(lines[i].moves)) errors.push(`Line ${i}: missing moves array.`);
    if (lines[i].fens && lines[i].moves && lines[i].fens.length !== lines[i].moves.length + 1) {
      errors.push(`Line ${i}: fens.length (${lines[i].fens.length}) should be moves.length + 1 (${lines[i].moves.length + 1}).`);
    }
  }

  return errors;
}

async function handleImport(mode) {
  const fileInput = containerEl?.querySelector('#import-file');
  if (!fileInput || !fileInput.files || fileInput.files.length === 0) {
    setStatus('Please select a JSON file first.');
    return;
  }

  const file = fileInput.files[0];
  let parsed;

  try {
    const text = await file.text();
    parsed = JSON.parse(text);
  } catch (err) {
    setStatus(`Error parsing file: ${err.message}`);
    return;
  }

  const errors = validateImport(parsed);
  if (errors.length > 0) {
    setStatus(`Validation errors:\n${errors.join('\n')}`);
    return;
  }

  const { nodes, edges, lines, settings, names } = parsed.data;

  try {
    if (mode === 'replace') {
      await db.clearStore('nodes');
      await db.clearStore('edges');
      await db.clearStore('lines');
      await db.clearStore('settings');
      await db.clearStore('names');

      if (nodes) await db.bulkPut('nodes', nodes);
      if (edges) await db.bulkPut('edges', edges);
      if (lines) await db.bulkPut('lines', lines);
      if (settings) await db.bulkPut('settings', settings);
      if (names) await db.bulkPut('names', names);

      setStatus(`Import (Replace) complete: ${nodes.length} nodes, ${edges.length} edges, ${lines.length} lines.`);
    } else {
      // Merge mode
      let addedNodes = 0, addedEdges = 0, addedLines = 0;

      for (const node of nodes) {
        const existing = await db.get('nodes', node.fen);
        if (!existing) {
          await db.put('nodes', node);
          addedNodes++;
        }
      }

      for (const edge of edges) {
        // Check by parentFen + moveSan compound
        const existing = await db.getAllByIndex('edges', 'byParentMove', [edge.parentFen, edge.moveSan]);
        if (existing.length === 0) {
          // Remove id to get auto-generated
          const { id, ...edgeData } = edge;
          await db.add('edges', edgeData);
          addedEdges++;
        }
      }

      for (const line of lines) {
        // Match by (rootFen, leafFen, color)
        const allLines = await db.getAll('lines');
        const dup = allLines.find(
          (l) => l.rootFen === line.rootFen && l.leafFen === line.leafFen && l.color === line.color
        );
        if (!dup) {
          const { id, ...lineData } = line;
          await db.add('lines', lineData);
          addedLines++;
        }
      }

      setStatus(`Import (Merge) complete: ${addedNodes} new nodes, ${addedEdges} new edges, ${addedLines} new lines.`);
    }

    // Refresh stats
    const stats = await loadStats();
    renderStats(stats);
  } catch (err) {
    setStatus(`Import error: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Clear All
// ---------------------------------------------------------------------------

async function handleClearAll() {
  const input = prompt('Type DELETE to confirm clearing all data:');
  if (input !== 'DELETE') {
    setStatus('Clear cancelled.');
    return;
  }

  await db.clearStore('nodes');
  await db.clearStore('edges');
  await db.clearStore('lines');
  await db.clearStore('settings');
  await db.clearStore('names');

  setStatus('All data cleared.');

  const stats = await loadStats();
  renderStats(stats);
}

// ---------------------------------------------------------------------------
// Status
// ---------------------------------------------------------------------------

function setStatus(text) {
  const el = containerEl?.querySelector('#manage-status');
  if (el) el.textContent = text;
}

// ---------------------------------------------------------------------------
// Mount / Unmount
// ---------------------------------------------------------------------------

export default {
  async mount(container) {
    containerEl = container;

    container.innerHTML = `
      <div class="manage-page">
        <div class="manage-section">
          <h2>Data Management</h2>
          <div class="manage-actions">
            <button id="btn-export" class="primary">Export JSON</button>
            <div>
              <input type="file" id="import-file" accept=".json" />
              <button id="btn-import-merge" class="btn-blue">Import (Merge)</button>
              <button id="btn-import-replace" class="btn-amber">Import (Replace)</button>
            </div>
            <button id="btn-clear-all" class="danger">Clear All</button>
          </div>
          <div id="manage-status" class="manage-status"></div>
        </div>

        <div class="manage-section">
          <h2>Statistics</h2>
          <ul id="manage-stats" class="manage-stats"></ul>
        </div>

        <div class="manage-section">
          <h2>Settings</h2>
          <div id="manage-settings" class="manage-settings"></div>
        </div>
      </div>
    `;

    // Event listeners
    container.querySelector('#btn-export').addEventListener('click', handleExport);
    container.querySelector('#btn-import-merge').addEventListener('click', () => handleImport('merge'));
    container.querySelector('#btn-import-replace').addEventListener('click', () => handleImport('replace'));
    container.querySelector('#btn-clear-all').addEventListener('click', handleClearAll);

    // Load initial data
    const stats = await loadStats();
    renderStats(stats);

    const settings = await loadSettings();
    renderSettings(settings);
  },

  unmount() {
    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl = null;
    }
  },

  // Test helpers
  _getStatus() {
    return containerEl?.querySelector('#manage-status')?.textContent || '';
  },

  _setStatus: setStatus,

  async _loadStats() {
    return loadStats();
  },

  _validateImport: validateImport,

  async _handleExport() {
    return handleExport();
  },

  async _handleImport(mode) {
    return handleImport(mode);
  },

  async _handleClearAll() {
    return handleClearAll();
  },
};
