# Chess Opening Trainer — Design Document v1.0

**Date:** March 1, 2026
**Status:** Draft
**Architecture:** Fully offline browser PWA — Vanilla JS + Chessground + chess.js + IndexedDB

---

## Table of Contents

1. [Overview](#1-overview)
2. [Goals & Non-Goals](#2-goals--non-goals)
3. [Architecture](#3-architecture)
4. [Project Structure](#4-project-structure)
5. [Data Model](#5-data-model)
6. [FEN Normalization](#6-fen-normalization)
7. [DAG Operations](#7-dag-operations)
8. [SM2 Spaced Repetition](#8-sm2-spaced-repetition)
9. [Practice Engine — Pivot & Prompt Logic](#9-practice-engine--pivot--prompt-logic)
10. [Pages](#10-pages)
11. [Board Integration](#11-board-integration)
12. [SPA Routing](#12-spa-routing)
13. [Offline & PWA](#13-offline--pwa)
14. [Data Portability](#14-data-portability)
15. [Deployment](#15-deployment)
16. [Open Questions & Future Work](#16-open-questions--future-work)

---

## 1. Overview

A fully offline, browser-based chess opening trainer. The user feeds in opening lines they learn (from books, courses, videos) by making moves on an interactive board, annotating each half-move with a reason. The system stores all studied lines in a **directed acyclic graph (DAG)** keyed by normalized FEN. Positions shared across lines are merged automatically (transpositions). The user practices lines via **SM2 spaced repetition**, with the system auto-playing the opponent's side and evaluating the user's moves.

**Key differentiator:** No pre-loaded database. Every opening line is manually curated by the user. The system is a personal repertoire builder and drill tool, not a generic opening explorer.

---

## 2. Goals & Non-Goals

### Goals

| # | Goal |
|---|------|
| G1 | User can input opening lines by making moves on a visual board, annotating each half-move with a reason |
| G2 | Lines are stored as a FEN-keyed DAG; shared prefixes/transpositions merge into shared nodes |
| G3 | User can name any node (opening name, variation, sub-variation); a node's full name is the concatenation of all ancestor names |
| G4 | SM2 spaced repetition schedules line reviews; each line is one SM2 item |
| G5 | During practice, if the user plays a valid move belonging to a different line in the DAG, the system accepts it and pivots to that line (see §9) |
| G6 | The system prompts the user to try alternative variations that are overdue for review (see §9) |
| G7 | User can select any node/subtree to scope practice to that portion of the repertoire |
| G8 | Fully offline after first load — no server, no login, no external API calls |
| G9 | Data stored in IndexedDB; exportable/importable as JSON for backup |
| G10 | Deployable as static files to GitHub Pages / Netlify / Vercel |

### Non-Goals

| # | Non-Goal |
|---|---------|
| NG1 | Engine evaluation or Stockfish integration (user provides their own reasoning) |
| NG2 | Multiplayer or social features |
| NG3 | Auto-importing from Lichess/Chess.com/PGN databases |
| NG4 | User accounts or server-side storage (future: Google Drive sync) |
| NG5 | Mobile-native app (PWA suffices) |

---

## 3. Architecture

```
┌─────────────────────────────────────────────────────┐
│                    Browser (PWA)                     │
│                                                      │
│  ┌──────────┐  ┌──────────┐  ┌──────────┐           │
│  │  Study    │  │  Browse   │  │ Practice │           │
│  │  Page     │  │  Page     │  │  Page    │           │
│  └────┬─────┘  └────┬─────┘  └────┬─────┘           │
│       │              │              │                 │
│  ┌────┴──────────────┴──────────────┴─────┐          │
│  │              app.js (SPA Router)        │          │
│  └────┬──────────────┬──────────────┬─────┘          │
│       │              │              │                 │
│  ┌────┴────┐   ┌─────┴────┐  ┌─────┴─────┐          │
│  │ board.js│   │  dag.js   │  │  sm2.js   │          │
│  │(ground +│   │(DAG ops)  │  │(scheduler)│          │
│  │chess.js)│   └─────┬─────┘  └─────┬─────┘          │
│  └─────────┘         │              │                 │
│                 ┌────┴──────────────┴─────┐          │
│                 │        db.js             │          │
│                 │   (IndexedDB wrapper)    │          │
│                 └────────────┬────────────┘          │
│                              │                       │
│                    ┌─────────┴─────────┐             │
│                    │    IndexedDB       │             │
│                    │  (nodes, edges,    │             │
│                    │   lines, settings) │             │
│                    └───────────────────┘             │
│                                                      │
│  ┌───────────────────────────────────────┐           │
│  │  Service Worker (sw.js) — cache all   │           │
│  │  assets for offline-first operation   │           │
│  └───────────────────────────────────────┘           │
└─────────────────────────────────────────────────────┘
```

**Layers:**

1. **Pages** — UI components for each screen (Study, Browse, Practice, Manage)
2. **Core modules** — `board.js` (rendering + move logic), `dag.js` (graph operations), `sm2.js` (scheduling)
3. **Storage** — `db.js` wraps IndexedDB with a promise-based API
4. **Offline** — Service worker caches all static assets; PWA manifest enables "Add to Home Screen"

**No build step.** All JS uses ES modules (`<script type="module">`). Libraries are vendored into `lib/`.

---

## 4. Project Structure

```
/
├── index.html                     # SPA shell, nav bar, page container
├── manifest.json                  # PWA manifest (name, icons, theme)
├── sw.js                          # Service worker — cache-first strategy
├── css/
│   ├── style.css                  # App layout, nav, typography, theme
│   ├── chessground.base.css       # Vendored chessground base styles
│   ├── chessground.brown.css      # Board color theme
│   └── chessground.cburnett.css   # Piece set theme (CBurnett SVGs)
├── js/
│   ├── app.js                     # SPA router, nav controller, page lifecycle
│   ├── db.js                      # IndexedDB wrapper (open, get, put, getAll, delete, query by index)
│   ├── dag.js                     # DAG operations (addLine, getChildren, getSubtree, getFullName, etc.)
│   ├── fen.js                     # FEN normalization utility
│   ├── sm2.js                     # SM2 algorithm + due-line queries
│   ├── board.js                   # Chessground + chess.js integration
│   ├── utils.js                   # Shared helpers
│   └── pages/
│       ├── study.js               # Feed-in page: board + reason annotations
│       ├── browse.js              # DAG tree explorer, node naming
│       ├── practice.js            # SM2-driven quiz with pivot logic
│       └── manage.js              # Export / import / clear data
├── lib/
│   ├── chessground.min.js         # Vendored chessground ESM bundle
│   ├── chess.min.js               # Vendored chess.js ESM bundle
│   └── assets/                    # Piece SVGs for chessground
│       ├── wK.svg, wQ.svg, ...    # White pieces
│       └── bK.svg, bQ.svg, ...    # Black pieces
└── docs/
    └── design_document_alt.md     # This file
```

---

## 5. Data Model

All data lives in **IndexedDB**, database name: `chess-opening-trainer`, version `1`.

### 5.1 Object Store: `nodes`

Each node represents a unique chess position in the user's repertoire.

| Field | Type | Description |
|-------|------|-------------|
| `fen` | `string` (PK) | Normalized FEN (see §6). Primary key. |
| `name` | `string \| null` | User-given name for this position (e.g., "Ruy Lopez", "Berlin Defense") |
| `notes` | `string` | Free-text notes about this position |
| `createdAt` | `number` | Unix timestamp (ms) when the node was first created |

**Indexes:**
- Primary key: `fen` (unique, inline)

### 5.2 Object Store: `edges`

Each edge represents a move connecting two positions in the DAG.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` (PK) | Auto-increment primary key |
| `parentFen` | `string` | Normalized FEN of the position before the move |
| `childFen` | `string` | Normalized FEN of the position after the move |
| `moveSan` | `string` | Standard Algebraic Notation (e.g., `"Nf3"`) |
| `moveUci` | `string` | UCI notation (e.g., `"g1f3"`) |
| `color` | `string` | `"white"` or `"black"` — which side plays this move |
| `reason` | `string` | User's reasoning for this move (may be empty `""`) |
| `createdAt` | `number` | Unix timestamp (ms) |

**Indexes:**
- Primary key: `id` (auto-increment, inline)
- `byParent`: index on `parentFen` — find all moves from a position
- `byChild`: index on `childFen` — find all moves leading to a position
- `byParentMove`: unique compound index on `[parentFen, moveSan]` — prevent duplicate edges

### 5.3 Object Store: `lines`

Each line represents a complete opening variation from root to a leaf (or chosen endpoint). Lines are the unit of SM2 scheduling.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` (PK) | Auto-increment primary key |
| `color` | `string` | The color the user is studying as (`"white"` or `"black"`) |
| `rootFen` | `string` | FEN of the starting position (usually the standard start position) |
| `leafFen` | `string` | FEN of the terminal position of this line |
| `fens` | `string[]` | Ordered array of normalized FENs from root to leaf (the path through the DAG) |
| `moves` | `string[]` | Ordered array of SAN moves corresponding to each step in `fens` |
| `label` | `string` | Auto-generated or user-edited label (e.g., "Ruy Lopez > Berlin > Rio de Janeiro") |
| `easeFactor` | `number` | SM2 ease factor (default `2.5`, minimum `1.3`) |
| `interval` | `number` | SM2 interval in days (default `0`) |
| `repetitions` | `number` | SM2 repetition count (default `0`) |
| `nextReviewDate` | `number` | Unix timestamp (ms) of the next scheduled review (default `0` = immediately due) |
| `lastReviewDate` | `number \| null` | Unix timestamp (ms) of the last review, or `null` if never reviewed |
| `createdAt` | `number` | Unix timestamp (ms) |

**Indexes:**
- Primary key: `id` (auto-increment, inline)
- `byLeafFen`: index on `leafFen` — find lines ending at a specific position
- `byNextReview`: index on `nextReviewDate` — efficiently query due lines
- `byColor`: index on `color` — filter lines by study color
- `byRootFen`: index on `rootFen` — find lines starting from a given position

### 5.4 Object Store: `settings`

Simple key-value store for user preferences.

| Field | Type | Description |
|-------|------|-------------|
| `key` | `string` (PK) | Setting name |
| `value` | `any` | Setting value |

**Known keys:**
- `boardTheme` — board color theme
- `pieceSet` — piece set name
- `practiceDelay` — delay (ms) before auto-playing opponent moves during practice
- `autoRating` — `boolean` — whether to auto-calculate SM2 quality from accuracy or prompt user

---

## 6. FEN Normalization

Chess FEN strings contain six fields:

```
<pieces> <active-color> <castling> <en-passant> <halfmove-clock> <fullmove-number>
```

The last two fields (halfmove clock, fullmove number) are irrelevant for position identity — the same position can be reached at different move numbers. **Normalized FEN strips these two fields.**

### Function: `normalizeFen(fen)`

```
Input:  "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1"
Output: "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"
```

**Implementation:** Split on spaces, take first 4 fields, rejoin with space.

### Why This Matters

- Two lines reaching the same position via different move orders will converge on the same DAG node.
- This is essential for the DAG to function correctly — transpositions are automatically detected and merged.
- En passant square IS preserved because it affects legal moves from the position.
- Castling rights ARE preserved because they affect legal moves.

---

## 7. DAG Operations

Module: `dag.js`

### 7.1 `addLine(moves[], color, reasons[])`

Inserts a new opening line into the DAG.

**Algorithm:**

```
1. Initialize chess.js at the standard starting position
2. previousFen = normalizeFen(startingFEN)
3. Upsert node for previousFen (if not exists)
4. fens = [previousFen]
5. For each move (i = 0..moves.length-1):
   a. Apply move to chess.js instance
   b. currentFen = normalizeFen(chess.fen())
   c. Upsert node for currentFen
   d. Upsert edge: parentFen=previousFen, childFen=currentFen,
      moveSan=moves[i], color=(i%2==0 ? "white" : "black"),
      reason=reasons[i]
   e. fens.push(currentFen)
   f. previousFen = currentFen
6. Create a `lines` record:
   - color = color
   - rootFen = fens[0]
   - leafFen = fens[fens.length-1]
   - fens = fens
   - moves = moves
   - SM2 defaults: easeFactor=2.5, interval=0, repetitions=0,
     nextReviewDate=0 (immediately due)
   - label = auto-generated from node names along the path
```

**Edge upsert rule:** If an edge with the same `(parentFen, moveSan)` already exists, do NOT overwrite the existing `reason` unless the new reason is non-empty. This preserves earlier annotations when adding lines that share a prefix.

**Branching behavior:** Because we walk the move sequence and upsert at each step, if the first N moves match an existing line, those N nodes/edges are reused. The new nodes/edges are only created from the point of divergence. This is the natural branching behavior of the DAG.

### 7.2 `getChildren(fen)`

Returns all edges where `parentFen === fen`. These are the branching moves from this position.

```
Result: [{ childFen, moveSan, moveUci, color, reason }, ...]
```

### 7.3 `getSubtree(fen)`

BFS/DFS traversal starting from `fen`. Returns all reachable nodes and edges.

```
Algorithm:
1. queue = [fen]
2. visited = Set()
3. nodes = [], edges = []
4. While queue not empty:
   a. current = queue.dequeue()
   b. If current in visited, skip
   c. visited.add(current)
   d. node = db.get("nodes", current)
   e. nodes.push(node)
   f. children = getChildren(current)
   g. For each child edge:
      - edges.push(edge)
      - queue.enqueue(edge.childFen)
5. Return { nodes, edges }
```

### 7.4 `getFullName(fen)`

Returns the full hierarchical name of a node by walking up the DAG to the root.

```
Algorithm:
1. names = []
2. current = fen
3. While current has parent(s):
   a. node = db.get("nodes", current)
   b. If node.name is not null, prepend to names
   c. parents = edges where childFen === current
   d. If multiple parents, pick the one on the "primary line"
      (the line with the earliest createdAt, or the first-inserted edge)
   e. current = parent.parentFen
4. Root node: if it has a name, prepend it
5. Return names.join(" > ")
```

**Example:** `"Ruy Lopez > Berlin Defense > Rio de Janeiro Variation"`

### 7.5 `getRoots()`

Returns all nodes that have no incoming edges (i.e., no edge has them as `childFen`). In most cases this is just the standard starting position.

### 7.6 `getLinesBySubtree(fen)`

Returns all `lines` records whose `fens[]` array contains the given `fen`. Used to scope practice to a subtree.

```
Algorithm:
1. allLines = db.getAll("lines")
2. Return allLines.filter(line => line.fens.includes(fen))
```

**Optimization note:** For large repertoires, consider adding an inverted index (FEN → line IDs). For the expected scale (hundreds of lines), a full scan is acceptable.

### 7.7 `getLinesFromNode(fen)`

Returns all `lines` records whose `fens[]` array contains the given `fen`, AND where the given `fen` is not the last element (i.e., lines that pass through this node and continue beyond it).

### 7.8 `deleteLine(lineId)`

Deletes a line record. Then garbage-collects orphaned nodes/edges:

```
Algorithm:
1. Delete the line record
2. For each FEN in the deleted line's fens[]:
   a. Check if any other line still references this FEN
   b. If not, check if any edge still references this FEN as parent or child
   c. If fully orphaned, delete the node
3. For each edge along the deleted line's path:
   a. Check if any other line still traverses this edge
   b. If not, delete the edge
```

### 7.9 `deleteSubtree(fen)`

Deletes all nodes, edges, and lines within the subtree rooted at `fen`.

```
Algorithm:
1. subtree = getSubtree(fen)
2. For each line that passes through any node in subtree, delete it
3. Delete all edges in subtree
4. Delete all nodes in subtree
5. Delete incoming edges TO the root of the subtree (edges where childFen === fen)
```

---

## 8. SM2 Spaced Repetition

Module: `sm2.js`

### 8.1 Algorithm

Standard SM2 (SuperMemo 2) implementation. Each `line` record carries SM2 state.

**Inputs:**
- `quality` — integer 0–5 representing recall quality

**Quality scale:**

| Grade | Meaning | Trigger |
|-------|---------|---------|
| 5 | Perfect — instant recall, no mistakes | All moves correct, no hesitation |
| 4 | Correct with hesitation | All moves correct, but took time |
| 3 | Correct with difficulty | Minor mistakes, self-corrected |
| 2 | Wrong but recognized the right answer | Made errors, recognized correct move when shown |
| 1 | Wrong — vaguely familiar | Failed most moves, slight recognition |
| 0 | Blackout — no recall | Total failure |

**Update algorithm:**

```
function sm2Update(item, quality):
    if quality >= 3:
        // Correct response
        if item.repetitions == 0:
            item.interval = 1
        else if item.repetitions == 1:
            item.interval = 6
        else:
            item.interval = Math.round(item.interval * item.easeFactor)
        item.repetitions += 1
    else:
        // Incorrect response — reset
        item.repetitions = 0
        item.interval = 1

    // Update ease factor
    item.easeFactor = item.easeFactor +
        (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02))
    item.easeFactor = Math.max(1.3, item.easeFactor)

    // Schedule next review
    item.nextReviewDate = Date.now() + (item.interval * 24 * 60 * 60 * 1000)
    item.lastReviewDate = Date.now()

    return item
```

### 8.2 `getDueLines(subtreeFen?, color?)`

Query lines that are due for review.

```
Algorithm:
1. Query `lines` store using `byNextReview` index: nextReviewDate <= Date.now()
2. If subtreeFen is specified, filter to lines whose fens[] includes subtreeFen
3. If color is specified, filter by color
4. Sort by most overdue first (lowest nextReviewDate)
5. Return results
```

### 8.3 `gradeLine(lineId, quality)`

Apply SM2 update to a line.

```
Algorithm:
1. line = db.get("lines", lineId)
2. line = sm2Update(line, quality)
3. db.put("lines", line)
```

### 8.4 Auto-Quality Calculation

When the `autoRating` setting is enabled, quality is automatically calculated from the practice session accuracy:

```
function autoQuality(totalMoves, correctMoves, hintUsed):
    accuracy = correctMoves / totalMoves
    if accuracy == 1.0 and not hintUsed:
        return 5
    else if accuracy == 1.0 and hintUsed:
        return 4
    else if accuracy >= 0.8:
        return 3
    else if accuracy >= 0.5:
        return 2
    else if accuracy >= 0.2:
        return 1
    else:
        return 0
```

---

## 9. Practice Engine — Pivot & Prompt Logic

This is the core innovation of the system. During practice, the user is tested on opening lines, but the system is aware of the full DAG context — not just the specific line being drilled.

### 9.1 Core Practice Flow

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
      - Wait `practiceDelay` ms
      - Play expectedMove on the board automatically
      - Show reason (if any) in sidebar
      - moveIndex += 1
      - Continue

   e. If sideToMove == C:
      // USER'S MOVE — wait for input
      - Wait for user to make a move on the board
      - userMove = the move the user played (in SAN)
      - Evaluate the move (see §9.2)
```

### 9.2 Move Evaluation — The Pivot Decision Tree

When the user plays a move during practice, it is evaluated against the DAG, not just the current line.

```
Given: currentFen, userMove (SAN), expectedLine L, moveIndex

1. EXACT MATCH — userMove == L.moves[moveIndex]
   → Mark as CORRECT
   → Show reason from the edge
   → moveIndex += 1, continue the line

2. DAG MATCH — userMove != L.moves[moveIndex], BUT there exists an edge
   in the DAG from currentFen with moveSan == userMove
   → This means the user played a move belonging to a DIFFERENT line
   → Execute PIVOT LOGIC (see §9.3)

3. NO MATCH — userMove is a legal chess move but not in the DAG at all
   → Mark as INCORRECT
   → Highlight the expected move(s) on the board
   → Show the reason for the expected move
   → Record the error
   → Optionally: allow retry or auto-advance

4. ILLEGAL MOVE — chess.js rejects the move
   → Chessground won't allow it (prevented at board level)
```

### 9.3 Pivot Logic — Handling Alternative Lines

When the user plays a move that matches a different line in the DAG (case 2 above), the system must decide what to do. This is the **pivot & prompt** mechanism.

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
   → Ask user: continue on current line or stop?
   → If continue: undo the move, replay from currentFen, prompt for the expected move

Step 3: If alternative lines found, check alternative line mastery

   altLineMastered = (A.repetitions >= 3 AND A.easeFactor >= 2.0)
   // If multiple alt lines, pick the best candidate first (see §9.4 selection)

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
     → Credit practice to the alternative line (see §9.4 for execution details).
```

### 9.4 Pivot Execution

When a pivot is accepted (either silently or after user confirmation):

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
   - Grade the ORIGINAL line L for the moves completed before the pivot
     - If the user pivoted early (< 50% of L completed), do NOT update L's SM2
     - If pivoted late (>= 50%), give L a partial grade based on accuracy so far
   - Grade the PIVOT line for the moves completed after the pivot
     - Full SM2 update based on accuracy in the pivoted segment
```

### 9.5 Prompt UI

When the user plays a move matching a **mastered** alternative line (§9.3, Case A), the system informs them and redirects back to the current line:

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

When the alternative line is **not mastered** (§9.3, Case B), no prompt is shown — the pivot happens silently.

### 9.6 Edge Cases in Practice

| Scenario | Behavior |
|----------|----------|
| User plays a move not in DAG but it's a known good move | Mark incorrect — only repertoire moves are accepted. The system drills what the user has studied. |
| Multiple alternative lines branch from the same move | Pick the best candidate per §9.4 selection criteria. If the selected alt line is mastered, inform and undo; if not, silently pivot. |
| User pivots, then plays another move matching yet another line | Allow chained pivots — the practice engine always evaluates against the full DAG |
| The pivot line has already been reviewed today | Still allow pivot, but SM2 update uses the new session's quality |
| Line has only opponent moves left after pivot point | Auto-play remaining moves, mark as complete |
| Alt line is mastered and move is undone | The user is expected to play the correct move for the current (due) line. If they play the same alt move again, show the same mastered message and undo again. |

### 9.7 Practice Session Summary

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

## 10. Pages

### 10.1 Study Page (`pages/study.js`)

The feed-in page where the user records new opening lines.

**Layout:**

```
┌─────────────────────────────────────────────────────────────────┐
│  ┌──────────────────────┐   ┌──────────────────────────────┐   │
│  │                      │   │  Color: ○ White  ● Black     │   │
│  │                      │   │                              │   │
│  │     Chessground       │   │  Move List:                  │   │
│  │       Board           │   │  1. e4    (reason: ...)  ✎  │   │
│  │                      │   │     e5    (reason: ...)  ✎  │   │
│  │                      │   │  2. Nf3   (reason: ...)  ✎  │   │
│  │                      │   │     Nc6   (reason: ...)  ✎  │   │
│  │                      │   │  3. Bb5   (reason: ...)  ✎  │   │
│  └──────────────────────┘   │                              │   │
│                              │  ┌─────────────────────────┐ │   │
│  ┌──────┐ ┌──────┐          │  │ Reason for current move │ │   │
│  │ Undo │ │ Redo │          │  │ [text input area       ]│ │   │
│  └──────┘ └──────┘          │  └─────────────────────────┘ │   │
│                              │                              │   │
│  Status: "Branching from     │  ┌──────────┐ ┌───────────┐ │   │
│  existing line at move 3"    │  │ Save Line│ │ Clear     │ │   │
│  (shown when prefix exists)  │  └──────────┘ └───────────┘ │   │
│                              └──────────────────────────────┘   │
└─────────────────────────────────────────────────────────────────┘
```

**Behavior:**

1. User selects their study color (White or Black). Board orientation adjusts.
2. User makes moves for BOTH sides on the board — each move appears in the Move List on the right.
3. After each move, a text input appears for the user to type the reason for that move. Reason can be left empty.
4. The ✎ (edit) button next to each move allows editing the reason retroactively.
5. Undo/Redo buttons (and keyboard shortcuts: Ctrl+Z / Ctrl+Y) navigate the move stack.
6. **Branch detection:** After each move, the system checks if the current FEN exists in the DAG.
   - If yes, and there are edges from it: show "Position exists in repertoire. Existing moves: Bb5 (Ruy Lopez), Bc4 (Italian)."
   - If the user plays a new move not in the DAG from an existing position: show "New branch from existing position."
7. **Save Line:** Calls `dag.addLine(moves, color, reasons)`. Shows confirmation. Resets the board.
8. **Validation:** Cannot save an empty line. Warn if saving a line identical to an existing one.

### 10.2 Browse Page (`pages/browse.js`)

Explore the full repertoire DAG as an expandable tree.

**Layout:**

```
┌──────────────────────────────────────────────────────────────────┐
│  ┌─────────────────────────────┐  ┌──────────────────────────┐  │
│  │  Repertoire Tree            │  │  Position Detail         │  │
│  │                             │  │                          │  │
│  │  ▼ Start Position           │  │  ┌────────────────────┐  │  │
│  │    ▼ 1. e4                  │  │  │   Mini-board       │  │  │
│  │      ▼ 1...e5               │  │  │   (chessground)    │  │  │
│  │        ► 2. Nf3             │  │  └────────────────────┘  │  │
│  │          ▼ 2...Nc6          │  │                          │  │
│  │            ► 3. Bb5 "Ruy.." │  │  Name: [Berlin Defense]  │  │
│  │            ► 3. Bc4 "Ital." │  │  Full: Ruy Lopez >       │  │
│  │        ► 2. d4              │  │        Berlin Defense    │  │
│  │      ►  1...c5 (Sicilian)   │  │                          │  │
│  │    ► 1. d4                  │  │  Notes: [text area]      │  │
│  │                             │  │                          │  │
│  │                             │  │  Reason for arriving     │  │
│  │                             │  │  move: "Controls center" │  │
│  │                             │  │                          │  │
│  │                             │  │  Lines through here: 4   │  │
│  │                             │  │  Children: 2 moves       │  │
│  │                             │  │                          │  │
│  │                             │  │  ┌─────────┐ ┌────────┐ │  │
│  │                             │  │  │Practice │ │ Delete │ │  │
│  │                             │  │  │Subtree  │ │Subtree │ │  │
│  │                             │  │  └─────────┘ └────────┘ │  │
│  └─────────────────────────────┘  └──────────────────────────┘  │
└──────────────────────────────────────────────────────────────────┘
```

**Behavior:**

1. **Tree rendering:** DAG is rendered as an expandable/collapsible tree. Each node shows the move SAN and name (if set).
2. **Node selection:** Clicking a node in the tree populates the right panel with:
   - A mini chessground board showing the position
   - Editable name field (inline save on blur or Enter)
   - Full name (auto-computed from ancestors)
   - Editable notes field
   - The reason text from the edge that led to this node
   - Count of lines passing through this node and number of child branches
3. **Practice Subtree** button: navigates to `#/practice?fen=<selected-fen>` to scope practice to this subtree
4. **Delete Subtree** button: confirmation dialog, then calls `dag.deleteSubtree(fen)`
5. **Color coding:** Edges played by White shown in one color, Black in another (visual distinction in the tree)
6. **Search:** A search/filter input at the top of the tree to find nodes by name

### 10.3 Practice Page (`pages/practice.js`)

SM2-driven quiz page with the pivot logic described in §9.

**Layout:**

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

**Behavior:**

1. **Scope selection:** Dropdown to choose scope — "All Lines", or any named node/subtree from the Browse page. URL parameter `?fen=...` pre-selects scope.
2. **Color filter:** Optional filter by study color.
3. **Line selection:** SM2 scheduler picks the most overdue line. If no lines are due, show "All caught up!" message.
4. **Move-by-move drill:**
   - Opponent's moves are auto-played after a configurable delay
   - User's moves require board interaction
   - After each user move: evaluate using the pivot decision tree (§9.2–9.4)
   - Correct move: green highlight, show reason, advance
   - Wrong move: red highlight, show correct move + reason, record error
5. **Hint button:** Shows the first letter of the piece/square, or highlights the destination square. Marks `hintUsed = true` for quality calculation.
6. **Skip button:** Marks the line with quality 0 and moves to the next due line.
7. **Pivot prompts:** Modal dialog when the pivot-prompt scenario is triggered (§9.5).
8. **End of line:** Show line result (correct/incorrect count), prompt for quality rating (or auto-calculate if setting enabled).
9. **Session end:** Show summary (§9.7) when all due lines are reviewed.

### 10.4 Manage Page (`pages/manage.js`)

Data management and settings.

**Layout:**

```
┌──────────────────────────────────────────────────────┐
│  Data Management                                      │
│                                                       │
│  ┌─────────────┐  ┌──────────────┐  ┌─────────────┐ │
│  │  Export JSON │  │ Import JSON  │  │  Clear All   │ │
│  └─────────────┘  └──────────────┘  └─────────────┘ │
│                                                       │
│  Statistics:                                          │
│  • Total nodes: 47                                    │
│  • Total edges: 52                                    │
│  • Total lines: 12                                    │
│  • Lines due today: 3                                 │
│  • Average ease factor: 2.35                          │
│                                                       │
│  Settings:                                            │
│  • Auto-play delay: [500ms ▾]                         │
│  • Auto quality rating: [✓]                           │
│  • Board theme: [Brown ▾]                             │
│  • Piece set: [CBurnett ▾]                            │
│                                                       │
└──────────────────────────────────────────────────────┘
```

**Behavior:**

1. **Export:** Reads all four object stores, serializes to JSON, triggers download as `chess-trainer-backup-YYYY-MM-DD.json`.
2. **Import:** File upload, validates JSON structure, offers "Merge" (add missing, skip existing) or "Replace" (wipe and restore).
3. **Clear All:** Confirmation dialog ("Type DELETE to confirm"), then wipes all stores.
4. **Statistics:** Real-time counts from IndexedDB.
5. **Settings:** Saved to the `settings` store, applied on page load.

---

## 11. Board Integration

Module: `board.js`

Wraps **chessground** (Lichess's board library) with **chess.js** (for move legality).

### 11.1 Initialization

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

### 11.2 Helper Functions

| Function | Description |
|----------|-------------|
| `legalDests(chess)` | Compute a `Map<square, square[]>` of legal moves for chessground's `movable.dests` |
| `setPosition(fen)` | Reset both chess.js and chessground to a FEN |
| `setOrientation(color)` | Flip the board |
| `playMove(san)` | Programmatically play a move (returns the move object) |
| `undoMove()` | Undo the last move in chess.js and update chessground |
| `highlightSquares(squares, className)` | Add visual markers to squares (for hints, errors) |
| `setInteractive(boolean)` | Enable/disable user moves (used during opponent's auto-play) |

### 11.3 Promotion Handling

When a pawn reaches the promotion rank, show a promotion chooser UI (Queen, Rook, Bishop, Knight). Chessground supports this natively via the `premovable` config. Default to Queen auto-promotion with an option to choose.

---

## 12. SPA Routing

Module: `app.js`

Hash-based client-side routing. No server-side routing needed.

### 12.1 Routes

| Hash | Page Module | Description |
|------|-------------|-------------|
| `#/study` | `pages/study.js` | Feed in new opening lines |
| `#/browse` | `pages/browse.js` | Explore and name the repertoire DAG |
| `#/practice` | `pages/practice.js` | SM2-driven practice (optional `?fen=...` query) |
| `#/manage` | `pages/manage.js` | Export, import, settings |
| (default) | Redirect to `#/practice` | Landing page shows practice |

### 12.2 Page Lifecycle

Each page module exports:

```javascript
export default {
    mount(container, params) {
        // Called when navigating TO this page
        // container: the DOM element to render into
        // params: parsed URL parameters (e.g., { fen: "..." })
        // Set up DOM, event listeners, board instances
    },
    unmount() {
        // Called when navigating AWAY from this page
        // Clean up event listeners, destroy board instances
        // Save any pending state
    }
};
```

### 12.3 Navigation

```html
<nav>
    <a href="#/study">Study</a>
    <a href="#/browse">Browse</a>
    <a href="#/practice">Practice</a>
    <a href="#/manage">Manage</a>
</nav>
<main id="page-container"></main>
```

The router listens for `hashchange` events, unmounts the current page, and mounts the new one.

---

## 13. Offline & PWA

### 13.1 Service Worker (`sw.js`)

**Strategy:** Cache-first for all static assets. No network requests needed after first load.

```
Install event:
    Cache all files: index.html, CSS files, JS files, lib/ files, piece SVGs

Fetch event:
    If request matches cache → return cached response
    Else → fetch from network, cache the response, return it
```

**Cache versioning:** A version string in `sw.js` (e.g., `"v1.0.0"`) triggers cache invalidation on updates. Old caches are cleaned up in the `activate` event.

### 13.2 PWA Manifest (`manifest.json`)

```json
{
    "name": "Chess Opening Trainer",
    "short_name": "ChessTrainer",
    "start_url": "/",
    "display": "standalone",
    "background_color": "#312e2b",
    "theme_color": "#312e2b",
    "icons": [
        { "src": "lib/assets/icon-192.png", "sizes": "192x192", "type": "image/png" },
        { "src": "lib/assets/icon-512.png", "sizes": "512x512", "type": "image/png" }
    ]
}
```

### 13.3 Offline Guarantee

- **All JavaScript** is vendored locally (chessground, chess.js) — no CDN dependencies
- **All CSS** is vendored locally — including chessground themes and piece SVGs
- **IndexedDB** is the sole data store — no server calls
- **Service worker** caches everything on first load — subsequent visits are fully offline
- **No external API calls** — no analytics, no telemetry, no external fonts

---

## 14. Data Portability

### 14.1 Export Format

```json
{
    "version": 1,
    "exportedAt": "2026-03-01T12:00:00Z",
    "data": {
        "nodes": [
            {
                "fen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
                "name": null,
                "notes": "",
                "createdAt": 1709294400000
            }
        ],
        "edges": [
            {
                "id": 1,
                "parentFen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
                "childFen": "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3",
                "moveSan": "e4",
                "moveUci": "e2e4",
                "color": "white",
                "reason": "Control the center, open lines for bishop and queen",
                "createdAt": 1709294400000
            }
        ],
        "lines": [
            {
                "id": 1,
                "color": "white",
                "rootFen": "rnbqkbnr/pppppppp/8/8/8/8/PPPPPPPP/RNBQKBNR w KQkq -",
                "leafFen": "r1bqkbnr/pppp1ppp/2n5/1B2p3/4P3/5N2/PPPP1PPP/RNBQK2R b KQkq -",
                "fens": ["..."],
                "moves": ["e4", "e5", "Nf3", "Nc6", "Bb5"],
                "label": "Ruy Lopez",
                "easeFactor": 2.5,
                "interval": 0,
                "repetitions": 0,
                "nextReviewDate": 0,
                "lastReviewDate": null,
                "createdAt": 1709294400000
            }
        ],
        "settings": [
            { "key": "practiceDelay", "value": 500 },
            { "key": "autoRating", "value": true }
        ]
    }
}
```

### 14.2 Import Modes

| Mode | Behavior |
|------|----------|
| **Merge** | For each record: if a record with the same key exists, skip it. If not, insert it. Lines are matched by `(rootFen, leafFen, color)` tuple. |
| **Replace** | Wipe all stores, then insert all records from the import file. |

### 14.3 Validation

On import, validate:
- `version` field matches expected version
- All required fields are present in each record
- All FENs are well-formed (4 space-separated parts after normalization)
- All `fens[]` arrays in lines are consistent with `moves[]` arrays (same length relationship)
- Edge references point to existing nodes (or nodes present in the import)

---

## 15. Deployment

### 15.1 Local Development

```bash
# Any static file server works
npx serve .
# or
python3 -m http.server 8000
```

Open `http://localhost:8000` in a browser. Service worker only activates over HTTPS or localhost.

### 15.2 GitHub Pages

```bash
# Repo root IS the site root — no build step needed
git push origin main
# Enable GitHub Pages in repo settings → Source: main branch, root folder
```

**URL:** `https://<username>.github.io/<repo-name>/`

### 15.3 Netlify / Vercel

Drag-and-drop deploy of the repo root. No build command, no output directory configuration needed.

---

## 16. Open Questions & Future Work

### Open Questions

| # | Question | Notes |
|---|----------|-------|
| Q1 | ~~Should the starting position always be standard, or allow custom FEN starting points?~~ | **RESOLVED:** Custom starting positions are supported in v1. The Study page has a "Mark Starting Position" button — the user makes moves to reach a position, marks it, and then records the line from there. Lines store the `rootFen` of the marked position. See Doc 2 §3.1 and Doc 6 §3.3. |
| Q2 | How to handle transpositions during practice? If line A and line B converge at the same FEN, and the user is practicing line A, should they see line B's continuation as valid? | Current design: yes, via pivot logic. But this could be confusing if lines converge and then diverge again. |
| Q3 | Should hints penalize the quality score more aggressively? | Current: hintUsed caps quality at 4. Could be configurable. |
| Q4 | Maximum sensible DAG size for IndexedDB + in-browser performance? | Likely fine up to ~10,000 nodes. Tree rendering may need virtualization beyond that. |

### Future Work

| # | Feature | Priority |
|---|---------|----------|
| F1 | Google Drive sync for cross-device backup | High |
| F2 | Local filesystem backup (File System Access API) | Medium |
| F3 | PGN import — parse a PGN file and add all games/variations as lines | Medium |
| F4 | Lichess study import — fetch from Lichess API (opt-in, not default) | Low |
| F5 | Statistics page — practice history, accuracy trends, heat maps | Medium |
| F6 | Keyboard navigation — arrow keys to navigate the tree, shortcuts for practice | Medium |
| F7 | Dark/light theme toggle | Low |
| F8 | Mobile-optimized layout (responsive CSS) | Medium |
| F9 | Sound effects — move sounds, correct/incorrect audio feedback | Low |
| F10 | Opening explorer integration — show master game stats for comparison (opt-in fetch) | Low |
| F11 | Multi-repertoire support — separate DAGs for different repertoire sets (tournament vs. blitz) | Medium |
| F12 | Collaborative sharing — export a single subtree as a shareable URL/file | Low |

---

## Appendix A: Glossary

| Term | Definition |
|------|-----------|
| **DAG** | Directed Acyclic Graph — the data structure storing the user's opening repertoire. Nodes are chess positions (FENs), edges are moves. |
| **FEN** | Forsyth–Edwards Notation — a compact string encoding a chess position. |
| **Normalized FEN** | FEN with halfmove clock and fullmove number stripped. Used as the unique position identifier. |
| **SAN** | Standard Algebraic Notation — human-readable move notation (e.g., `Nf3`, `exd5`). |
| **UCI** | Universal Chess Interface — machine-readable move notation (e.g., `g1f3`, `e4d5`). |
| **SM2** | SuperMemo 2 — a spaced repetition algorithm that schedules reviews based on recall quality. |
| **Line** | A complete sequence of moves from the starting position to an endpoint, representing one variation the user has studied. |
| **Pivot** | During practice, when the user plays a move belonging to a different line, the system switches to practicing that line instead. |
| **Ease Factor** | SM2 parameter representing how easy a line is for the user. Higher = easier, longer intervals between reviews. Minimum 1.3. |
| **Subtree** | All positions and moves reachable from a given node in the DAG. Used to scope practice to a portion of the repertoire. |

---

## Appendix B: SM2 Worked Example

**Line:** Ruy Lopez > Berlin Defense (5 moves)

| Review # | Date | Quality | Ease Factor | Interval | Next Review |
|----------|------|---------|-------------|----------|-------------|
| 1 | Mar 1 | 4 | 2.50 | 1 day | Mar 2 |
| 2 | Mar 2 | 5 | 2.60 | 6 days | Mar 8 |
| 3 | Mar 8 | 3 | 2.46 | 15 days | Mar 23 |
| 4 | Mar 23 | 5 | 2.56 | 38 days | Apr 30 |
| 5 | Apr 30 | 2 | 2.38 | 1 day | May 1 |
| 6 | May 1 | 4 | 2.38 | 1 day | May 2 |
| 7 | May 2 | 5 | 2.48 | 6 days | May 8 |

- Review 5: quality < 3 → reset to 1-day interval, repetitions back to 0.
- Review 6: first repetition after reset → 1-day interval.
- Review 7: second repetition → 6-day interval.

---

## Appendix C: Pivot Logic Worked Example

**Setup:** User has two lines stored:
- **Line A:** 1. e4 e5 2. Nf3 Nc6 3. **Bb5** (Ruy Lopez) — last reviewed 2 days ago, mastered (reps=5, EF=2.6)
- **Line B:** 1. e4 e5 2. Nf3 Nc6 3. **Bc4** (Italian Game) — overdue by 3 days (reps=1, EF=2.3)

**User is practicing Line A:**

1. System auto-plays: 1. e4
2. User plays: 1...e5 ✓ (matches line A)
3. System auto-plays: 2. Nf3
4. User plays: 2...Nc6 ✓ (matches line A)
5. System expects: 3. Bb5 (Ruy Lopez)
6. **User plays: 3. Bc4** (Italian Game move)

**Evaluation:**
- userMove (`Bc4`) ≠ expectedMove (`Bb5`) — not an exact match
- DAG lookup: Is there an edge from the current FEN with `moveSan == "Bc4"`? **Yes** — it's in Line B
- Line A is mastered (reps=5, EF=2.6) → `currentLineMastered = true`
- Line B is overdue by 3 days → `alternativeIsDue = true`
- Decision matrix: top-left cell → **PROMPT the user**

**Prompt shown:**
> "You played Bc4 (Italian Game). You've mastered the Ruy Lopez line. The Italian Game variation is overdue for review (last reviewed 4 days ago). Want to try it?"
> [Try Italian Game] [Stay on Ruy Lopez]

**If user clicks "Try Italian Game":**
- Pivot to Line B
- Continue practice from position after 3. Bc4
- Line A: no SM2 update (pivoted before 50% completion)
- Line B: SM2 update based on accuracy from move 3 onward

**If user clicks "Stay on Ruy Lopez":**
- Undo the Bc4 move on the board
- Wait for the user to play Bb5
- Continue Line A as normal
