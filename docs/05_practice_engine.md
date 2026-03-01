# Design Doc 5: Practice Engine & Practice Page

**Module:** `js/pages/practice.js`
**Dependencies:** `js/board.js` (Doc 4), `js/dag.js` (Doc 2), `js/sm2.js` (Doc 3), `js/db.js` (Doc 1)
**Parallel with:** Doc 6 (Study Page), Doc 7 (Browse Page) — after Docs 1–4 are complete

---

## 1. Context

This is the core feature of the entire application. The Practice page drills the user on their opening lines using SM2 scheduling. The engine is aware of the full DAG — if the user plays a move belonging to a different line, the system handles it via **pivot logic** rather than simply marking it wrong.

### Architecture Position

```
  ──► practice.js ◄──   ← YOU ARE HERE
        │
  board.js (Doc 4) + dag.js (Doc 2) + sm2.js (Doc 3)
        │
      db.js (Doc 1)
```

---

## 2. Page Layout

```
┌──────────────────────────────────────────────────────────────────┐
│  Scope: [All Lines ▾]   Due: 5 lines   Color: White             │
│                                                                   │
│  ┌──────────────────────┐   ┌──────────────────────────────┐     │
│  │                      │   │  Current Line:                │     │
│  │                      │   │  Ruy Lopez > Berlin Defense   │     │
│  │     Chessground       │   │                              │     │
│  │       Board           │   │  Progress: ████░░░ 4/7 moves │     │
│  │                      │   │                              │     │
│  │                      │   │  Last move reason:            │     │
│  │                      │   │  "Develop knight to natural   │     │
│  │                      │   │   square, attack e5 pawn"    │     │
│  └──────────────────────┘   │                              │     │
│                              │  Status: Your move (White)   │     │
│  ┌────────────────────────┐ │                              │     │
│  │ Hint: show next move   │ │  ┌────────┐                 │     │
│  └────────────────────────┘ │  │ Skip   │                 │     │
│                              │  └────────┘                 │     │
│                              └──────────────────────────────┘     │
└──────────────────────────────────────────────────────────────────┘
```

---

## 3. Core Practice Flow

```
Given: A line L to practice (selected by SM2 scheduler or user)
       User's color C (from line record)

1. Set board to L.rootFen, oriented to color C
2. moveIndex = 0
3. While moveIndex < L.moves.length:
   a. currentFen = L.fens[moveIndex]
   b. expectedMove = L.moves[moveIndex]
   c. Determine who moves: sideToMove = (moveIndex % 2 == 0) ? "white" : "black"

   d. If sideToMove != C:
      // OPPONENT'S MOVE — auto-play
      - Wait `practiceDelay` ms (from settings, default 500ms)
      - Play expectedMove on the board automatically via board.playMove()
      - Show reason (if any) in sidebar
      - moveIndex += 1
      - Continue

   e. If sideToMove == C:
      // USER'S MOVE — wait for input
      - Wait for user to make a move on the board
      - userMove = the move the user played (in SAN)
      - Evaluate the move (see §4)
```

---

## 4. Move Evaluation — The Pivot Decision Tree

When the user plays a move during practice, evaluate it against the DAG, not just the current line.

```
Given: currentFen, userMove (SAN), expectedLine L, moveIndex

1. EXACT MATCH — userMove == L.moves[moveIndex]
   → Mark as CORRECT
   → Show reason from the edge
   → moveIndex += 1, continue the line

2. DAG MATCH — userMove != L.moves[moveIndex], BUT there exists an edge
   in the DAG from currentFen with moveSan == userMove
   → This means the user played a move belonging to a DIFFERENT line
   → Execute PIVOT LOGIC (see §5)

3. NO MATCH — userMove is a legal chess move but not in the DAG at all
   → Mark as INCORRECT
   → Highlight the expected move(s) on the board
   → Show the reason for the expected move
   → Record the error
   → Optionally: allow retry or auto-advance

4. ILLEGAL MOVE — chess.js rejects the move
   → Chessground won't allow it (prevented at board level)
```

**DAG lookup for case 2:** Use `dag.getChildren(currentFen)` and check if any returned edge has `moveSan === userMove`.

---

## 5. Pivot Logic — Handling Alternative Lines

When the user plays a move that matches a different line in the DAG (case 2 above), the system must decide what to do.

**Key insight:** The current line is already *due* — that's why the user is practicing it. So the current line's mastery status is irrelevant to the pivot decision. The only question is whether the **alternative line** the user's move belongs to is mastered or not.

```
Given: currentFen, userMove (matches edge E to childFen F),
       currentLine L (the line being practiced)

Step 1: Find alternative lines
   alternativeLines = all lines in `lines` store where:
     - fens[] contains currentFen
     - The move AFTER currentFen in the line's move sequence == userMove
     - line.id != L.id

Step 2: If no alternative lines found
   (Edge exists in DAG but no complete line passes through it)
   → Treat as CORRECT (the move is in the user's repertoire)
   → Show message: "Valid move, but no complete line continues from here."
   → Undo the move, replay from currentFen, prompt for the expected move

Step 3: If alternative lines found, check alternative line mastery

   altLineMastered = sm2.isLineMastered(A)
   // i.e., A.repetitions >= 3 AND A.easeFactor >= 2.0
   // If multiple alt lines, pick the best candidate first (see §6 selection)

   Case A — Alternative line IS mastered:
     → The user already knows this variation well.
     → Inform the user: "This variation ({alt line name}) is already mastered."
     → Undo the user's move on the board.
     → Prompt the user to think about the correct move for the current line.
     → Do NOT pivot; continue practicing the current (due) line.

   Case B — Alternative line is NOT mastered:
     → Silently pivot to the alternative line.
     → The user's move is accepted as CORRECT.
     → Continue the practice session along the alternative line.
     → Credit practice to the alternative line (see §6 for execution details).
```

---

## 6. Pivot Execution

When a silent pivot occurs (Case B above):

```
Algorithm:
1. Mark the user's move as CORRECT (it IS in the repertoire)
2. Select the best alternative line to pivot to:
   - Prefer the most overdue line
   - If multiple equally overdue, prefer the one with the lowest easeFactor
     (hardest for the user)
   - If still tied, pick the longest line (more practice value)
3. pivotLine = selected alternative line
4. Find the moveIndex in pivotLine.fens[] that corresponds to the NEXT position
   (the childFen after the user's move)
5. Continue the practice session using pivotLine from that moveIndex onward
6. At the end of the session:
   - The ORIGINAL line L is NOT updated — it stays untouched
     (it will remain due and be presented again in a future session)
   - Grade ONLY the PIVOT line for the full set of moves the user played on it
     - Full SM2 update based on accuracy in the pivoted segment
```

---

## 7. Prompt UI

When the user plays a move matching a **mastered** alternative line (§5, Case A), show an info message and undo:

```
┌──────────────────────────────────────────────┐
│  ℹ️  Already Mastered                        │
│                                               │
│  You played: Nf3 (Italian Game)              │
│  But this variation is already mastered.      │
│                                               │
│  Think about the correct move for the         │
│  current line (Ruy Lopez).                    │
│                                               │
│  [The move is undone automatically]           │
│                                               │
└──────────────────────────────────────────────┘
```

When the alternative line is **not mastered** (§5, Case B), no prompt is shown — the pivot happens silently.

---

## 8. Page Behavior

1. **Scope selection:** Dropdown to choose scope — "All Lines", or any named node/subtree from the Browse page. URL parameter `?fen=...` pre-selects scope.
2. **Color filter:** Optional filter by study color.
3. **Line selection:** Use `sm2.getDueLines(subtreeFen, color)` to pick the most overdue line. If no lines are due, show "All caught up!" message.
4. **Move-by-move drill:** As described in §3.
5. **Hint button:** Shows the first letter of the piece/square, or highlights the destination square. Marks `hintUsed = true` for quality calculation.
6. **Skip button:** Marks the line with quality 0 via `sm2.gradeLine(lineId, 0)` and moves to the next due line.
7. **End of line:** Show the line result screen (§8.1), apply SM2 grade via `sm2.gradeLine()` or auto-calculate via `sm2.autoQuality()`. Wait for user to click "Next Line" or "End Practice".
8. **Session end:** Show summary (§9) when all due lines are reviewed OR when user clicks "End Practice".

### 8.1 Line Result Screen

Shown at the end of each completed line (or pivoted line):

```
┌──────────────────────────────────────────────┐
│                                               │
│  Line: Ruy Lopez > Berlin Defense             │
│                                               │
│  Score: 83%                                   │
│  (5 / 6 moves correct)                        │
│                                               │
│  ┌────────────┐   ┌────────────────┐          │
│  │ Next Line  │   │ End Practice   │          │
│  └────────────┘   └────────────────┘          │
│                                               │
└──────────────────────────────────────────────┘
```

- **Score** = `Math.round((correctMoves / totalMoves) * 100)` displayed as a percentage.
- **Next Line** → picks the next due line via `sm2.getDueLines()` and starts a new drill. If no more lines are due, goes directly to the session summary (§9).
- **End Practice** → stops the session immediately and shows the session summary (§9).

---

## 9. Practice Session Summary

After all lines in a practice session are completed:

```
┌──────────────────────────────────────────────┐
│  📊 Practice Summary                         │
│                                               │
│  Lines reviewed: 8                            │
│  Pivots taken: 2                              │
│  Overall accuracy: 85%                        │
│                                               │
│  Line Results:                                │
│  ✓ Ruy Lopez > Berlin         — Grade 5 (↑)  │
│  ✓ Italian Game > Giuoco      — Grade 4 (↑)  │
│  ✗ Sicilian > Najdorf         — Grade 2 (↓)  │
│  ...                                          │
│                                               │
│  Next reviews:                                │
│  • Sicilian > Najdorf: tomorrow               │
│  • Italian Game > Evans: in 3 days            │
│  • Ruy Lopez > Berlin: in 12 days             │
│                                               │
│  ┌──────────────┐                             │
│  │ Practice More │                            │
│  └──────────────┘                             │
└──────────────────────────────────────────────┘
```

---

## 10. Edge Cases

| Scenario | Behavior |
|----------|----------|
| User plays a move not in DAG but it's a known good move | Mark incorrect — only repertoire moves are accepted. The system drills what the user has studied. |
| Multiple alternative lines branch from the same move | Pick the best candidate per §6 selection criteria. If the selected alt line is mastered, inform and undo; if not, silently pivot. |
| User pivots, then plays another move matching yet another line | Allow chained pivots — the practice engine always evaluates against the full DAG |
| The pivot line has already been reviewed today | Still allow pivot, but SM2 update uses the new session's quality |
| Line has only opponent moves left after pivot point | Auto-play remaining moves, mark as complete |
| Alt line is mastered and move is undone | The user is expected to play the correct move for the current (due) line. If they play the same alt move again, show the same mastered message and undo again. |

---

## 11. Pivot Logic Worked Example

**Setup:** User has two lines stored:
- **Line A:** 1. e4 e5 2. Nf3 Nc6 3. **Bb5** (Ruy Lopez) — mastered (reps=5, EF=2.6)
- **Line B:** 1. e4 e5 2. Nf3 Nc6 3. **Bc4** (Italian Game) — not mastered (reps=1, EF=2.3)

**User is practicing Line A (it's due):**

1. System auto-plays: 1. e4
2. User plays: 1...e5 ✓ (matches Line A)
3. System auto-plays: 2. Nf3
4. User plays: 2...Nc6 ✓ (matches Line A)
5. System expects: 3. Bb5 (Ruy Lopez)
6. **User plays: 3. Bc4** (Italian Game move)

**Evaluation:**
- `Bc4` ≠ `Bb5` — not exact match
- DAG lookup: edge from current FEN with `moveSan == "Bc4"` exists → Line B
- Is Line B mastered? reps=1, EF=2.3 → `isLineMastered = false`
- **Decision: Case B → Silent pivot to Line B**
- User's `Bc4` is accepted as CORRECT
- Practice continues along Line B from move 3 onward

**If Line B were mastered (reps=5, EF=2.6):**
- `isLineMastered = true`
- **Decision: Case A → Inform and undo**
- Show "This variation (Italian Game) is already mastered"
- Undo `Bc4` on the board
- Wait for user to play `Bb5` (the expected move for Line A)

---

## 12. Page Lifecycle

```javascript
// practice.js — ES module
export default {
    mount(container, params) {
        // params.fen — optional subtree scope
        // 1. Create board via board.createBoard()
        // 2. Load due lines via sm2.getDueLines()
        // 3. Start first line drill
    },
    unmount() {
        // Destroy board, clean up listeners, save pending state
    }
};
```

---

## 13. Testing Checklist

- [ ] Line selected from SM2 scheduler starts correctly on the board
- [ ] Opponent moves auto-play after the configured delay
- [ ] Correct user move: green highlight, reason shown, advance
- [ ] Incorrect user move (not in DAG): red highlight, correct move shown
- [ ] DAG match triggers pivot logic
- [ ] Pivot Case A (alt mastered): info message shown, move undone, user must play expected move
- [ ] Pivot Case B (alt not mastered): silent pivot, move accepted, practice continues on alt line
- [ ] Chained pivots work across multiple divergence points
- [ ] Alt mastered undo: replaying the same alt move shows the same message again
- [ ] Hint button reveals partial info and marks `hintUsed = true`
- [ ] Skip button grades line with quality 0 and advances
- [ ] SM2 grade applied correctly at end of line
- [ ] Partial grading: pivot before 50% → no SM2 update on original line
- [ ] Session summary shows correct statistics
- [ ] Scope filter (by subtree FEN) limits which lines are practiced
- [ ] "All caught up!" shown when no lines are due
