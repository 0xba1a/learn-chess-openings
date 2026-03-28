// study.js — Study Page module (ES module)
//
// Interactive board for entering new opening lines.
// User makes moves for both sides, annotates reasons,
// and saves completed lines to the DAG.

import * as dag from '../dag.js';
import * as db from '../db.js';
import { normalizeFen } from '../fen.js';
import { createBoard } from '../board.js';
import { createBoardEditor } from '../board-editor.js';
import { getSessionColor, setSessionColor } from '../utils.js';

// ---------------------------------------------------------------------------
// Internal State
// ---------------------------------------------------------------------------

/** @type {Object|null} Board instance */
let board = null;

/** @type {HTMLElement|null} Page container */
let containerEl = null;

/** @type {"white"|"black"} Selected study color */
let studyColor = 'white';

/** @type {string} Full starting FEN (default: standard start) */
let startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';

/** @type {Array<{san: string, fen: string}>} Setup moves (before starting position) */
let setupMoves = [];

/** @type {Array<{san: string, fen: string}>} Active moves (after starting position) */
let moves = [];

/** @type {string[]} Reason strings parallel to moves[] */
let reasons = [];

/** @type {Array<{san: string, fen: string, reason: string}>} Redo stack */
let undoStack = [];

/** @type {Object|null} Board editor instance */
let editorInstance = null;

/** @type {string[]} Current tags for grouping lines */
let studyTags = [];

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function setStatus(text) {
  const el = containerEl?.querySelector('#study-status');
  if (el) el.textContent = text;
}

function getMovableColor() {
  return 'both'; // Study page: user plays both sides
}

function renderStudyTagChips() {
  const el = containerEl?.querySelector('#study-tag-chips');
  if (!el) return;
  el.innerHTML = studyTags.map((t, i) =>
    `<span class="tag-chip">${t}<button class="tag-chip-remove" data-idx="${i}" title="Remove">&times;</button></span>`
  ).join('');
  el.querySelectorAll('.tag-chip-remove').forEach(btn => {
    btn.addEventListener('click', () => {
      studyTags.splice(parseInt(btn.dataset.idx, 10), 1);
      renderStudyTagChips();
    });
  });
}

async function populateStudyTagList() {
  const datalist = containerEl?.querySelector('#study-tag-list');
  if (!datalist) return;
  const allLines = await db.getAll('lines');
  const tags = new Set();
  for (const line of allLines) {
    if (Array.isArray(line.tags)) {
      for (const t of line.tags) tags.add(t);
    } else if (line.studyTag) {
      tags.add(line.studyTag);
    }
  }
  datalist.innerHTML = [...tags].sort()
    .map((t) => `<option value="${t}">`)
    .join('');
}

// ---------------------------------------------------------------------------
// Move List Rendering
// ---------------------------------------------------------------------------

function renderMoveList() {
  const moveListEl = containerEl?.querySelector('#study-move-list');
  if (!moveListEl) return;

  let html = '';

  // Greyed-out setup moves
  if (setupMoves.length > 0) {
    const activeField = startingFen.split(' ')[1];
    const startMoveNum = 1;
    html += '<div class="setup-moves">';
    for (let i = 0; i < setupMoves.length; i++) {
      const moveNum = Math.floor(i / 2) + startMoveNum;
      if (i % 2 === 0) {
        html += `<span class="move-number">${moveNum}.</span> `;
      }
      html += `<span class="setup-move">${setupMoves[i].san}</span> `;
      if (i % 2 === 1) html += '<br>';
    }
    html += '</div>';
    html += '<div class="start-divider">── Start Position ──</div>';
  }

  // Active moves with reasons
  if (moves.length > 0) {
    // Determine move numbering offset
    const setupLen = setupMoves.length;
    const startMoveNum = Math.floor(setupLen / 2) + 1;
    const startWhite = setupLen % 2 === 0; // Does first active move start as white?

    html += '<div class="active-moves">';
    for (let i = 0; i < moves.length; i++) {
      const globalIdx = setupLen + i;
      const moveNum = Math.floor(globalIdx / 2) + 1;
      const isWhiteMove = globalIdx % 2 === 0;

      if (isWhiteMove) {
        html += `<span class="move-number">${moveNum}.</span> `;
      } else if (i === 0 && !isWhiteMove) {
        html += `<span class="move-number">${moveNum}...</span> `;
      }

      const reasonText = reasons[i] || '';
      const reasonTitle = reasonText ? ` title="${reasonText}"` : '';
      html += `<span class="active-move" data-idx="${i}"${reasonTitle}>${moves[i].san}</span>`;
      html += `<button class="edit-reason-btn" data-idx="${i}" title="Edit reason">✎</button> `;

      if (isWhiteMove) {
        // Wait for black's move
      } else {
        html += '<br>';
      }
    }
    html += '</div>';
  }

  moveListEl.innerHTML = html;

  // Attach edit buttons
  moveListEl.querySelectorAll('.edit-reason-btn').forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = parseInt(btn.dataset.idx, 10);
      focusReasonInput(idx);
    });
  });
}

function focusReasonInput(moveIdx) {
  const inputEl = containerEl?.querySelector('#study-reason-input');
  if (!inputEl) return;

  inputEl.value = reasons[moveIdx] || '';
  inputEl.dataset.idx = moveIdx;
  inputEl.placeholder = `Reason for ${moves[moveIdx]?.san || 'move'}...`;
  inputEl.focus();

  const label = containerEl?.querySelector('#study-reason-label');
  if (label) label.textContent = `Reason for move ${moves[moveIdx]?.san}:`;
}

function saveReasonFromInput() {
  const inputEl = containerEl?.querySelector('#study-reason-input');
  if (!inputEl) return;

  const idx = parseInt(inputEl.dataset.idx, 10);
  if (!isNaN(idx) && idx >= 0 && idx < reasons.length) {
    reasons[idx] = inputEl.value;
  }
}

// ---------------------------------------------------------------------------
// Branch Detection
// ---------------------------------------------------------------------------

async function checkBranch() {
  if (!board) return;

  const currentFen = normalizeFen(board.chess.fen());
  const children = await dag.getChildren(currentFen);

  if (children.length > 0) {
    const branches = children
      .map((e) => e.moveSan)
      .join(', ');
    setStatus(`Position exists in repertoire. Existing moves: ${branches}`);
  } else if (moves.length > 0) {
    // Check if the position itself exists
    const db = await import('../db.js');
    const node = await db.get('nodes', currentFen);
    if (node) {
      setStatus('Known position, no existing continuations.');
    } else {
      setStatus('New position.');
    }
  }
}

// ---------------------------------------------------------------------------
// Move Handler
// ---------------------------------------------------------------------------

function handleMove(moveObj) {
  // Save any pending reason before adding new move
  saveReasonFromInput();

  const fen = board.chess.fen();

  // Determine if this is a setup move or active move
  // If startingFen is standard start and no mark was done, all moves are active
  moves.push({ san: moveObj.san, fen });
  reasons.push('');

  // Clear redo stack (new move invalidates it)
  undoStack = [];

  renderMoveList();
  checkBranch();

  // Focus reason input for the new move
  focusReasonInput(moves.length - 1);
}

// ---------------------------------------------------------------------------
// Undo / Redo
// ---------------------------------------------------------------------------

function handleUndo() {
  saveReasonFromInput();

  if (moves.length > 0) {
    // Undo an active move
    const lastMove = moves.pop();
    const lastReason = reasons.pop();
    undoStack.push({ san: lastMove.san, fen: lastMove.fen, reason: lastReason, isSetup: false });
    board.undoMove();
  } else if (setupMoves.length > 0) {
    // Undo past starting position — revert to standard start
    const lastSetup = setupMoves.pop();
    undoStack.push({ san: lastSetup.san, fen: lastSetup.fen, reason: '', isSetup: true });
    board.undoMove();

    if (setupMoves.length === 0) {
      // All setup moves undone — revert startingFen to standard
      startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
      setStatus('Starting position reverted to standard start.');
    }
  }

  renderMoveList();

  // Clear reason input
  const inputEl = containerEl?.querySelector('#study-reason-input');
  if (inputEl) {
    inputEl.value = '';
    inputEl.dataset.idx = '';
    inputEl.placeholder = 'Select a move to add a reason...';
  }
}

function handleRedo() {
  if (undoStack.length === 0) return;

  saveReasonFromInput();

  const item = undoStack.pop();

  // Replay the move on the board
  const result = board.playMove(item.san);
  if (!result) return;

  if (item.isSetup) {
    setupMoves.push({ san: item.san, fen: item.fen });
  } else {
    moves.push({ san: item.san, fen: item.fen });
    reasons.push(item.reason);
    focusReasonInput(moves.length - 1);
  }

  renderMoveList();
}

// ---------------------------------------------------------------------------
// Mark Starting Position
// ---------------------------------------------------------------------------

function handleMarkStartingPosition() {
  // Check constraint: cannot mark if there are active moves with reasons
  const hasReasons = reasons.some((r) => r && r.trim() !== '');
  if (moves.length > 0 && hasReasons) {
    setStatus('Clear active moves first, or use Undo.');
    return;
  }

  // Current board position becomes the starting position
  startingFen = board.chess.fen();

  // Move all current active moves to setup moves
  for (const m of moves) {
    setupMoves.push(m);
  }
  moves = [];
  reasons = [];
  undoStack = [];

  // Determine status message
  const lastMove = setupMoves.length > 0
    ? setupMoves[setupMoves.length - 1].san
    : null;
  const moveNum = Math.ceil(setupMoves.length / 2);

  if (lastMove) {
    setStatus(`Starting position set at move ${moveNum} (after ${lastMove}).`);
  } else {
    setStatus('Starting position set.');
  }

  renderMoveList();
}

// ---------------------------------------------------------------------------
// Save Line
// ---------------------------------------------------------------------------

async function handleSave() {
  saveReasonFromInput();

  // Validation: no active moves
  if (moves.length === 0) {
    setStatus('Cannot save an empty line. Make some moves first.');
    return;
  }

  const moveSans = moves.map((m) => m.san);
  const reasonList = [...reasons];

  try {
    // Check for duplicate
    const normalizedStarting = normalizeFen(startingFen);
    const allLines = await db.getAll('lines');
    const duplicate = allLines.find(
      (l) =>
        l.rootFen === normalizedStarting &&
        JSON.stringify(l.moves) === JSON.stringify(moveSans)
    );

    if (duplicate) {
      setStatus('Warning: This exact line already exists in your repertoire.');
      return;
    }

    await dag.addLine(startingFen, moveSans, studyColor, reasonList, studyTags);
    setStatus('Line saved!' + (studyTags.length > 0 ? ` (Tags: ${studyTags.join(', ')})` : ''));

    // Reset to starting position (keep setup moves and startingFen)
    moves = [];
    reasons = [];
    undoStack = [];

    if (board) {
      board.setPosition(startingFen);
      board.setOrientation(studyColor);
    }

    renderMoveList();

    const inputEl = containerEl?.querySelector('#study-reason-input');
    if (inputEl) {
      inputEl.value = '';
      inputEl.dataset.idx = '';
      inputEl.placeholder = 'Select a move to add a reason...';
    }
  } catch (err) {
    setStatus(`Error saving line: ${err.message}`);
  }
}

// ---------------------------------------------------------------------------
// Clear
// ---------------------------------------------------------------------------

function handleClear() {
  startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  setupMoves = [];
  moves = [];
  reasons = [];
  undoStack = [];

  if (board) {
    board.setPosition(startingFen);
    board.setOrientation(studyColor);
  }

  renderMoveList();
  setStatus('Board cleared.');

  const inputEl = containerEl?.querySelector('#study-reason-input');
  if (inputEl) {
    inputEl.value = '';
    inputEl.dataset.idx = '';
    inputEl.placeholder = 'Select a move to add a reason...';
  }
}

// ---------------------------------------------------------------------------
// Board Editor (Set Up Position)
// ---------------------------------------------------------------------------

function openBoardEditor() {
  if (moves.length > 0) {
    if (!confirm('Opening the position editor will clear your current moves. Continue?')) {
      return;
    }
  }

  const studyBody = containerEl.querySelector('.study-body');
  studyBody.style.display = 'none';

  const editorContainer = document.createElement('div');
  editorContainer.id = 'editor-container';
  containerEl.querySelector('.study-page').appendChild(editorContainer);

  // Start with empty board unless a custom starting position is already set
  const isStandard = startingFen === 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const editorFen = isStandard ? null : startingFen;

  editorInstance = createBoardEditor(editorContainer, {
    fen: editorFen,
    orientation: studyColor,
    onDone: (fen) => {
      closeEditor(editorContainer, studyBody);

      // Update study state with the new position
      startingFen = fen;
      setupMoves = [];
      moves = [];
      reasons = [];
      undoStack = [];

      if (board) {
        board.setPosition(startingFen);
        board.setOrientation(studyColor);
      }

      renderMoveList();
      setStatus('Custom position set. Make moves to build your line.');
    },
    onCancel: () => {
      closeEditor(editorContainer, studyBody);
    },
  });
}

function closeEditor(editorContainer, studyBody) {
  if (editorInstance) {
    editorInstance.destroy();
    editorInstance = null;
  }
  editorContainer.remove();
  studyBody.style.display = '';
}

// ---------------------------------------------------------------------------
// Color Selection
// ---------------------------------------------------------------------------

function handleColorChange(color) {
  studyColor = color;
  setSessionColor(color);
  if (board) {
    board.setOrientation(color);
  }
}

// ---------------------------------------------------------------------------
// Keyboard shortcuts
// ---------------------------------------------------------------------------

function handleKeyDown(e) {
  if (e.ctrlKey && e.key === 'z') {
    e.preventDefault();
    handleUndo();
  } else if (e.ctrlKey && e.key === 'y') {
    e.preventDefault();
    handleRedo();
  }
}

// ---------------------------------------------------------------------------
// Mount / Unmount
// ---------------------------------------------------------------------------

export default {
  /**
   * Mount the study page into a container.
   * @param {HTMLElement} container
   * @param {Object} [params={}]
   */
  mount(container, params = {}) {
    containerEl = container;
    studyColor = params.color || getSessionColor();
    startingFen = params.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
    setupMoves = [];
    moves = [];
    reasons = [];
    undoStack = [];
    studyTags = [];

    container.innerHTML = `
      <div class="study-page">
        <div class="study-body">
          <div class="study-board-area">
            <div class="board-container" id="study-board-container"></div>
            <div class="study-board-controls">
              <button id="btn-undo">Undo</button>
              <button id="btn-redo">Redo</button>
              <button id="btn-setup-position" class="btn-blue">⚙ Set Up Position</button>
              <button id="btn-mark-start" class="btn-amber mark-start-btn">⚑ Mark Start</button>
            </div>
            <div id="study-status" class="study-status"></div>
          </div>
          <div class="study-sidebar">
            <div class="study-tag-area">
              <label>Tags:</label>
              <div class="tag-chips-container" id="study-tag-chips"></div>
              <input type="text" id="study-tag-input" list="study-tag-list" placeholder="Add tag..." />
              <datalist id="study-tag-list"></datalist>
            </div>
            <div class="color-selector">
              <label>Color:</label>
              <label><input type="radio" name="study-color" value="white" ${studyColor === 'white' ? 'checked' : ''}> White</label>
              <label><input type="radio" name="study-color" value="black" ${studyColor === 'black' ? 'checked' : ''}> Black</label>
            </div>
            <div class="move-list-header">Move List:</div>
            <div id="study-move-list" class="study-move-list"></div>
            <div class="reason-area">
              <label id="study-reason-label">Reason:</label>
              <input type="text" id="study-reason-input" placeholder="Select a move to add a reason..." />
            </div>
            <div class="study-actions">
              <button id="btn-save-line" class="primary">Save Line</button>
              <button id="btn-clear" class="danger">Clear</button>
            </div>
          </div>
        </div>
      </div>
    `;

    // Create board
    const boardContainer = container.querySelector('#study-board-container');
    board = createBoard(boardContainer, {
      color: studyColor,
      movableColor: 'both',
      fen: startingFen,
      onMove: handleMove,
    });

    // Color radio buttons
    container.querySelectorAll('input[name="study-color"]').forEach((radio) => {
      radio.addEventListener('change', (e) => {
        handleColorChange(e.target.value);
      });
    });

    // Buttons
    container.querySelector('#btn-undo').addEventListener('click', handleUndo);
    container.querySelector('#btn-redo').addEventListener('click', handleRedo);
    container.querySelector('#btn-mark-start').addEventListener('click', handleMarkStartingPosition);
    container.querySelector('#btn-setup-position').addEventListener('click', openBoardEditor);
    container.querySelector('#btn-save-line').addEventListener('click', handleSave);
    container.querySelector('#btn-clear').addEventListener('click', handleClear);

    // Study tag input — multi-tag chips
    const studyTagInput = container.querySelector('#study-tag-input');
    const tagChipsEl = container.querySelector('#study-tag-chips');
    renderStudyTagChips();
    studyTagInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        const val = studyTagInput.value.trim();
        if (val && !studyTags.includes(val)) {
          studyTags.push(val);
          renderStudyTagChips();
        }
        studyTagInput.value = '';
      }
    });
    // Also add on blur if there's text (selecting from datalist)
    studyTagInput.addEventListener('change', () => {
      const val = studyTagInput.value.trim();
      if (val && !studyTags.includes(val)) {
        studyTags.push(val);
        renderStudyTagChips();
      }
      studyTagInput.value = '';
    });
    populateStudyTagList();

    // Reason input — save on blur or Enter
    const reasonInput = container.querySelector('#study-reason-input');
    reasonInput.addEventListener('blur', saveReasonFromInput);
    reasonInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        saveReasonFromInput();
        reasonInput.blur();
      }
    });

    // Keyboard shortcuts
    document.addEventListener('keydown', handleKeyDown);

    renderMoveList();
    setStatus('Ready. Make moves on the board to build your line.');
  },

  /**
   * Unmount the study page — clean up.
   */
  unmount() {
    document.removeEventListener('keydown', handleKeyDown);
    if (editorInstance) {
      editorInstance.destroy();
      editorInstance = null;
    }
    if (board) {
      board.destroy();
      board = null;
    }
    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl = null;
    }
    moves = [];
    reasons = [];
    setupMoves = [];
    undoStack = [];
  },

  // Expose internal state/functions for testing
  _getState() {
    return {
      studyColor,
      startingFen,
      studyTag,
      setupMoves: [...setupMoves],
      moves: [...moves],
      reasons: [...reasons],
      undoStackLength: undoStack.length,
      board,
    };
  },

  _handleSave: handleSave,
  _handleClear: handleClear,
  _handleUndo: handleUndo,
  _handleRedo: handleRedo,
  _handleMarkStartingPosition: handleMarkStartingPosition,

  /**
   * Test helper: play a move and trigger handleMove as if the user played it.
   * Uses chess.move + ground.set directly (not board.playMove) to avoid
   * chessground's async events.move callback firing a duplicate handleMove.
   * @param {string} san
   * @returns {Object|null} move object
   */
  _playMove(san) {
    if (!board) return null;
    let move;
    try { move = board.chess.move(san); } catch { return null; }
    if (!move) return null;
    // Update chessground display without ground.move (avoids async event)
    board.ground.set({
      fen: board.chess.fen(),
      turnColor: board.chess.turn() === 'w' ? 'white' : 'black',
      lastMove: [move.from, move.to],
      check: board.chess.isCheck(),
    });
    handleMove(move);
    return move;
  },
};
