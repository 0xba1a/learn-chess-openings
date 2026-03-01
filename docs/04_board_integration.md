# Design Doc 4: Board Integration

**Module:** `js/board.js`
**Dependencies:** `lib/chessground.min.js`, `lib/chess.min.js` (vendored libraries)
**Parallel with:** Docs 1, 2, 3 — fully independent (no IndexedDB dependency)

---

## 1. Context

You are building a reusable board module that wraps **chessground** (Lichess's board rendering library) with **chess.js** (for move legality and game state). Every page that shows a chessboard (Study, Browse, Practice) will use your module.

Your module is a **pure UI/logic wrapper** — it does not interact with IndexedDB or any data stores. It accepts configuration, renders a board, and emits events when moves happen.

### Architecture Position

```
Pages (study, browse, practice)
        │
  ──► board.js ◄──   ← YOU ARE HERE
        │
  chessground + chess.js (vendored libs in lib/)
```

### Libraries

- **chessground** — SVG-based interactive chessboard. Handles drag-and-drop, animations, orientation, highlights. [GitHub: lichess-org/chessground](https://github.com/lichess-org/chessground)
- **chess.js** — Chess game logic: legal move generation, FEN parsing, move validation, check/checkmate detection. [GitHub: jhlywa/chess.js](https://github.com/jhlywa/chess.js)

Both are already vendored into `lib/` as ES module bundles. Import them directly:

```javascript
import { Chessground } from '../lib/chessground.min.js';
import { Chess } from '../lib/chess.min.js';
```

---

## 2. Initialization

### `createBoard(containerEl, options = {})`

Creates and returns a board instance combining chessground + chess.js.

```javascript
// Pseudo-code for board setup
function createBoard(containerEl, options = {}) {
    const chess = new Chess();  // chess.js instance
    const ground = Chessground(containerEl, {
        fen: chess.fen(),
        orientation: options.color || 'white',
        movable: {
            free: false,
            color: options.movableColor || 'both',
            dests: legalDests(chess),  // computed from chess.js
        },
        events: {
            move: (orig, dest) => {
                // Validate and apply move via chess.js
                const move = chess.move({ from: orig, to: dest, promotion: 'q' });
                if (move) {
                    options.onMove?.(move);
                    ground.set({ fen: chess.fen(), movable: { dests: legalDests(chess) } });
                }
            }
        }
    });

    return { chess, ground, /* helper methods */ };
}
```

**Options:**

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| `color` | `string` | `'white'` | Board orientation |
| `movableColor` | `string` | `'both'` | Which side the user can move pieces for. `'white'`, `'black'`, or `'both'`. |
| `onMove` | `function` | `null` | Callback fired after a legal move. Receives the chess.js move object `{ from, to, san, color, ... }`. |
| `fen` | `string` | standard start | Initial position |

---

## 3. Helper Functions

| Function | Description |
|----------|-------------|
| `legalDests(chess)` | Compute a `Map<square, square[]>` of legal moves for chessground's `movable.dests` |
| `setPosition(fen)` | Reset both chess.js and chessground to a FEN |
| `setOrientation(color)` | Flip the board (`'white'` or `'black'`) |
| `playMove(san)` | Programmatically play a move (for auto-playing opponent's moves). Returns the chess.js move object or `null` if illegal. |
| `undoMove()` | Undo the last move in chess.js and update chessground |
| `highlightSquares(squares, className)` | Add visual markers to squares (for hints, errors). `squares` is an array of square names like `['e4', 'f3']`. `className` is a CSS class like `'hint'` or `'error'`. |
| `clearHighlights()` | Remove all highlights |
| `setInteractive(boolean)` | Enable/disable user moves (used during opponent's auto-play to prevent user interaction) |
| `destroy()` | Clean up the chessground instance and event listeners (called on page unmount) |

### `legalDests(chess)` Implementation Detail

Chessground expects a `Map` where keys are origin squares and values are arrays of destination squares. Compute this from chess.js:

```javascript
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
```

---

## 4. Promotion Handling

When a pawn reaches the promotion rank, show a promotion chooser UI (Queen, Rook, Bishop, Knight). Chessground supports this natively via the `premovable` config. Default to Queen auto-promotion with an option to choose.

**Implementation approach:**
1. Detect when a move is a pawn reaching rank 1 or 8
2. Show a promotion dialog (4 piece icons to choose from)
3. Apply the selected promotion piece to `chess.move()`
4. Update chessground with the new position

---

## 5. Module Interface Summary

```javascript
// board.js — ES module
import { Chessground } from '../lib/chessground.min.js';
import { Chess } from '../lib/chess.min.js';

export function createBoard(containerEl, options) { /* returns board instance */ }

// Board instance methods (returned from createBoard):
// board.setPosition(fen)
// board.setOrientation(color)
// board.playMove(san) → move object | null
// board.undoMove()
// board.highlightSquares(squares, className)
// board.clearHighlights()
// board.setInteractive(boolean)
// board.destroy()
// board.chess  — direct access to chess.js instance
// board.ground — direct access to chessground instance
```

---

## 6. CSS Dependencies

The following CSS files must be loaded for chessground to render correctly (handled by Doc 8: App Shell):

```
css/chessground.base.css     # Base chessground styles (required)
css/chessground.brown.css    # Board color theme
css/chessground.cburnett.css # Piece set theme (CBurnett SVGs)
```

The board container element must have explicit `width` and `height` (chessground requires this):

```css
.board-container {
    width: 400px;
    height: 400px;
}
```

---

## 7. Testing Checklist

- [ ] `createBoard` renders a chessboard in the provided container element
- [ ] Board shows the correct starting position by default
- [ ] User can drag and drop pieces; only legal moves are allowed
- [ ] `onMove` callback fires with the correct move object after a legal move
- [ ] `setPosition(fen)` updates both the visual board and internal chess.js state
- [ ] `setOrientation('black')` flips the board
- [ ] `playMove('Nf3')` executes the move programmatically and updates the board
- [ ] `playMove` returns `null` for illegal moves
- [ ] `undoMove()` reverts the last move visually and logically
- [ ] `highlightSquares(['e4'], 'hint')` adds visual markers to the square
- [ ] `clearHighlights()` removes all markers
- [ ] `setInteractive(false)` prevents user from making moves
- [ ] `setInteractive(true)` re-enables moves
- [ ] Promotion: moving a pawn to the 8th rank triggers promotion UI
- [ ] `destroy()` cleans up without errors
- [ ] Multiple board instances can coexist on the same page (Study has full board, Browse has mini-board)
