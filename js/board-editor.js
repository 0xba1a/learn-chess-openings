// board-editor.js — Board Position Editor (ES module)
//
// Provides a UI for freely placing pieces on a board to create
// arbitrary positions (e.g., endgame positions).

import { Chessground } from '../lib/chessground.min.js';
import { Chess } from '../lib/chess.min.js';

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PIECE_TYPES = [
  { color: 'white', role: 'king' },
  { color: 'white', role: 'queen' },
  { color: 'white', role: 'rook' },
  { color: 'white', role: 'bishop' },
  { color: 'white', role: 'knight' },
  { color: 'white', role: 'pawn' },
  { color: 'black', role: 'king' },
  { color: 'black', role: 'queen' },
  { color: 'black', role: 'rook' },
  { color: 'black', role: 'bishop' },
  { color: 'black', role: 'knight' },
  { color: 'black', role: 'pawn' },
];

const ROLE_TO_FEN = {
  king: 'k', queen: 'q', rook: 'r', bishop: 'b', knight: 'n', pawn: 'p',
};

// ---------------------------------------------------------------------------
// FEN generation from chessground pieces map
// ---------------------------------------------------------------------------

function piecesToFenPlacement(piecesMap) {
  const board = Array.from({ length: 8 }, () => Array(8).fill(null));
  for (const [key, piece] of piecesMap) {
    const col = key.charCodeAt(0) - 97;
    const row = parseInt(key[1], 10) - 1;
    const ch = ROLE_TO_FEN[piece.role];
    board[row][col] = piece.color === 'white' ? ch.toUpperCase() : ch;
  }

  const ranks = [];
  for (let r = 7; r >= 0; r--) {
    let rank = '';
    let empty = 0;
    for (let c = 0; c < 8; c++) {
      if (board[r][c]) {
        if (empty > 0) { rank += empty; empty = 0; }
        rank += board[r][c];
      } else {
        empty++;
      }
    }
    if (empty > 0) rank += empty;
    ranks.push(rank);
  }

  return ranks.join('/');
}

// ---------------------------------------------------------------------------
// Position validation
// ---------------------------------------------------------------------------

function validatePosition(piecesMap) {
  let whiteKings = 0;
  let blackKings = 0;
  const errors = [];

  for (const [key, piece] of piecesMap) {
    if (piece.role === 'king') {
      if (piece.color === 'white') whiteKings++;
      else blackKings++;
    }
    if (piece.role === 'pawn') {
      const rank = parseInt(key[1], 10);
      if (rank === 1 || rank === 8) {
        errors.push(`Pawn on ${key} — pawns cannot be on rank 1 or 8.`);
      }
    }
  }

  if (whiteKings !== 1) errors.push(`Need exactly 1 white king (found ${whiteKings}).`);
  if (blackKings !== 1) errors.push(`Need exactly 1 black king (found ${blackKings}).`);

  return errors;
}

// ---------------------------------------------------------------------------
// Auto-adjust castling rights based on piece placement
// ---------------------------------------------------------------------------

function adjustCastlingRights(piecesMap, castling) {
  const adj = { ...castling };

  const wk = piecesMap.get('e1');
  if (!wk || wk.color !== 'white' || wk.role !== 'king') {
    adj.K = false;
    adj.Q = false;
  }
  const h1 = piecesMap.get('h1');
  if (!h1 || h1.color !== 'white' || h1.role !== 'rook') adj.K = false;
  const a1 = piecesMap.get('a1');
  if (!a1 || a1.color !== 'white' || a1.role !== 'rook') adj.Q = false;

  const bk = piecesMap.get('e8');
  if (!bk || bk.color !== 'black' || bk.role !== 'king') {
    adj.k = false;
    adj.q = false;
  }
  const h8 = piecesMap.get('h8');
  if (!h8 || h8.color !== 'black' || h8.role !== 'rook') adj.k = false;
  const a8 = piecesMap.get('a8');
  if (!a8 || a8.color !== 'black' || a8.role !== 'rook') adj.q = false;

  return adj;
}

// ---------------------------------------------------------------------------
// Square computation from click coordinates
// ---------------------------------------------------------------------------

function getSquareFromClick(e, cgBoard, orientation) {
  const rect = cgBoard.getBoundingClientRect();
  const x = e.clientX - rect.left;
  const y = e.clientY - rect.top;
  const squareSize = rect.width / 8;

  let col = Math.max(0, Math.min(7, Math.floor(x / squareSize)));
  let row = Math.max(0, Math.min(7, Math.floor(y / squareSize)));

  let fileIdx, rankIdx;
  if (orientation === 'white') {
    fileIdx = col;
    rankIdx = 7 - row;
  } else {
    fileIdx = 7 - col;
    rankIdx = row;
  }

  return String.fromCharCode(97 + fileIdx) + String(rankIdx + 1);
}

// ---------------------------------------------------------------------------
// createBoardEditor
// ---------------------------------------------------------------------------

/**
 * Create a board position editor for setting up arbitrary positions.
 *
 * @param {HTMLElement} containerEl — DOM element to mount the editor in
 * @param {Object} options
 * @param {string} [options.fen] — Initial FEN (null/undefined = empty board)
 * @param {string} [options.orientation='white'] — Board orientation
 * @param {Function} options.onDone — callback(fen) when position is confirmed
 * @param {Function} options.onCancel — callback() when cancelled
 * @returns {{ destroy: Function }}
 */
export function createBoardEditor(containerEl, options = {}) {
  let orientation = options.orientation || 'white';
  const onDone = options.onDone;
  const onCancel = options.onCancel;

  // Parse initial FEN settings
  const initialFen = options.fen || '8/8/8/8/8/8/8/8 w - - 0 1';
  const fenParts = initialFen.split(' ');
  let sideToMove = (fenParts.length >= 2) ? fenParts[1] : 'w';
  let castling = { K: false, Q: false, k: false, q: false };
  if (fenParts.length >= 3 && fenParts[2] !== '-') {
    castling.K = fenParts[2].includes('K');
    castling.Q = fenParts[2].includes('Q');
    castling.k = fenParts[2].includes('k');
    castling.q = fenParts[2].includes('q');
  }

  let selectedPiece = null; // { color, role } | 'eraser' | null

  // ── Build HTML ──────────────────────────────────────────────

  containerEl.innerHTML = `
    <div class="board-editor">
      <div class="editor-board-wrap">
        <div class="editor-board-container">
          <div class="board-container" id="editor-board"></div>
          <div class="editor-click-overlay" id="editor-overlay"></div>
        </div>
        <div class="editor-palette cg-wrap" id="editor-palette"></div>
      </div>
      <div class="editor-sidebar">
        <h3 class="editor-title">Position Editor</h3>
        <div class="editor-hint">Select a piece below, then click the board to place it. Drag existing pieces to rearrange.</div>
        <div class="editor-section">
          <label class="editor-label">Side to move:</label>
          <div class="editor-radio-group">
            <label><input type="radio" name="editor-side" value="w" ${sideToMove === 'w' ? 'checked' : ''}> White</label>
            <label><input type="radio" name="editor-side" value="b" ${sideToMove === 'b' ? 'checked' : ''}> Black</label>
          </div>
        </div>
        <div class="editor-section">
          <label class="editor-label">Castling rights:</label>
          <div class="editor-checkbox-group">
            <label><input type="checkbox" id="editor-castle-K" ${castling.K ? 'checked' : ''}> White O-O</label>
            <label><input type="checkbox" id="editor-castle-Q" ${castling.Q ? 'checked' : ''}> White O-O-O</label>
          </div>
          <div class="editor-checkbox-group">
            <label><input type="checkbox" id="editor-castle-k" ${castling.k ? 'checked' : ''}> Black O-O</label>
            <label><input type="checkbox" id="editor-castle-q" ${castling.q ? 'checked' : ''}> Black O-O-O</label>
          </div>
        </div>
        <div class="editor-section editor-board-btns">
          <button id="editor-flip">↔ Flip Board</button>
          <button id="editor-clear" class="danger">Clear Board</button>
          <button id="editor-standard">Standard Position</button>
        </div>
        <div class="editor-status" id="editor-status"></div>
        <div class="editor-actions">
          <button id="editor-done" class="primary">✓ Use This Position</button>
          <button id="editor-cancel">✗ Cancel</button>
        </div>
      </div>
    </div>
  `;

  // ── Chessground board ──────────────────────────────────────

  const boardEl = containerEl.querySelector('#editor-board');
  const overlayEl = containerEl.querySelector('#editor-overlay');

  const ground = Chessground(boardEl, {
    fen: fenParts[0],
    orientation,
    coordinates: true,
    movable: {
      free: true,
      color: 'both',
    },
    draggable: {
      enabled: true,
    },
    premovable: { enabled: false },
    animation: { enabled: false },
    highlight: { lastMove: false },
  });

  // ── Palette ──────────────────────────────────────────────

  buildPalette();

  // ── Click overlay for piece placement ──────────────────

  overlayEl.addEventListener('mousedown', (e) => {
    e.preventDefault();
    e.stopPropagation();
    if (!selectedPiece) return;

    const cgBoard = boardEl.querySelector('cg-board');
    if (!cgBoard) return;

    const key = getSquareFromClick(e, cgBoard, orientation);

    if (selectedPiece === 'eraser') {
      ground.setPieces(new Map([[key, undefined]]));
    } else {
      ground.setPieces(new Map([[key, { color: selectedPiece.color, role: selectedPiece.role }]]));
    }
  });

  // Escape key deselects palette
  function handleEditorKeyDown(e) {
    if (e.key === 'Escape') {
      deselectPalette();
    }
  }
  document.addEventListener('keydown', handleEditorKeyDown);

  // ── Event listeners ────────────────────────────────────

  containerEl.querySelectorAll('input[name="editor-side"]').forEach((r) => {
    r.addEventListener('change', (e) => { sideToMove = e.target.value; });
  });

  ['K', 'Q', 'k', 'q'].forEach((c) => {
    containerEl.querySelector(`#editor-castle-${c}`).addEventListener('change', (e) => {
      castling[c] = e.target.checked;
    });
  });

  containerEl.querySelector('#editor-flip').addEventListener('click', handleFlip);
  containerEl.querySelector('#editor-clear').addEventListener('click', handleClear);
  containerEl.querySelector('#editor-standard').addEventListener('click', handleStandard);
  containerEl.querySelector('#editor-done').addEventListener('click', handleDone);
  containerEl.querySelector('#editor-cancel').addEventListener('click', () => onCancel?.());

  // ── Internal functions ─────────────────────────────────

  function buildPalette() {
    const paletteEl = containerEl.querySelector('#editor-palette');
    let html = '<div class="palette-row">';

    for (const pt of PIECE_TYPES) {
      html += `<div class="palette-piece" data-color="${pt.color}" data-role="${pt.role}" title="${capitalize(pt.color)} ${capitalize(pt.role)}">
        <piece class="${pt.role} ${pt.color}"></piece>
      </div>`;
    }

    html += `<div class="palette-piece palette-eraser" data-tool="eraser" title="Eraser — remove pieces">
      <span class="eraser-icon">✕</span>
    </div>`;
    html += '</div>';

    paletteEl.innerHTML = html;

    paletteEl.querySelectorAll('.palette-piece').forEach((el) => {
      el.addEventListener('click', () => handlePaletteClick(el));
    });
  }

  function handlePaletteClick(el) {
    if (el.dataset.tool === 'eraser') {
      if (selectedPiece === 'eraser') {
        deselectPalette();
      } else {
        selectPalette(el, 'eraser');
      }
    } else {
      const color = el.dataset.color;
      const role = el.dataset.role;
      if (
        selectedPiece && selectedPiece !== 'eraser' &&
        selectedPiece.color === color && selectedPiece.role === role
      ) {
        deselectPalette();
      } else {
        selectPalette(el, { color, role });
      }
    }
  }

  function selectPalette(el, piece) {
    const paletteEl = containerEl.querySelector('#editor-palette');
    paletteEl.querySelectorAll('.palette-piece').forEach((p) => p.classList.remove('selected'));
    el.classList.add('selected');
    selectedPiece = piece;

    // Show overlay to intercept clicks, disable chessground drag
    overlayEl.style.display = 'block';
    ground.set({ movable: { color: undefined } });

    if (piece === 'eraser') {
      setEditorStatus('Eraser active — click a square to remove its piece.');
    } else {
      setEditorStatus(`Placing ${piece.color} ${piece.role} — click the board.`);
    }
  }

  function deselectPalette() {
    const paletteEl = containerEl.querySelector('#editor-palette');
    paletteEl.querySelectorAll('.palette-piece').forEach((p) => p.classList.remove('selected'));
    selectedPiece = null;

    // Hide overlay, re-enable chessground free movement
    overlayEl.style.display = 'none';
    ground.set({ movable: { free: true, color: 'both' } });
    setEditorStatus('');
  }

  function handleFlip() {
    orientation = orientation === 'white' ? 'black' : 'white';
    ground.set({ orientation });
  }

  function handleClear() {
    const pieces = new Map();
    for (const [key] of ground.state.pieces) {
      pieces.set(key, undefined);
    }
    ground.setPieces(pieces);
    setEditorStatus('Board cleared.');
  }

  function handleStandard() {
    ground.set({ fen: 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR' });
    sideToMove = 'w';
    castling = { K: true, Q: true, k: true, q: true };

    containerEl.querySelector('input[name="editor-side"][value="w"]').checked = true;
    ['K', 'Q', 'k', 'q'].forEach((c) => {
      containerEl.querySelector(`#editor-castle-${c}`).checked = true;
    });
    setEditorStatus('Standard position loaded.');
  }

  function handleDone() {
    // Pre-validate piece placement
    const errors = validatePosition(ground.state.pieces);
    if (errors.length > 0) {
      setEditorStatus(errors[0]);
      return;
    }

    // Auto-adjust castling rights
    const adjustedCastling = adjustCastlingRights(ground.state.pieces, castling);
    const fen = generateFen(adjustedCastling);

    // Validate with chess.js
    try {
      new Chess(fen);
      onDone?.(fen);
    } catch (err) {
      setEditorStatus(`Invalid position: ${err.message || 'Position is not legal.'}`);
    }
  }

  function generateFen(castlingOverride) {
    const c = castlingOverride || castling;
    const placement = piecesToFenPlacement(ground.state.pieces);
    const castlingStr = [
      c.K ? 'K' : '', c.Q ? 'Q' : '', c.k ? 'k' : '', c.q ? 'q' : '',
    ].join('') || '-';

    return `${placement} ${sideToMove} ${castlingStr} - 0 1`;
  }

  function setEditorStatus(text) {
    const el = containerEl.querySelector('#editor-status');
    if (el) el.textContent = text;
  }

  function capitalize(s) {
    return s.charAt(0).toUpperCase() + s.slice(1);
  }

  function destroy() {
    document.removeEventListener('keydown', handleEditorKeyDown);
    ground.destroy();
  }

  return { destroy };
}
