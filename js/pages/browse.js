// browse.js — Browse Page module (ES module)
//
// Horizontal tree-map view of the repertoire.
// Always-expanded, pannable/zoomable, click to inspect nodes.

import * as dag from '../dag.js';
import * as db from '../db.js';
import { normalizeFen } from '../fen.js';
import { createBoard } from '../board.js';
import { getSessionColor } from '../utils.js';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} Page container */
let containerEl = null;

/** @type {Object|null} Mini-board instance */
let miniBoard = null;

/** @type {string|null} Currently selected FEN */
let selectedFen = null;

/** @type {string} Search filter text */
let searchFilter = '';

/** @type {string} Tag filter (empty string = all) */
let tagFilter = '';

/** @type {Function|null} Navigate callback */
let navigateFn = null;

// Pan/zoom state
let scale = 1;
let panX = 20;
let panY = 0;
let isPanning = false;
let panStartX = 0;
let panStartY = 0;
let panStartPanX = 0;
let panStartPanY = 0;

// Layout constants
const NODE_W = 80;
const NODE_H = 30;
const H_GAP = 40;
const V_GAP = 6;

// ---------------------------------------------------------------------------
// Move numbering helper
// ---------------------------------------------------------------------------

function moveLabel(depth, moveSan) {
  const moveNum = Math.ceil(depth / 2);
  const isWhite = depth % 2 === 1;
  if (isWhite) return `${moveNum}.${moveSan}`;
  return `${moveNum}...${moveSan}`;
}

// ---------------------------------------------------------------------------
// Build tree data structure (always fully expanded)
// ---------------------------------------------------------------------------

async function buildTreeData(fen, depth, visited) {
  if (visited.has(fen)) return null; // prevent cycles
  visited.add(fen);

  const node = await db.get('nodes', fen);
  const children = await dag.getChildren(fen);

  let parentEdge = null;
  if (depth > 0) {
    const incoming = await db.getAllByIndex('edges', 'byChild', fen);
    if (incoming.length > 0) {
      parentEdge = incoming.reduce((e, c) => (c.createdAt < e.createdAt ? c : e));
    }
  }

  let label;
  if (depth === 0) {
    label = 'Start';
  } else if (parentEdge) {
    label = moveLabel(depth, parentEdge.moveSan);
  } else {
    label = '?';
  }

  const color = parentEdge?.color || null;
  const name = node?.name || '';

  const childNodes = [];
  for (const edge of children) {
    const child = await buildTreeData(edge.childFen, depth + 1, visited);
    if (child) childNodes.push(child);
  }

  return { fen, label, name, color, depth, children: childNodes };
}

// ---------------------------------------------------------------------------
// Layout algorithm — assign (x, y) to each node
// ---------------------------------------------------------------------------

function layoutTree(node, x, yRef) {
  if (node.children.length === 0) {
    node.x = x;
    node.y = yRef.current;
    node.w = NODE_W;
    node.h = NODE_H;
    yRef.current += NODE_H + V_GAP;
    return;
  }

  const childX = x + NODE_W + H_GAP;
  const firstChildY = yRef.current;

  for (const child of node.children) {
    layoutTree(child, childX, yRef);
  }

  const lastChild = node.children[node.children.length - 1];
  const childTop = node.children[0].y;
  const childBottom = lastChild.y + lastChild.h;

  node.x = x;
  node.y = childTop + (childBottom - childTop) / 2 - NODE_H / 2;
  node.w = NODE_W;
  node.h = NODE_H;
}

// ---------------------------------------------------------------------------
// Search — collect matching FENs + ancestors
// ---------------------------------------------------------------------------

async function getMatchingFens(filter) {
  if (!filter.trim()) return null;
  const matching = new Set();
  const allNodes = await db.getAll('nodes');
  const lower = filter.toLowerCase();
  for (const n of allNodes) {
    if (n.name && n.name.toLowerCase().includes(lower)) {
      matching.add(n.fen);
      let cur = n.fen;
      for (;;) {
        const inc = await db.getAllByIndex('edges', 'byChild', cur);
        if (inc.length === 0) break;
        const pe = inc.reduce((a, b) => (b.createdAt < a.createdAt ? b : a));
        matching.add(pe.parentFen);
        cur = pe.parentFen;
      }
    }
  }
  return matching.size > 0 ? matching : null;
}

function filterTree(node, matchingFens) {
  if (!matchingFens) return node;
  const filteredChildren = [];
  for (const child of node.children) {
    const fc = filterTree(child, matchingFens);
    if (fc) filteredChildren.push(fc);
  }
  if (matchingFens.has(node.fen) || filteredChildren.length > 0) {
    return { ...node, children: filteredChildren };
  }
  return null;
}

async function getTagMatchingFens(tag) {
  if (!tag) return null;
  const matching = new Set();
  const allLines = await db.getAll('lines');
  for (const line of allLines) {
    if (Array.isArray(line.tags) && line.tags.includes(tag)) {
      if (Array.isArray(line.fens)) {
        for (const f of line.fens) matching.add(f);
      }
    }
  }
  return matching.size > 0 ? matching : null;
}

// ---------------------------------------------------------------------------
// Render tree as HTML nodes + SVG connectors
// ---------------------------------------------------------------------------

function collectNodes(node, list) {
  list.push(node);
  for (const c of node.children) collectNodes(c, list);
}

function collectEdges(node, list) {
  for (const c of node.children) {
    list.push({ parent: node, child: c });
    collectEdges(c, list);
  }
}

function renderTreeMap(roots) {
  const allNodes = [];
  const allEdges = [];
  for (const root of roots) {
    collectNodes(root, allNodes);
    collectEdges(root, allEdges);
  }

  // Compute bounding box
  let maxX = 0, maxY = 0;
  for (const n of allNodes) {
    if (n.x + n.w > maxX) maxX = n.x + n.w;
    if (n.y + n.h > maxY) maxY = n.y + n.h;
  }
  const svgW = maxX + 40;
  const svgH = maxY + 40;

  // Build SVG for connector lines
  let svg = `<svg class="tree-svg" width="${svgW}" height="${svgH}" viewBox="0 0 ${svgW} ${svgH}">`;
  for (const { parent, child } of allEdges) {
    const x1 = parent.x + parent.w;
    const y1 = parent.y + parent.h / 2;
    const x2 = child.x;
    const y2 = child.y + child.h / 2;
    const mx = x1 + (x2 - x1) * 0.5;
    svg += `<path d="M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}" />`;
  }
  svg += '</svg>';

  // Build node elements
  let html = svg;
  for (const n of allNodes) {
    const isSelected = n.fen === selectedFen;
    const isMatch = searchFilter && n.name?.toLowerCase().includes(searchFilter.toLowerCase());
    const isWhite = n.color === 'white';
    const isBlack = n.color === 'black';

    let cls = 'tree-pill';
    if (isSelected) cls += ' selected';
    if (isMatch) cls += ' search-match';
    if (n.depth === 0) cls += ' root-node';
    else if (isWhite) cls += ' white-move';
    else if (isBlack) cls += ' black-move';

    const nameBadge = n.name ? `<span class="pill-name" title="${n.name}">${n.name}</span>` : '';
    const childCount = n.children.length;
    const badge = childCount > 1 ? `<span class="pill-branch">${childCount}</span>` : '';

    html += `<div class="${cls}" data-fen="${n.fen}" style="left:${n.x}px;top:${n.y}px;width:${n.w}px;height:${n.h}px;">`;
    html += `<span class="pill-label">${n.label}</span>`;
    html += badge;
    html += nameBadge;
    html += '</div>';
  }

  return { html, svgW, svgH };
}

// ---------------------------------------------------------------------------
// Full tree render
// ---------------------------------------------------------------------------

async function renderTree() {
  const treeEl = containerEl?.querySelector('#browse-tree');
  if (!treeEl) return;

  const roots = await dag.getRoots();

  if (roots.length === 0) {
    treeEl.innerHTML = '<div class="tree-empty">No repertoire data yet. Add lines on the Study page.</div>';
    return;
  }

  // Build all trees
  const trees = [];
  for (const root of roots) {
    const tree = await buildTreeData(root.fen, 0, new Set());
    if (tree) trees.push(tree);
  }

  // Apply tag filter
  let filteredTrees = trees;
  const tagMatchingFens = await getTagMatchingFens(tagFilter);
  if (tagMatchingFens) {
    filteredTrees = filteredTrees.map(t => filterTree(t, tagMatchingFens)).filter(Boolean);
    if (filteredTrees.length === 0) {
      treeEl.innerHTML = '<div class="tree-empty">No lines match the selected tag.</div>';
      return;
    }
  }

  // Apply search filter
  const matchingFens = await getMatchingFens(searchFilter);
  if (matchingFens) {
    filteredTrees = filteredTrees.map(t => filterTree(t, matchingFens)).filter(Boolean);
    if (filteredTrees.length === 0) {
      treeEl.innerHTML = '<div class="tree-empty">No matching positions found.</div>';
      return;
    }
  }

  // Layout each tree (stack them vertically)
  const yRef = { current: 10 };
  for (const tree of filteredTrees) {
    layoutTree(tree, 10, yRef);
    yRef.current += 20; // gap between separate roots
  }

  // Render
  const { html, svgW, svgH } = renderTreeMap(filteredTrees);

  const canvas = treeEl.querySelector('.tree-canvas');
  if (canvas) {
    canvas.style.width = `${svgW}px`;
    canvas.style.height = `${svgH}px`;
    canvas.innerHTML = html;
  } else {
    treeEl.innerHTML = `<div class="tree-canvas" style="width:${svgW}px;height:${svgH}px;">${html}</div>`;
  }

  applyTransform();

  // Event: click node
  treeEl.querySelectorAll('.tree-pill').forEach(el => {
    el.addEventListener('click', async () => {
      await selectNode(el.dataset.fen);
    });
  });
}

// ---------------------------------------------------------------------------
// Pan / zoom
// ---------------------------------------------------------------------------

function applyTransform() {
  const canvas = containerEl?.querySelector('.tree-canvas');
  if (canvas) {
    canvas.style.transform = `translate(${panX}px, ${panY}px) scale(${scale})`;
  }
}

function handleWheel(e) {
  e.preventDefault();
  const delta = e.deltaY > 0 ? -0.08 : 0.08;
  scale = Math.max(0.2, Math.min(3, scale + delta));
  // Update zoom display
  const zoomLabel = containerEl?.querySelector('#zoom-level');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  applyTransform();
}

function handleMouseDown(e) {
  // Only pan with middle button or when clicking on the background
  if (e.target.closest('.tree-pill')) return;
  isPanning = true;
  panStartX = e.clientX;
  panStartY = e.clientY;
  panStartPanX = panX;
  panStartPanY = panY;
  e.currentTarget.style.cursor = 'grabbing';
}

function handleMouseMove(e) {
  if (!isPanning) return;
  panX = panStartPanX + (e.clientX - panStartX);
  panY = panStartPanY + (e.clientY - panStartY);
  applyTransform();
}

function handleMouseUp(e) {
  isPanning = false;
  if (e.currentTarget) e.currentTarget.style.cursor = 'grab';
}

function zoomIn() {
  scale = Math.min(3, scale + 0.15);
  const zoomLabel = containerEl?.querySelector('#zoom-level');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  applyTransform();
}

function zoomOut() {
  scale = Math.max(0.2, scale - 0.15);
  const zoomLabel = containerEl?.querySelector('#zoom-level');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  applyTransform();
}

function zoomFit() {
  const treeEl = containerEl?.querySelector('#browse-tree');
  const canvas = containerEl?.querySelector('.tree-canvas');
  if (!treeEl || !canvas) return;

  const treeRect = treeEl.getBoundingClientRect();
  const cw = parseFloat(canvas.style.width) || 800;
  const ch = parseFloat(canvas.style.height) || 600;

  const scaleX = (treeRect.width - 20) / cw;
  const scaleY = (treeRect.height - 20) / ch;
  scale = Math.min(scaleX, scaleY, 1.5);
  scale = Math.max(0.2, scale);

  panX = 10;
  panY = Math.max(10, (treeRect.height - ch * scale) / 2);

  const zoomLabel = containerEl?.querySelector('#zoom-level');
  if (zoomLabel) zoomLabel.textContent = `${Math.round(scale * 100)}%`;
  applyTransform();
}

// ---------------------------------------------------------------------------
// Position Detail (slide-in panel)
// ---------------------------------------------------------------------------

async function selectNode(fen) {
  selectedFen = fen;

  const detailEl = containerEl?.querySelector('#browse-detail');
  if (!detailEl) return;

  const node = await db.get('nodes', fen);
  const children = await dag.getChildren(fen);
  const linesThrough = await dag.getLinesBySubtree(fen);
  const fullName = await dag.getFullName(fen);

  let arrivingReason = '';
  let arrivingEdge = null;
  let arrivingReasonKey = null;
  const incomingEdges = await db.getAllByIndex('edges', 'byChild', fen);
  if (incomingEdges.length > 0) {
    arrivingEdge = incomingEdges.reduce((e, c) =>
      c.createdAt < e.createdAt ? c : e
    );
    if (arrivingEdge.reasons) {
      const entries = Object.entries(arrivingEdge.reasons);
      if (entries.length > 0) {
        arrivingReasonKey = entries[0][0];
        arrivingReason = entries[0][1];
      }
    }
  }

  // Collect all unique tags from subtree lines
  const subtreeTagSet = new Set();
  for (const line of linesThrough) {
    if (Array.isArray(line.tags)) {
      for (const t of line.tags) subtreeTagSet.add(t);
    }
  }
  const subtreeTags = [...subtreeTagSet].sort();

  // Collect all existing tags for the datalist
  const allLines = await db.getAll('lines');
  const allTagSet = new Set();
  for (const line of allLines) {
    if (Array.isArray(line.tags)) {
      for (const t of line.tags) allTagSet.add(t);
    }
  }

  detailEl.innerHTML = `
    <button id="btn-close-detail" class="detail-close" title="Close">&times;</button>
    <div class="detail-board-container" id="detail-board"></div>
    <button id="btn-flip-board" class="btn-flip-board" title="Flip board">&#x21C5; Flip</button>
    <div class="detail-fields">
      <label>Name:</label>
      <input type="text" id="detail-name" value="${(node?.name || '').replace(/"/g, '&quot;')}" placeholder="Name this position..." />

      <label>Full Path:</label>
      <div id="detail-full-name" class="detail-full-name">${fullName || '(unnamed path)'}</div>

      <label>Notes:</label>
      <textarea id="detail-notes" rows="2" placeholder="Add notes...">${node?.notes || ''}</textarea>

      <label>Reason for this move:</label>
      <input type="text" id="detail-reason" value="${(arrivingReason || '').replace(/"/g, '&quot;')}" placeholder="${arrivingEdge ? 'Why this move?' : 'N/A (root position)'}" ${arrivingEdge ? '' : 'disabled'} />

      <div class="detail-stats">
        <span>Lines: <strong>${linesThrough.length}</strong></span>
        <span>Children: <strong>${children.length}</strong></span>
      </div>

      ${linesThrough.length > 0 ? `<div class="detail-color-section">
        <label>Subtree Color:</label>
        <div class="detail-color-toggle">
          <span class="color-summary">${(() => { const wc = linesThrough.filter(l => l.color === 'white').length; const bc = linesThrough.filter(l => l.color === 'black').length; if (wc && !bc) return '&#9812; White'; if (bc && !wc) return '&#9818; Black'; return `&#9812; ${wc} White, &#9818; ${bc} Black`; })()}</span>
          <button id="btn-set-color-white" class="btn-color-toggle${linesThrough.every(l => l.color === 'white') ? ' active' : ''}" title="Set all subtree lines to White">&#9812; White</button>
          <button id="btn-set-color-black" class="btn-color-toggle${linesThrough.every(l => l.color === 'black') ? ' active' : ''}" title="Set all subtree lines to Black">&#9818; Black</button>
        </div>
      </div>` : ''}

      <div class="detail-tag-section">
        <label>Subtree Tags:</label>
        <div class="tag-chips-container" id="detail-subtree-tags">
          ${subtreeTags.map(t => `<span class="tag-chip">${t}<button class="tag-chip-remove-subtree" data-tag="${t}" title="Remove from all subtree lines">&times;</button></span>`).join('')}
          ${subtreeTags.length === 0 ? '<span class="tag-none">No tags</span>' : ''}
        </div>
        <div class="detail-tag-add">
          <input type="text" id="detail-tag-input" list="detail-tag-list" placeholder="Add tag to subtree..." />
          <datalist id="detail-tag-list">${[...allTagSet].sort().map(t => `<option value="${t}">`).join('')}</datalist>
          <button id="btn-add-subtree-tag" class="btn-blue" title="Add tag to all lines in this subtree">+ Tag</button>
        </div>
      </div>

      <div class="detail-actions">
        <button id="btn-rename-position">Rename</button>
        <button id="btn-study-from-here" class="primary">Study from Here</button>
        <button id="btn-practice-subtree" class="btn-blue">Practice Subtree</button>
        <button id="btn-delete-subtree" class="danger">Delete Subtree</button>
      </div>
    </div>
  `;

  detailEl.classList.add('open');

  // Mini-board
  const boardEl = detailEl.querySelector('#detail-board');
  if (miniBoard) { miniBoard.destroy(); miniBoard = null; }
  miniBoard = createBoard(boardEl, { fen, movableColor: undefined });
  miniBoard.setInteractive(false);

  // Flip board
  let boardOrientation = getSessionColor();
  miniBoard.setOrientation(boardOrientation);
  detailEl.querySelector('#btn-flip-board').addEventListener('click', () => {
    boardOrientation = boardOrientation === 'white' ? 'black' : 'white';
    if (miniBoard) miniBoard.setOrientation(boardOrientation);
  });

  // Close
  detailEl.querySelector('#btn-close-detail').addEventListener('click', () => {
    detailEl.classList.remove('open');
    selectedFen = null;
    renderTree();
  });

  // Name
  const nameInput = detailEl.querySelector('#detail-name');
  nameInput.addEventListener('blur', async () => {
    if (node) {
      node.name = nameInput.value.trim() || null;
      await db.put('nodes', node);
      await renderTree();
    }
  });
  nameInput.addEventListener('keydown', e => { if (e.key === 'Enter') nameInput.blur(); });

  // Rename button
  detailEl.querySelector('#btn-rename-position').addEventListener('click', async () => {
    const currentName = node?.name || '';
    const newName = prompt('Enter new name for this position:', currentName);
    if (newName === null) return; // cancelled
    if (node) {
      node.name = newName.trim() || null;
      await db.put('nodes', node);
      nameInput.value = node.name || '';
      const fullNameEl = detailEl.querySelector('#detail-full-name');
      if (fullNameEl) {
        const updatedFullName = await dag.getFullName(fen);
        fullNameEl.textContent = updatedFullName || '(unnamed path)';
      }
      await renderTree();
    }
  });

  // Notes
  const notesEl = detailEl.querySelector('#detail-notes');
  notesEl.addEventListener('blur', async () => {
    if (node) { node.notes = notesEl.value; await db.put('nodes', node); }
  });

  // Reason
  const reasonInput = detailEl.querySelector('#detail-reason');
  if (arrivingEdge) {
    reasonInput.addEventListener('blur', async () => {
      const newReason = reasonInput.value.trim();
      if (!arrivingEdge.reasons) arrivingEdge.reasons = {};
      if (arrivingReasonKey) {
        arrivingEdge.reasons[arrivingReasonKey] = newReason;
      } else {
        // No existing key — use a generic key
        const keys = Object.keys(arrivingEdge.reasons);
        if (keys.length > 0) {
          arrivingEdge.reasons[keys[0]] = newReason;
        } else {
          arrivingEdge.reasons['_default'] = newReason;
        }
      }
      await db.put('edges', arrivingEdge);
    });
    reasonInput.addEventListener('keydown', e => { if (e.key === 'Enter') reasonInput.blur(); });
  }

  // Study from Here
  detailEl.querySelector('#btn-study-from-here').addEventListener('click', () => {
    const url = `#/study?fen=${encodeURIComponent(fen)}`;
    navigateFn ? navigateFn(url) : (window.location.hash = url);
  });

  // Practice Subtree
  detailEl.querySelector('#btn-practice-subtree').addEventListener('click', () => {
    const url = `#/practice?fen=${encodeURIComponent(fen)}`;
    navigateFn ? navigateFn(url) : (window.location.hash = url);
  });

  // Delete Subtree
  detailEl.querySelector('#btn-delete-subtree').addEventListener('click', async () => {
    const nodeName = node?.name || fen.substring(0, 30);
    const confirmed = confirm(`Delete all positions and lines under "${nodeName}"? This cannot be undone.`);
    if (!confirmed) return;
    await dag.deleteSubtree(fen);
    selectedFen = null;
    detailEl.classList.remove('open');
    detailEl.innerHTML = '';
    if (miniBoard) { miniBoard.destroy(); miniBoard = null; }
    await renderTree();
  });

  // --- Subtree Color change ---
  const setColorWhiteBtn = detailEl.querySelector('#btn-set-color-white');
  const setColorBlackBtn = detailEl.querySelector('#btn-set-color-black');
  if (setColorWhiteBtn) {
    setColorWhiteBtn.addEventListener('click', async () => {
      for (const line of linesThrough) {
        if (line.color !== 'white') {
          line.color = 'white';
          await db.put('lines', line);
        }
      }
      await selectNode(fen);
    });
  }
  if (setColorBlackBtn) {
    setColorBlackBtn.addEventListener('click', async () => {
      for (const line of linesThrough) {
        if (line.color !== 'black') {
          line.color = 'black';
          await db.put('lines', line);
        }
      }
      await selectNode(fen);
    });
  }

  // --- Subtree Tag management ---

  // Add tag to all subtree lines
  const addTagBtn = detailEl.querySelector('#btn-add-subtree-tag');
  const tagInput = detailEl.querySelector('#detail-tag-input');
  async function addSubtreeTag() {
    const tag = tagInput.value.trim();
    if (!tag) return;
    const subtreeLines = await dag.getLinesBySubtree(fen);
    for (const line of subtreeLines) {
      if (!Array.isArray(line.tags)) line.tags = [];
      if (!line.tags.includes(tag)) {
        line.tags.push(tag);
        await db.put('lines', line);
      }
    }
    tagInput.value = '';
    await selectNode(fen); // re-render detail panel
  }
  addTagBtn.addEventListener('click', addSubtreeTag);
  tagInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') { e.preventDefault(); addSubtreeTag(); }
  });

  // Remove tag from all subtree lines
  detailEl.querySelectorAll('.tag-chip-remove-subtree').forEach(btn => {
    btn.addEventListener('click', async () => {
      const tag = btn.dataset.tag;
      const subtreeLines = await dag.getLinesBySubtree(fen);
      for (const line of subtreeLines) {
        if (Array.isArray(line.tags)) {
          const idx = line.tags.indexOf(tag);
          if (idx !== -1) {
            line.tags.splice(idx, 1);
            await db.put('lines', line);
          }
        }
      }
      await selectNode(fen); // re-render detail panel
    });
  });

  // Highlight selected in tree
  await renderTree();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

let searchTimeout = null;
function handleSearch(e) {
  searchFilter = e.target.value;
  clearTimeout(searchTimeout);
  searchTimeout = setTimeout(() => renderTree(), 200);
}

// ---------------------------------------------------------------------------
// Mount / Unmount
// ---------------------------------------------------------------------------

export default {
  async mount(container, params = {}) {
    containerEl = container;
    navigateFn = params.navigate || null;
    selectedFen = null;
    searchFilter = '';
    scale = 1;
    panX = 20;
    panY = 0;

    // Collect all unique tags for filter dropdown
    const allLines = await db.getAll('lines');
    const allTagSet = new Set();
    for (const line of allLines) {
      if (Array.isArray(line.tags)) {
        for (const t of line.tags) allTagSet.add(t);
      }
    }
    const tagOptions = [...allTagSet].sort().map(t => `<option value="${t}">${t}</option>`).join('');

    container.innerHTML = `
      <div class="browse-page">
        <div class="browse-toolbar">
          <input type="text" id="browse-search-input" placeholder="Search by name..." />
          <select id="browse-tag-filter" title="Filter by tag">
            <option value="">All tags</option>
            ${tagOptions}
          </select>
          <div class="zoom-controls">
            <button id="btn-zoom-out" title="Zoom out">−</button>
            <span id="zoom-level">100%</span>
            <button id="btn-zoom-in" title="Zoom in">+</button>
            <button id="btn-zoom-fit" title="Fit to view">Fit</button>
          </div>
        </div>
        <div class="browse-body">
          <div id="browse-tree" class="browse-tree-map"></div>
          <div class="browse-detail-panel" id="browse-detail"></div>
        </div>
      </div>
    `;

    // Search
    container.querySelector('#browse-search-input').addEventListener('input', handleSearch);

    // Tag filter
    container.querySelector('#browse-tag-filter').addEventListener('change', (e) => {
      tagFilter = e.target.value;
      renderTree();
    });

    // Zoom controls
    container.querySelector('#btn-zoom-in').addEventListener('click', zoomIn);
    container.querySelector('#btn-zoom-out').addEventListener('click', zoomOut);
    container.querySelector('#btn-zoom-fit').addEventListener('click', zoomFit);

    // Pan/zoom on tree area
    const treeEl = container.querySelector('#browse-tree');
    treeEl.addEventListener('wheel', handleWheel, { passive: false });
    treeEl.addEventListener('mousedown', handleMouseDown);
    treeEl.addEventListener('mousemove', handleMouseMove);
    treeEl.addEventListener('mouseup', handleMouseUp);
    treeEl.addEventListener('mouseleave', handleMouseUp);

    await renderTree();

    // Auto-fit after initial render
    requestAnimationFrame(() => {
      zoomFit();

      // Auto-select node if fen param provided (after layout is settled)
      if (params.fen) {
        const targetFen = normalizeFen(decodeURIComponent(params.fen));
        selectNode(targetFen);
      }
    });
  },

  unmount() {
    if (miniBoard) { miniBoard.destroy(); miniBoard = null; }
    if (containerEl) { containerEl.innerHTML = ''; containerEl = null; }
    selectedFen = null;
    searchFilter = '';
    tagFilter = '';
    navigateFn = null;
  },

  // Test helpers
  _getState() {
    return { selectedFen, searchFilter, miniBoard, scale, panX, panY };
  },
  async _selectNode(fen) { await selectNode(fen); },
  async _renderTree() { await renderTree(); },
  _setSearch(text) { searchFilter = text; return renderTree(); },
  _setTagFilter(tag) { tagFilter = tag; return renderTree(); },
};
