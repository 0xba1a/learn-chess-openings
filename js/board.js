// board.js — Board Integration module (ES module)
//
// Wraps chessground + chess.js into a reusable board component.
// No IndexedDB dependency — pure UI/logic wrapper.

import { Chessground } from '../lib/chessground.min.js';
import { Chess } from '../lib/chess.min.js';

// ---------------------------------------------------------------------------
// Helper: compute legal destinations for chessground
// ---------------------------------------------------------------------------

/**
 * Build a Map<square, square[]> of legal moves from the chess.js instance.
 * @param {Chess} chess
 * @returns {Map<string, string[]>}
 */
function legalDests(chess) {
  const dests = new Map();
  for (const move of chess.moves({ verbose: true })) {
    if (!dests.has(move.from)) {
      dests.set(move.from, []);
    }
    dests.get(move.from).push(move.to);
  }
  return dests;
}

// ---------------------------------------------------------------------------
// Promotion UI
// ---------------------------------------------------------------------------

/**
 * Check if a move is a pawn promotion.
 * @param {Chess} chess
 * @param {string} orig
 * @param {string} dest
 * @returns {boolean}
 */
function isPromotion(chess, orig, dest) {
  const moves = chess.moves({ verbose: true });
  return moves.some(
    (m) => m.from === orig && m.to === dest && m.promotion
  );
}

/**
 * Show a promotion dialog and return the chosen piece.
 * @param {string} color — 'w' or 'b'
 * @param {HTMLElement} containerEl
 * @returns {Promise<string>} 'q', 'r', 'b', or 'n'
 */
function showPromotionDialog(color, containerEl) {
  return new Promise((resolve) => {
    const overlay = document.createElement('div');
    overlay.className = 'promotion-overlay';
    overlay.style.cssText =
      'position:absolute;top:0;left:0;width:100%;height:100%;' +
      'background:rgba(0,0,0,0.5);display:flex;justify-content:center;' +
      'align-items:center;z-index:1000;';

    const dialog = document.createElement('div');
    dialog.style.cssText =
      'background:#fff;border-radius:8px;padding:12px;display:flex;gap:8px;';

    const pieces = ['q', 'r', 'b', 'n'];
    const pieceNames = { q: 'Queen', r: 'Rook', b: 'Bishop', n: 'Knight' };

    for (const piece of pieces) {
      const btn = document.createElement('button');
      btn.textContent = pieceNames[piece];
      btn.style.cssText =
        'padding:8px 12px;font-size:16px;cursor:pointer;border:1px solid #ccc;' +
        'border-radius:4px;background:#f0f0f0;';
      btn.addEventListener('click', () => {
        overlay.remove();
        resolve(piece);
      });
      dialog.appendChild(btn);
    }

    overlay.appendChild(dialog);
    containerEl.style.position = 'relative';
    containerEl.appendChild(overlay);
  });
}

// ---------------------------------------------------------------------------
// createBoard
// ---------------------------------------------------------------------------

/**
 * Create a board instance wrapping chessground + chess.js.
 *
 * @param {HTMLElement} containerEl — DOM element to mount the board in
 * @param {Object} [options={}]
 * @param {string} [options.color='white'] — board orientation
 * @param {string} [options.movableColor='both'] — which side can move
 * @param {Function} [options.onMove=null] — callback(moveObj) after a legal move
 * @param {string} [options.fen] — initial FEN (defaults to standard start)
 * @returns {Object} board instance
 */
export function createBoard(containerEl, options = {}) {
  const fen = options.fen || 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1';
  const chess = new Chess(fen);
  const orientation = options.color || 'white';
  let movableColor = options.movableColor || 'both';
  const onMove = options.onMove || null;

  // Track custom highlights
  let customHighlights = [];

  const ground = Chessground(containerEl, {
    fen: chess.fen(),
    orientation,
    turnColor: chess.turn() === 'w' ? 'white' : 'black',
    movable: {
      free: false,
      color: movableColor,
      dests: legalDests(chess),
    },
    events: {
      move: async (orig, dest) => {
        // Handle promotion
        if (isPromotion(chess, orig, dest)) {
          const piece = await showPromotionDialog(chess.turn(), containerEl);
          try {
            const move = chess.move({ from: orig, to: dest, promotion: piece });
            if (move) {
              updateGround();
              if (onMove) onMove(move);
            }
          } catch {
            // Invalid move — ignore
          }
        } else {
          try {
            const move = chess.move({ from: orig, to: dest });
            if (move) {
              updateGround();
              if (onMove) onMove(move);
            }
          } catch {
            // Invalid move — ignore
          }
        }
      },
    },
  });

  /**
   * Sync chessground state with chess.js state.
   */
  function updateGround() {
    ground.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      movable: {
        dests: legalDests(chess),
      },
      check: chess.isCheck(),
    });
  }

  // -- Board instance methods --

  /**
   * Reset both chess.js and chessground to a FEN.
   * @param {string} newFen
   */
  function setPosition(newFen) {
    chess.load(newFen);
    ground.set({
      fen: chess.fen(),
      turnColor: chess.turn() === 'w' ? 'white' : 'black',
      lastMove: undefined,
      movable: {
        dests: legalDests(chess),
      },
      check: chess.isCheck(),
    });
  }

  /**
   * Flip the board orientation.
   * @param {string} color — 'white' or 'black'
   */
  function setOrientation(color) {
    ground.set({ orientation: color });
  }

  /**
   * Programmatically play a move (e.g., auto-play opponent's move).
   * @param {string} san — SAN notation, e.g. 'Nf3'
   * @returns {Object|null} the chess.js move object, or null if illegal
   */
  function playMove(san) {
    let move;
    try {
      move = chess.move(san);
    } catch {
      return null;
    }
    if (!move) return null;
    ground.move(move.from, move.to);
    updateGround();
    return move;
  }

  /**
   * Undo the last move.
   * @returns {Object|null} the undone move, or null
   */
  function undoMove() {
    const move = chess.undo();
    if (!move) return null;
    updateGround();
    ground.set({ lastMove: undefined });
    return move;
  }

  /**
   * Add visual markers to squares.
   * @param {string[]} squares — e.g. ['e4', 'f3']
   * @param {string} className — CSS class, e.g. 'hint' or 'error'
   */
  function highlightSquares(squares, className) {
    // Store for later clearing
    for (const sq of squares) {
      customHighlights.push({ sq, className });
    }

    // Use chessground's drawable shapes API for highlights
    const shapes = squares.map((sq) => ({
      orig: sq,
      brush: className,
    }));

    // Merge with existing auto-shapes
    const existing = ground.state.drawable.autoShapes || [];
    ground.setAutoShapes([...existing, ...shapes]);
  }

  /**
   * Remove all custom highlights.
   */
  function clearHighlights() {
    customHighlights = [];
    ground.setAutoShapes([]);
  }

  /**
   * Set which color the user can move.
   * @param {string} color — 'white', 'black', or 'both'
   */
  function setMovableColor(color) {
    movableColor = color;
    ground.set({
      movable: {
        color: movableColor,
        dests: legalDests(chess),
      },
    });
  }

  /**
   * Enable/disable user moves.
   * @param {boolean} enabled
   */
  function setInteractive(enabled) {
    ground.set({
      movable: {
        color: enabled ? movableColor : undefined,
        dests: enabled ? legalDests(chess) : new Map(),
      },
    });
  }

  /**
   * Clean up the chessground instance.
   */
  function destroy() {
    ground.destroy();
  }

  return {
    chess,
    ground,
    setPosition,
    setOrientation,
    playMove,
    undoMove,
    highlightSquares,
    clearHighlights,
    setMovableColor,
    setInteractive,
    destroy,
  };
}
