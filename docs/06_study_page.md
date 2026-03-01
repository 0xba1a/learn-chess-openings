# Design Doc 6: Study Page

**Module:** `js/pages/study.js`
**Dependencies:** `js/board.js` (Doc 4), `js/dag.js` (Doc 2), `js/db.js` (Doc 1)
**Parallel with:** Doc 5 (Practice Engine), Doc 7 (Browse Page)

---

## 1. Context

The Study page is where the user feeds in new opening lines by making moves on an interactive board. For each move, the user can annotate a reason explaining why that move is played. The system detects when moves overlap with existing lines in the DAG and shows branching status.

### Architecture Position

```
  ──► study.js ◄──   ← YOU ARE HERE
        │
  board.js (Doc 4) + dag.js (Doc 2)
        │
      db.js (Doc 1)
```

---

## 2. Page Layout

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐   ┌──────────────────────────────┐   │
│  │                      │   │  Color: ○ White  ● Black     │   │
│  │                      │   │                              │   │
│  │     Chessground       │   │  Move List:                  │   │
│  │       Board           │   │  (moves before start pos     │   │
│  │                      │   │   shown greyed out)           │   │
│  │                      │   │  1. e4    e5                  │   │
│  │                      │   │  2. Nf3   Nc6                │   │
│  │                      │   │  ── Start Position ──        │   │
│  │                      │   │  3. Bb5   (reason: ...)  ✎  │   │
│  └──────────────────────┘   │     a6    (reason: ...)  ✎  │   │
│                              │  4. Ba4   (reason: ...)  ✎  │   │
│  ┌──────┐ ┌──────┐          │                              │   │
│  │ Undo │ │ Redo │          │  ┌─────────────────────────┐ │   │
│  └──────┘ └──────┘          │  │ Reason for current move │ │   │
│                              │  │ [text input area       ]│ │   │
│  ┌──────────────────────┐   │  └─────────────────────────┘ │   │
│  │ Mark Starting Pos.   │   │                              │   │
│  └──────────────────────┘   │  ┌──────────┐ ┌───────────┐ │   │
│                              │  │ Save Line│ │ Clear     │ │   │
│  Status: "Starting pos.      │  └──────────┘ └───────────┘ │   │
│  set at move 2 (after Nc6)" │                              │   │
│                              └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

---

## 3. Behavior

### 3.1 Color Selection
- User selects their study color (White or Black) via radio buttons at the top-right.
- Board orientation adjusts to match the selected color via `board.setOrientation()`.

### 3.2 Move Input
- User makes moves for **BOTH sides** on the board — the board's `movableColor` should be `'both'`.
- Each move appears in the Move List on the right panel as it is played.
- Moves are displayed in standard chess notation: `1. e4 e5 2. Nf3 Nc6 ...`
- Moves made **before** the starting position is marked are shown greyed out (they are setup moves, not part of the saved line).
- Moves made **after** the starting position are the actual line — these are the ones that get reasons and are saved.

### 3.3 Mark Starting Position
- **Mark Starting Position** button captures the current board position as the root of the line.
- Default state: the starting position is the standard chess starting position (no moves needed).
- The user can make a sequence of moves to reach a desired position, then click "Mark Starting Position".
- When clicked:
  - `startingFen` is set to the current board FEN.
  - All moves made so far are recorded as "setup moves" — shown greyed out in the Move List, separated by a `── Start Position ──` divider.
  - The Move List clears the active (saveable) moves and reasons.
  - Status shows: "Starting position set at move N (after {lastMove})".
- The button can be clicked again to re-mark a different starting position. This re-partitions setup vs. active moves.
- **Undo past the starting position:** If the user undoes moves back past the marked starting position, the starting position reverts to the standard starting position and all existing moves become active/saveable again.
- **Constraint:** Cannot mark starting position if there are already active moves with reasons entered. Show a warning: "Clear active moves first, or use Undo."

### 3.4 Reason Annotation
- After each move, a text input area appears prompting the user to type the reason for that move.
- The reason can be left empty.
- The ✎ (edit) button next to each move in the Move List allows editing the reason retroactively.
- Press Enter or click away (blur) to confirm the reason.

### 3.5 Undo / Redo
- **Undo** button (and keyboard shortcut Ctrl+Z): calls `board.undoMove()`, removes the last move from the Move List. The reason for that move is preserved in a redo stack.
- **Redo** button (and keyboard shortcut Ctrl+Y): replays the undone move, restores its reason.
- Undo/Redo operate as a standard linear stack.

### 3.6 Branch Detection
After each move, check if the current FEN already exists in the DAG:

```
Algorithm:
1. currentFen = normalizeFen(board.chess.fen())
2. existingChildren = await dag.getChildren(currentFen)
3. If existingChildren.length > 0:
   - Show status: "Position exists in repertoire. Existing moves: Bb5 (Ruy Lopez), Bc4 (Italian)."
   - This informs the user they are in known territory and shows what branches already exist.
4. If the user just played a move that is NOT among the existing children:
   - Show status: "New branch from existing position."
   - This means the user is adding a new variation from a known position.
```

### 3.7 Save Line
- **Save Line** button calls `dag.addLine(startingFen, moves, color, reasons)` — where `startingFen` is the marked starting position and `moves`/`reasons` are only the active moves (after the starting position).
- On success: show confirmation message ("Line saved!"), then reset the board and Move List.
- **Validation:**
  - Cannot save an empty line (no moves made).
  - Warn if saving a line identical to an existing one (same sequence of FENs).

### 3.8 Clear
- **Clear** button resets the board to the standard starting position, clears the Move List (both setup and active moves), resets `startingFen` to the standard starting position, and clears all reasons. No confirmation needed (no data is lost — nothing was saved yet).

---

## 4. Internal State

The page must track:

```javascript
let studyColor = 'white';       // Selected study color
let startingFen = 'rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq - 0 1'; // Marked starting position
let setupMoves = [];             // Moves made before marking starting position (greyed out)
let moves = [];                  // Active moves AFTER starting position (these get saved)
let reasons = [];                // Reason strings, parallel to moves[]
let undoStack = [];              // Stack of { move, reason, isSetup } for redo
```

When the `onMove` callback fires from the board:
1. Push `move.san` to `moves`
2. Push `""` (empty) to `reasons` (the user can fill it in)
3. Clear the `undoStack` (new move invalidates the redo stack)
4. Run branch detection
5. Focus the reason input for the new move

---

## 5. Page Lifecycle

```javascript
// study.js — ES module
export default {
    mount(container, params) {
        // 1. Render the HTML layout into container
        // 2. Create board via board.createBoard(boardEl, { movableColor: 'both', onMove: handleMove })
        // 3. Set up event listeners for color radio, undo, redo, save, clear
    },
    unmount() {
        // Destroy board, clean up listeners
        // Do NOT auto-save — unsaved work is lost (by design, since nothing goes to DB until Save)
    }
};
```

---

## 6. Testing Checklist

- [ ] Board renders with both colors movable
- [ ] Selecting "Black" flips the board orientation
- [ ] Each move appears in the Move List with correct notation
- [ ] Reason text input appears after each move
- [ ] Editing a previous reason via ✎ button works
- [ ] Undo removes the last move and updates the board
- [ ] Redo replays an undone move
- [ ] Ctrl+Z and Ctrl+Y keyboard shortcuts work
- [ ] Branch detection shows existing moves when position is in DAG
- [ ] "New branch" status shown when move diverges from existing lines
- [ ] Mark Starting Position captures the current FEN
- [ ] Setup moves (before start pos) shown greyed out with divider
- [ ] Active moves (after start pos) shown with reason inputs
- [ ] Re-marking starting position re-partitions setup vs. active moves
- [ ] Undo past starting position reverts to standard start
- [ ] Save Line calls `dag.addLine(startingFen, moves, color, reasons)` with correct arguments
- [ ] Cannot save an empty line (no active moves after starting position)
- [ ] Warning shown when saving a duplicate line
- [ ] Clear resets the board, starting position, and move list
- [ ] Board is destroyed on page unmount
