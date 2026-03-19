// browse.js — Browse Page module (ES module)
//
// Explore the repertoire as an expandable tree. Select nodes
// to view position details, edit names/notes, and manage subtrees.

import * as dag from '../dag.js';
import * as db from '../db.js';
import { normalizeFen } from '../fen.js';
import { createBoard } from '../board.js';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** @type {HTMLElement|null} Page container */
let containerEl = null;

/** @type {Object|null} Mini-board instance */
let miniBoard = null;

/** @type {string|null} Currently selected FEN */
let selectedFen = null;

/** @type {Set<string>} Expanded tree node FENs */
let expandedNodes = new Set();

/** @type {string} Search filter text */
let searchFilter = '';

/** @type {Function|null} Navigate callback (for Practice Subtree) */
let navigateFn = null;

// ---------------------------------------------------------------------------
// Move numbering helper
// ---------------------------------------------------------------------------

/**
 * Compute the move label for a given tree depth.
 * depth 1 = move 1 (white), depth 2 = move 1 (black), depth 3 = move 2 (white), etc.
 *
 * @param {number} depth — 1-based depth from root
 * @param {string} moveSan — SAN notation
 * @returns {string}
 */
function moveLabel(depth, moveSan) {
  const moveNum = Math.ceil(depth / 2);
  const isWhite = depth % 2 === 1;
  if (isWhite) {
    return `${moveNum}. ${moveSan}`;
  } else {
    return `${moveNum}...${moveSan}`;
  }
}

// ---------------------------------------------------------------------------
// Tree Rendering
// ---------------------------------------------------------------------------

/**
 * Build tree HTML for a node and its expanded children (recursive).
 */
async function renderTreeNode(fen, depth, matchingFens) {
  const node = await db.get('nodes', fen);
  const children = await dag.getChildren(fen);
  const hasChildren = children.length > 0;
  const isExpanded = expandedNodes.has(fen);

  // If search filter is active, skip non-matching subtrees
  if (matchingFens && !matchingFens.has(fen)) {
    // Check if any descendant matches
    let hasMatchingDesc = false;
    if (hasChildren) {
      for (const child of children) {
        if (matchingFens.has(child.childFen)) {
          hasMatchingDesc = true;
          break;
        }
      }
    }
    if (!hasMatchingDesc) return '';
  }

  // For root node, get the parent edge to show the arriving move
  let parentEdge = null;
  if (depth > 0) {
    const incoming = await db.getAllByIndex('edges', 'byChild', fen);
    if (incoming.length > 0) {
      parentEdge = incoming.reduce((earliest, e) =>
        e.createdAt < earliest.createdAt ? e : earliest
      );
    }
  }

  const nodeName = node?.name || '';
  const nameDisplay = nodeName ? ` <span class="node-name">"${nodeName}"</span>` : '';

  let label;
  if (depth === 0) {
    label = 'Start Position';
  } else if (parentEdge) {
    const colorClass = parentEdge.color === 'white' ? 'move-white' : 'move-black';
    label = `<span class="${colorClass}">${moveLabel(depth, parentEdge.moveSan)}</span>${nameDisplay}`;
  } else {
    label = fen.substring(0, 20) + '...';
  }

  const toggleIcon = hasChildren ? (isExpanded ? '▼' : '►') : '&nbsp;&nbsp;';
  const selectedClass = selectedFen === fen ? 'selected' : '';

  let html = `<div class="tree-node ${selectedClass}" data-fen="${fen}" data-depth="${depth}">`;
  html += `<span class="tree-toggle" data-fen="${fen}">${toggleIcon}</span> `;
  html += `<span class="tree-label" data-fen="${fen}">${label}</span>`;
  html += `</div>`;

  // Render children if expanded
  if (isExpanded && hasChildren) {
    html += `<div class="tree-children" data-parent="${fen}">`;
    for (const child of children) {
      html += await renderTreeNode(child.childFen, depth + 1, matchingFens);
    }
    html += '</div>';
  }

  return html;
}

/**
 * Full tree render from roots.
 */
async function renderTree() {
  const treeEl = containerEl?.querySelector('#browse-tree');
  if (!treeEl) return;

  const roots = await dag.getRoots();

  // If search filter, find matching FENs
  let matchingFens = null;
  if (searchFilter.trim()) {
    matchingFens = new Set();
    const allNodes = await db.getAll('nodes');
    const lowerFilter = searchFilter.toLowerCase();
    for (const node of allNodes) {
      if (node.name && node.name.toLowerCase().includes(lowerFilter)) {
        matchingFens.add(node.fen);
        // Add ancestors to matching set
        let current = node.fen;
        // eslint-disable-next-line no-constant-condition
        while (true) {
          const incoming = await db.getAllByIndex('edges', 'byChild', current);
          if (incoming.length === 0) break;
          const parentEdge = incoming.reduce((earliest, e) =>
            e.createdAt < earliest.createdAt ? e : earliest
          );
          matchingFens.add(parentEdge.parentFen);
          expandedNodes.add(parentEdge.parentFen);
          current = parentEdge.parentFen;
        }
      }
    }
    if (matchingFens.size === 0) {
      treeEl.innerHTML = '<div class="tree-empty">No matching positions found.</div>';
      return;
    }
  }

  if (roots.length === 0) {
    treeEl.innerHTML = '<div class="tree-empty">No repertoire data yet. Add lines on the Study page.</div>';
    return;
  }

  let html = '';
  for (const root of roots) {
    html += await renderTreeNode(root.fen, 0, matchingFens);
  }

  treeEl.innerHTML = html;

  // Attach event listeners
  treeEl.querySelectorAll('.tree-toggle').forEach((el) => {
    el.addEventListener('click', async (e) => {
      e.stopPropagation();
      const fen = el.dataset.fen;
      if (expandedNodes.has(fen)) {
        expandedNodes.delete(fen);
      } else {
        expandedNodes.add(fen);
      }
      await renderTree();
    });
  });

  treeEl.querySelectorAll('.tree-label').forEach((el) => {
    el.addEventListener('click', async () => {
      const fen = el.dataset.fen;
      await selectNode(fen);
    });
  });
}

// ---------------------------------------------------------------------------
// Position Detail (Right Panel)
// ---------------------------------------------------------------------------

async function selectNode(fen) {
  selectedFen = fen;

  const detailEl = containerEl?.querySelector('#browse-detail');
  if (!detailEl) return;

  const node = await db.get('nodes', fen);
  const children = await dag.getChildren(fen);
  const linesThrough = await dag.getLinesBySubtree(fen);
  const fullName = await dag.getFullName(fen);

  // Get arriving move reason
  let arrivingReason = '';
  const incomingEdges = await db.getAllByIndex('edges', 'byChild', fen);
  if (incomingEdges.length > 0) {
    const primaryEdge = incomingEdges.reduce((earliest, e) =>
      e.createdAt < earliest.createdAt ? e : earliest
    );
    // Get first reason value from reasons map
    if (primaryEdge.reasons) {
      const reasonValues = Object.values(primaryEdge.reasons);
      arrivingReason = reasonValues.length > 0 ? reasonValues[0] : '';
    }
  }

  detailEl.innerHTML = `
    <div class="detail-board-container" id="detail-board"></div>
    <div class="detail-fields">
      <label>Name:</label>
      <input type="text" id="detail-name" value="${(node?.name || '').replace(/"/g, '&quot;')}" placeholder="Name this position..." />

      <label>Full Path:</label>
      <div id="detail-full-name" class="detail-full-name">${fullName || '(unnamed path)'}</div>

      <label>Notes:</label>
      <textarea id="detail-notes" rows="3" placeholder="Add notes...">${node?.notes || ''}</textarea>

      <label>Arriving Move Reason:</label>
      <div id="detail-reason" class="detail-reason">${arrivingReason || '(none)'}</div>

      <div class="detail-stats">
        <span>Lines through here: <strong id="detail-line-count">${linesThrough.length}</strong></span>
        <span>Children: <strong id="detail-child-count">${children.length}</strong></span>
      </div>

      <div class="detail-actions">
        <button id="btn-study-from-here">Study from Here</button>
        <button id="btn-practice-subtree">Practice Subtree</button>
        <button id="btn-delete-subtree" class="danger">Delete Subtree</button>
      </div>
    </div>
  `;

  // Create mini-board (read-only)
  const boardEl = detailEl.querySelector('#detail-board');
  if (miniBoard) {
    miniBoard.destroy();
    miniBoard = null;
  }
  miniBoard = createBoard(boardEl, {
    fen,
    movableColor: undefined, // non-interactive
  });
  miniBoard.setInteractive(false);

  // Name field
  const nameInput = detailEl.querySelector('#detail-name');
  nameInput.addEventListener('blur', async () => {
    const newName = nameInput.value.trim();
    if (node) {
      node.name = newName || null;
      await db.put('nodes', node);
      await renderTree();
    }
  });
  nameInput.addEventListener('keydown', async (e) => {
    if (e.key === 'Enter') {
      nameInput.blur();
    }
  });

  // Notes field
  const notesEl = detailEl.querySelector('#detail-notes');
  notesEl.addEventListener('blur', async () => {
    if (node) {
      node.notes = notesEl.value;
      await db.put('nodes', node);
    }
  });

  // Study from Here
  detailEl.querySelector('#btn-study-from-here').addEventListener('click', () => {
    if (navigateFn) {
      navigateFn(`#/study?fen=${encodeURIComponent(fen)}`);
    } else {
      window.location.hash = `#/study?fen=${encodeURIComponent(fen)}`;
    }
  });

  // Practice Subtree
  detailEl.querySelector('#btn-practice-subtree').addEventListener('click', () => {
    if (navigateFn) {
      navigateFn(`#/practice?fen=${encodeURIComponent(fen)}`);
    } else {
      window.location.hash = `#/practice?fen=${encodeURIComponent(fen)}`;
    }
  });

  // Delete Subtree
  detailEl.querySelector('#btn-delete-subtree').addEventListener('click', async () => {
    const nodeName = node?.name || fen.substring(0, 30);
    const confirmed = confirm(`Delete all positions and lines under "${nodeName}"? This cannot be undone.`);
    if (!confirmed) return;

    await dag.deleteSubtree(fen);
    selectedFen = null;
    detailEl.innerHTML = '<div class="detail-empty">Node deleted. Select another position.</div>';
    if (miniBoard) {
      miniBoard.destroy();
      miniBoard = null;
    }
    await renderTree();
  });

  // Re-render tree to highlight selected node
  await renderTree();
}

// ---------------------------------------------------------------------------
// Search
// ---------------------------------------------------------------------------

function handleSearch(e) {
  searchFilter = e.target.value;
  renderTree();
}

// ---------------------------------------------------------------------------
// Mount / Unmount
// ---------------------------------------------------------------------------

export default {
  /**
   * Mount the browse page into a container.
   * @param {HTMLElement} container
   * @param {Object} [params={}]
   * @param {Function} [params.navigate] — optional navigation callback
   */
  async mount(container, params = {}) {
    containerEl = container;
    navigateFn = params.navigate || null;
    selectedFen = null;
    expandedNodes = new Set();
    searchFilter = '';

    container.innerHTML = `
      <div class="browse-page">
        <div class="browse-body">
          <div class="browse-tree-panel">
            <div class="browse-search">
              <input type="text" id="browse-search-input" placeholder="Search by name..." />
            </div>
            <div id="browse-tree" class="browse-tree"></div>
          </div>
          <div class="browse-detail-panel" id="browse-detail">
            <div class="detail-empty">Select a position from the tree.</div>
          </div>
        </div>
      </div>
    `;

    // Search
    container.querySelector('#browse-search-input').addEventListener('input', handleSearch);

    // Initial tree render
    await renderTree();
  },

  /**
   * Unmount the browse page.
   */
  unmount() {
    if (miniBoard) {
      miniBoard.destroy();
      miniBoard = null;
    }
    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl = null;
    }
    selectedFen = null;
    expandedNodes = new Set();
    searchFilter = '';
    navigateFn = null;
  },

  // Expose for testing
  _getState() {
    return {
      selectedFen,
      expandedNodes: new Set(expandedNodes),
      searchFilter,
      miniBoard,
    };
  },

  async _selectNode(fen) {
    await selectNode(fen);
  },

  async _toggleNode(fen) {
    if (expandedNodes.has(fen)) {
      expandedNodes.delete(fen);
    } else {
      expandedNodes.add(fen);
    }
    await renderTree();
  },

  async _renderTree() {
    await renderTree();
  },

  _setSearch(text) {
    searchFilter = text;
    return renderTree();
  },
};
