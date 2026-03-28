// practice.js — Practice Engine & Practice Page (ES module)
//
// Core drill loop: picks due lines, auto-plays opponent moves,
// evaluates user moves, handles pivots, grades lines via SM2.

import * as db from '../db.js';
import * as dag from '../dag.js';
import * as sm2 from '../sm2.js';
import { createBoard } from '../board.js';

// ---------------------------------------------------------------------------
// Internal state
// ---------------------------------------------------------------------------

/** @type {Object|null} Current board instance */
let board = null;

/** @type {Object|null} Current line being drilled */
let currentLine = null;

/** @type {number} Current move index into currentLine.moves */
let moveIndex = 0;

/** @type {string} The user's study color */
let userColor = 'white';

/** @type {string} Active color derived from rootFen */
let activeColor = 'white';

/** @type {number} Correct moves this drill */
let correctMoves = 0;

/** @type {number} Total user moves this drill */
let totalUserMoves = 0;

/** @type {boolean} Was hint used in this drill? */
let hintUsed = false;

/** @type {boolean} Was this line reached via pivot? */
let pivoted = false;

/** @type {Object|null} The original line before pivot (stays un-graded) */
let originalLine = null;

/** @type {number} Original line's moveIndex at pivot point */
let originalMoveIndex = 0;

/** @type {Array} Session history: [{lineId, label, quality, grade, correct, total}] */
let sessionHistory = [];

/** @type {number} Pivot count for session summary */
let pivotCount = 0;

/** @type {number} Practice delay in ms */
let practiceDelay = 500;

/** @type {string|null} Subtree scope FEN */
let scopeFen = null;

/** @type {string|null} Color filter */
let colorFilter = null;

/** @type {string|null} Study tag filter */
let studyFilter = null;

/** @type {HTMLElement|null} Container element */
let containerEl = null;

/** @type {Function|null} Resolve function for user move promise */
let awaitingUserMove = null;

/** @type {boolean} Is practice session active? */
let sessionActive = false;

// ---------------------------------------------------------------------------
// Helper: determine side to move at moveIndex
// ---------------------------------------------------------------------------

function sideAtIndex(index) {
  // Read side-to-move directly from the FEN at this index.
  // This is always correct regardless of pivots between lines
  // with different rootFen side-to-move.
  if (currentLine && currentLine.fens && index < currentLine.fens.length) {
    const parts = currentLine.fens[index].split(' ');
    if (parts.length > 1) {
      return parts[1] === 'b' ? 'black' : 'white';
    }
  }
  return index % 2 === 0 ? activeColor : opposite(activeColor);
}

function opposite(color) {
  return color === 'white' ? 'black' : 'white';
}

// ---------------------------------------------------------------------------
// Helper: sleep
// ---------------------------------------------------------------------------

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

// ---------------------------------------------------------------------------
// UI Rendering Helpers
// ---------------------------------------------------------------------------

function renderSidebar() {
  const sidebar = containerEl.querySelector('.practice-sidebar');
  if (!sidebar || !currentLine) return;

  const userMoveCount = currentLine.moves.filter(
    (_, i) => sideAtIndex(i) === userColor
  ).length;
  const userProgress = currentLine.moves
    .slice(0, moveIndex)
    .filter((_, i) => sideAtIndex(i) === userColor).length;

  // Preserve current status and reason text if they exist
  const currentStatus = containerEl.querySelector('#practice-status');
  const currentReason = containerEl.querySelector('#practice-reason');
  const statusText = currentStatus ? currentStatus.textContent : 'Waiting...';
  const reasonText = currentReason ? currentReason.textContent : '';

  sidebar.innerHTML = `
    <div class="line-info">
      <div class="line-label"><strong>Current Line:</strong><br>${currentLine.label}</div>
      <div class="progress">Progress: ${userProgress}/${userMoveCount} moves</div>
      <div class="status" id="practice-status">${statusText}</div>
      <div class="reason" id="practice-reason">${reasonText}</div>
      <div class="practice-sidebar-actions">
        <button id="btn-browse-position" class="btn-blue" title="Open current position in Browse page (new tab)">Browse Position</button>
      </div>
    </div>
  `;

  // Browse Position — open in new tab
  sidebar.querySelector('#btn-browse-position')?.addEventListener('click', () => {
    if (currentLine && moveIndex < currentLine.fens.length) {
      const fen = currentLine.fens[moveIndex];
      window.open(`${window.location.origin}${window.location.pathname}#/browse?fen=${encodeURIComponent(fen)}`, '_blank');
    }
  });
}

function setStatus(text) {
  const el = containerEl.querySelector('#practice-status');
  if (el) el.textContent = text;
}

function setReason(text) {
  const el = containerEl.querySelector('#practice-reason');
  if (el) el.textContent = text ? `Reason: ${text}` : '';
}

function showMessage(title, body, duration = 3000) {
  const msg = containerEl.querySelector('#practice-message');
  if (msg) {
    msg.innerHTML = `<strong>${title}</strong><br>${body}`;
    msg.style.display = 'block';
    if (duration > 0) {
      setTimeout(() => {
        msg.style.display = 'none';
      }, duration);
    }
  }
}

// ---------------------------------------------------------------------------
// Line Result Screen (§8.1)
// ---------------------------------------------------------------------------

function showLineResult(line, correct, total) {
  return new Promise((resolve) => {
    const score = total > 0 ? Math.round((correct / total) * 100) : 100;
    const overlay = document.createElement('div');
    overlay.className = 'line-result-overlay';
    overlay.innerHTML = `
      <div class="line-result">
        <h3>Line: ${line.label}</h3>
        <p class="score">Score: ${score}%</p>
        <p>(${correct} / ${total} moves correct)</p>
        <div class="line-result-buttons">
          <button id="btn-redo-line" class="btn-amber">Redo</button>
          <button id="btn-next-line" class="primary">Next Line</button>
          <button id="btn-end-practice" class="danger">End Practice</button>
        </div>
      </div>
    `;
    containerEl.appendChild(overlay);

    overlay.querySelector('#btn-redo-line').addEventListener('click', () => {
      overlay.remove();
      resolve('redo');
    });
    overlay.querySelector('#btn-next-line').addEventListener('click', () => {
      overlay.remove();
      resolve('next');
    });
    overlay.querySelector('#btn-end-practice').addEventListener('click', () => {
      overlay.remove();
      resolve('end');
    });
  });
}

// ---------------------------------------------------------------------------
// Session Summary (§9)
// ---------------------------------------------------------------------------

function showSessionSummary() {
  const totalCorrect = sessionHistory.reduce((s, h) => s + h.correct, 0);
  const totalMoves = sessionHistory.reduce((s, h) => s + h.total, 0);
  const accuracy =
    totalMoves > 0 ? Math.round((totalCorrect / totalMoves) * 100) : 100;

  let lineRows = sessionHistory
    .map((h) => {
      const icon = h.quality >= 3 ? '✓' : '✗';
      const arrow = h.quality >= 3 ? '↑' : '↓';
      return `<div>${icon} ${h.label} — Grade ${h.quality} (${arrow})</div>`;
    })
    .join('');

  const summaryHtml = `
    <div class="session-summary">
      <h2>Practice Summary</h2>
      <p>Lines reviewed: ${sessionHistory.length}</p>
      <p>Pivots taken: ${pivotCount}</p>
      <p>Overall accuracy: ${accuracy}%</p>
      <div class="line-results">${lineRows}</div>
      <button id="btn-practice-more" class="primary">Practice More</button>
    </div>
  `;

  const boardArea = containerEl.querySelector('.practice-board');
  if (boardArea) boardArea.style.display = 'none';

  const sidebar = containerEl.querySelector('.practice-sidebar');
  if (sidebar) sidebar.innerHTML = '';

  const summaryEl = document.createElement('div');
  summaryEl.className = 'session-summary-overlay';
  summaryEl.innerHTML = summaryHtml;
  containerEl.appendChild(summaryEl);

  summaryEl
    .querySelector('#btn-practice-more')
    .addEventListener('click', () => {
      summaryEl.remove();
      if (boardArea) boardArea.style.display = '';
      startSession();
    });
}

// ---------------------------------------------------------------------------
// Hint Logic
// ---------------------------------------------------------------------------

function handleHint() {
  if (!currentLine || moveIndex >= currentLine.moves.length) return;

  hintUsed = true;
  const expectedMove = currentLine.moves[moveIndex];

  // Highlight destination square
  const charHint = expectedMove.replace(/[+#x=]/g, '');
  const destSquare = charHint.slice(-2);
  if (board && destSquare.match(/^[a-h][1-8]$/)) {
    board.highlightSquares([destSquare], 'green');
  }

  setStatus(`Hint: move ends on ${destSquare}`);
}

// ---------------------------------------------------------------------------
// Skip Logic
// ---------------------------------------------------------------------------

async function handleSkip() {
  if (!currentLine) return;

  // Grade with quality 0
  await sm2.gradeLine(currentLine.id, 0);
  sessionHistory.push({
    lineId: currentLine.id,
    label: currentLine.label,
    quality: 0,
    correct: correctMoves,
    total: totalUserMoves,
  });

  await pickNextLine('next');
}

// ---------------------------------------------------------------------------
// Core Practice Loop
// ---------------------------------------------------------------------------

/**
 * Drill a single line move by move.
 * @param {Object} line - the line record to practice
 */
async function drillLine(line) {
  currentLine = line;
  moveIndex = 0;
  correctMoves = 0;
  totalUserMoves = 0;
  hintUsed = false;
  userColor = line.color;

  // Determine active color from rootFen
  const fenParts = line.rootFen.split(' ');
  activeColor = fenParts.length > 1 && fenParts[1] === 'b' ? 'black' : 'white';

  // Set board position and orientation
  board.setPosition(line.fens[0] + ' 0 1');
  board.setOrientation(userColor);

  // Configure movable color to user's color
  board.setMovableColor(userColor);

  renderSidebar();

  let lastRetry = false;

  while (moveIndex < currentLine.moves.length && sessionActive) {
    try {
      const side = sideAtIndex(moveIndex);

      if (side !== userColor) {
        // Opponent's move — auto-play
        board.setInteractive(false);
        setStatus("Opponent's move...");
        lastRetry = false;
        await sleep(practiceDelay);

        if (!sessionActive) return; // Session ended during delay

        const move = board.playMove(currentLine.moves[moveIndex]);

        if (!move) {
          // playMove failed — resync board to expected position
          console.warn('Auto-play failed for move:', currentLine.moves[moveIndex], 'at index:', moveIndex);
          if (moveIndex + 1 < currentLine.fens.length) {
            board.setPosition(currentLine.fens[moveIndex + 1] + ' 0 1');
          }
        }

        // Show reason if available
        const edges = await dag.getChildren(currentLine.fens[moveIndex]);
        const edge = edges.find(
          (e) => e.moveSan === currentLine.moves[moveIndex]
        );
        if (edge && edge.reasons && edge.reasons[currentLine.label]) {
          setReason(edge.reasons[currentLine.label]);
        }

        moveIndex += 1;
        renderSidebar();
      } else {
        // User's move — wait for input
        if (!lastRetry) {
          setStatus(`Your move (${userColor})`);
        }
        board.clearHighlights();
        board.setInteractive(true);

        const userMove = await waitForUserMove();

        if (!sessionActive) return; // Session was ended

        totalUserMoves += 1;

        // Evaluate move
        const result = await evaluateMove(userMove);

        if (result === 'continue') {
          // Move was accepted (exact match or pivot)
          moveIndex += 1;
          lastRetry = false;
          renderSidebar();
        } else if (result === 'retry') {
          // Move was wrong or mastered alt — try again
          // Don't increment moveIndex; keep status message from evaluateMove
          lastRetry = true;
          renderSidebar();
        }
      }
    } catch (err) {
      console.error('Practice loop error:', err);
      setStatus('Error — skipping to next move');
      moveIndex += 1;
      renderSidebar();
    }
  }

  if (!sessionActive) return;

  // Line complete — grade it
  const gradedLine = currentLine;
  const quality = sm2.autoQuality(
    totalUserMoves,
    correctMoves,
    hintUsed
  );
  await sm2.gradeLine(gradedLine.id, quality);

  sessionHistory.push({
    lineId: gradedLine.id,
    label: gradedLine.label,
    quality,
    correct: correctMoves,
    total: totalUserMoves,
  });

  // Show line result screen
  const action = await showLineResult(
    gradedLine,
    correctMoves,
    totalUserMoves
  );

  if (action === 'redo') {
    // Redo the same line
    pivoted = false;
    originalLine = null;
    await drillLine(gradedLine);
  } else {
    await pickNextLine(action);
  }
}

// ---------------------------------------------------------------------------
// Wait for user move
// ---------------------------------------------------------------------------

function waitForUserMove() {
  return new Promise((resolve) => {
    awaitingUserMove = resolve;
  });
}

// ---------------------------------------------------------------------------
// onMove handler (called by board)
// ---------------------------------------------------------------------------

function handleUserMove(moveObj) {
  if (awaitingUserMove) {
    const resolve = awaitingUserMove;
    awaitingUserMove = null;
    resolve(moveObj.san);
  }
}

// ---------------------------------------------------------------------------
// Move Evaluation (§4)
// ---------------------------------------------------------------------------

/**
 * Evaluate the user's move against the DAG.
 * @param {string} userMoveSan
 * @returns {Promise<'continue'|'retry'>}
 */
async function evaluateMove(userMoveSan) {
  const currentFen = currentLine.fens[moveIndex];
  const expectedMove = currentLine.moves[moveIndex];

  // Case 1: Exact match
  if (userMoveSan === expectedMove) {
    correctMoves += 1;
    board.clearHighlights();
    setStatus('✓ Correct!');

    // Show reason
    const edges = await dag.getChildren(currentFen);
    const edge = edges.find((e) => e.moveSan === expectedMove);
    if (edge && edge.reasons && edge.reasons[currentLine.label]) {
      setReason(edge.reasons[currentLine.label]);
    }

    return 'continue';
  }

  // Case 2: DAG match (different line)
  const children = await dag.getChildren(currentFen);
  const altEdge = children.find((e) => e.moveSan === userMoveSan);

  if (altEdge) {
    return await handlePivot(currentFen, userMoveSan, altEdge);
  }

  // Case 3: Not in DAG — incorrect
  setStatus(`✗ Incorrect. Expected: ${expectedMove}`);
  board.highlightSquares([], 'red');

  // Show reason for expected move
  const edges = await dag.getChildren(currentFen);
  const expectedEdge = edges.find((e) => e.moveSan === expectedMove);
  if (expectedEdge && expectedEdge.reasons && expectedEdge.reasons[currentLine.label]) {
    setReason(expectedEdge.reasons[currentLine.label]);
  }

  // Undo the wrong move and replay correct position
  board.undoMove();

  return 'retry';
}

// ---------------------------------------------------------------------------
// Pivot Logic (§5)
// ---------------------------------------------------------------------------

/**
 * Handle a DAG match — the user played a move from a different line.
 * @param {string} currentFen
 * @param {string} userMoveSan
 * @param {Object} altEdge — the matching edge
 * @returns {Promise<'continue'|'retry'>}
 */
async function handlePivot(currentFen, userMoveSan, altEdge) {
  // Find alternative lines
  const allLines = await db.getAll('lines');
  const altLines = allLines.filter((l) => {
    if (l.id === currentLine.id) return false;
    if (l.color !== userColor) return false; // Only same-color pivots
    const fenIdx = l.fens.indexOf(currentFen);
    if (fenIdx < 0 || fenIdx >= l.moves.length) return false;
    return l.moves[fenIdx] === userMoveSan;
  });

  // Step 2: No alternative lines found
  if (altLines.length === 0) {
    setStatus('Valid move, but no complete line continues from here.');
    board.undoMove();
    return 'retry';
  }

  // Step 3: Check alt line mastery
  // Pick best candidate: most overdue first, then lowest EF, then longest
  altLines.sort((a, b) => {
    if (a.nextReviewDate !== b.nextReviewDate)
      return a.nextReviewDate - b.nextReviewDate;
    if (a.easeFactor !== b.easeFactor) return a.easeFactor - b.easeFactor;
    return b.moves.length - a.moves.length;
  });

  const bestAlt = altLines[0];

  if (sm2.isLineMastered(bestAlt)) {
    // Case A: Alt is mastered — inform and undo
    showMessage(
      'Already Mastered',
      `You played: ${userMoveSan} (${bestAlt.label})<br>But this variation is already mastered.<br>Think about the correct move for the current line.`
    );
    board.undoMove();
    return 'retry';
  }

  // Case B: Alt not mastered — silent pivot
  pivotCount += 1;
  pivoted = true;
  originalLine = originalLine || currentLine;
  originalMoveIndex = moveIndex;

  // Find moveIndex in altLine
  const altFenIdx = bestAlt.fens.indexOf(altEdge.childFen);

  if (altFenIdx < 0) {
    // Child FEN not found in alt line — cannot pivot safely
    setStatus('Valid move, but could not switch to alternative line.');
    board.undoMove();
    return 'retry';
  }

  correctMoves += 1; // User's move was correct (in repertoire)

  // Pivot to the alt line
  currentLine = bestAlt;
  moveIndex = altFenIdx - 1; // Caller will increment, so next iteration processes moves[altFenIdx]

  renderSidebar();
  setStatus('✓ Correct! (pivoted to ' + bestAlt.label + ')');

  return 'continue';
}

// ---------------------------------------------------------------------------
// Pick next line or end session
// ---------------------------------------------------------------------------

async function pickNextLine(action) {
  if (action === 'end' || !sessionActive) {
    if (sessionActive) {
      sessionActive = false;
      showSessionSummary();
    }
    return;
  }

  // Get next due line
  let dueLines;
  try {
    dueLines = await sm2.getDueLines(scopeFen, colorFilter, studyFilter);
  } catch (e) {
    // DB may have been closed during unmount
    return;
  }
  // Exclude lines already reviewed this session
  const reviewed = new Set(sessionHistory.map((h) => h.lineId));
  const remaining = dueLines.filter((l) => !reviewed.has(l.id));

  if (remaining.length === 0) {
    // All caught up
    showSessionSummary();
    return;
  }

  // Reset pivot state
  pivoted = false;
  originalLine = null;

  await drillLine(remaining[Math.floor(Math.random() * remaining.length)]);
}

// ---------------------------------------------------------------------------
// Study Filter
// ---------------------------------------------------------------------------

async function populateStudyFilter() {
  const select = containerEl?.querySelector('#study-filter-select');
  if (!select) return;

  const allLines = await db.getAll('lines');
  const tags = new Set();
  for (const line of allLines) {
    if (Array.isArray(line.tags)) {
      for (const t of line.tags) tags.add(t);
    } else if (line.studyTag) {
      tags.add(line.studyTag);
    }
  }

  for (const tag of [...tags].sort()) {
    const opt = document.createElement('option');
    opt.value = tag;
    opt.textContent = tag;
    if (tag === studyFilter) opt.selected = true;
    select.appendChild(opt);
  }

  // Update scope label
  updateScopeLabel();

  select.addEventListener('change', async () => {
    studyFilter = select.value || null;
    updateScopeLabel();

    // Update due count
    const dueLines = await sm2.getDueLines(scopeFen, colorFilter, studyFilter);
    const dueCountEl = containerEl?.querySelector('#due-count');
    if (dueCountEl) dueCountEl.textContent = `Due: ${dueLines.length} lines`;

    // Restart session with new filter
    sessionActive = false;
    awaitingUserMove = null;
    startSession();
  });
}

function updateScopeLabel() {
  const label = containerEl?.querySelector('.scope-label');
  if (!label) return;
  if (studyFilter) {
    label.textContent = `Tag: ${studyFilter}`;
  } else if (scopeFen) {
    label.textContent = 'Scope: Subtree';
  } else {
    label.textContent = 'Scope: All Lines';
  }
}

// ---------------------------------------------------------------------------
// Start Session
// ---------------------------------------------------------------------------

async function startSession() {
  sessionHistory = [];
  pivotCount = 0;
  sessionActive = true;

  // Load practiceDelay from settings
  const delaySetting = await db.get('settings', 'practiceDelay');
  practiceDelay = delaySetting ? delaySetting.value : 500;

  // Get due lines
  const dueLines = await sm2.getDueLines(scopeFen, colorFilter, studyFilter);

  if (dueLines.length === 0) {
    const sidebar = containerEl.querySelector('.practice-sidebar');
    if (sidebar) {
      sidebar.innerHTML =
        '<div class="all-caught-up"><h3>All caught up!</h3><p>No lines are due for review.</p></div>';
    }
    return;
  }

  // Pick a random due line
  pivoted = false;
  originalLine = null;
  await drillLine(dueLines[Math.floor(Math.random() * dueLines.length)]);
}

// ---------------------------------------------------------------------------
// Mount / Unmount lifecycle
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Test helpers (exported for testing only)
// ---------------------------------------------------------------------------

/**
 * Simulate a user move during practice (for testing).
 * Plays the move on the board and resolves the waiting promise.
 * @param {string} san
 * @returns {boolean} true if simulation succeeded
 */
export function _simulateUserMove(san) {
  if (!board || !awaitingUserMove) return false;
  // Play the move on the board (replicating what chessground handler does)
  const move = board.playMove(san);
  if (!move) return false;
  const resolve = awaitingUserMove;
  awaitingUserMove = null;
  resolve(san);
  return true;
}

/**
 * Wait until the practice engine is waiting for a user move.
 * @param {number} [timeout=5000]
 * @returns {Promise<boolean>} true if user turn is ready
 */
export function _waitForUserTurn(timeout = 5000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (awaitingUserMove) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 10);
      }
    };
    check();
  });
}

/**
 * Return a snapshot of internal state (for testing assertions).
 */
export function _getState() {
  return {
    currentLine,
    moveIndex,
    correctMoves,
    totalUserMoves,
    hintUsed,
    pivoted,
    originalLine,
    sessionHistory,
    pivotCount,
    sessionActive,
    board,
    userColor,
    awaitingUserMove: !!awaitingUserMove,
  };
}

/**
 * Wait until the drill completes (line result overlay is shown or session summary).
 * @param {number} [timeout=10000]
 * @returns {Promise<boolean>}
 */
export function _waitForLineComplete(timeout = 10000) {
  return new Promise((resolve) => {
    const start = Date.now();
    const check = () => {
      if (!containerEl) { resolve(false); return; }
      const overlay = containerEl.querySelector('.line-result-overlay');
      const summary = containerEl.querySelector('.session-summary-overlay');
      const allCaughtUp = containerEl.querySelector('.all-caught-up');
      if (overlay || summary || allCaughtUp) {
        resolve(true);
      } else if (Date.now() - start > timeout) {
        resolve(false);
      } else {
        setTimeout(check, 20);
      }
    };
    check();
  });
}

export default {
  /**
   * Mount the practice page into a container.
   * @param {HTMLElement} container
   * @param {Object} [params={}]
   * @param {string} [params.fen] — optional subtree scope
   * @param {string} [params.color] — optional color filter
   */
  async mount(container, params = {}) {
    containerEl = container;
    scopeFen = params.fen || null;
    colorFilter = params.color || null;
    studyFilter = params.study || null;

    // Build page HTML
    container.innerHTML = `
      <div class="practice-page">
        <div class="practice-header">
          <span class="scope-label">Scope: All Lines</span>
          <label class="study-filter-label">Tag:
            <select id="study-filter-select">
              <option value="">All Tags</option>
            </select>
          </label>
          <span class="due-count" id="due-count"></span>
        </div>
        <div class="practice-body">
          <div class="practice-board">
            <div class="board-container" id="practice-board-container"></div>
            <div class="practice-controls">
              <button id="btn-hint" class="btn-amber">Hint</button>
              <button id="btn-skip" class="btn-blue">Skip</button>
            </div>
          </div>
          <div class="practice-sidebar"></div>
        </div>
        <div id="practice-message" class="practice-message" style="display:none"></div>
      </div>
    `;

    // Create board
    const boardContainer = container.querySelector('#practice-board-container');
    board = createBoard(boardContainer, {
      color: 'white',
      movableColor: 'white',
      onMove: handleUserMove,
    });

    // Wire up buttons
    container
      .querySelector('#btn-hint')
      .addEventListener('click', handleHint);
    container
      .querySelector('#btn-skip')
      .addEventListener('click', handleSkip);

    // Populate study filter dropdown
    await populateStudyFilter();

    // Show due count
    const dueLines = await sm2.getDueLines(scopeFen, colorFilter, studyFilter);
    const dueCountEl = container.querySelector('#due-count');
    if (dueCountEl) dueCountEl.textContent = `Due: ${dueLines.length} lines`;

    // Start session (don't await — it blocks until all drills done)
    startSession();
  },

  /**
   * Unmount the practice page — clean up resources.
   */
  unmount() {
    sessionActive = false;
    awaitingUserMove = null;
    if (board) {
      board.destroy();
      board = null;
    }
    if (containerEl) {
      containerEl.innerHTML = '';
      containerEl = null;
    }
    currentLine = null;
    originalLine = null;
    studyFilter = null;
  },
};
