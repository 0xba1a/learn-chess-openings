# Design Doc 7: Browse Page

**Module:** `js/pages/browse.js`
**Dependencies:** `js/board.js` (Doc 4), `js/dag.js` (Doc 2), `js/db.js` (Doc 1)
**Parallel with:** Doc 5 (Practice Engine), Doc 6 (Study Page)

---

## 1. Context

The Browse page lets the user explore their entire opening repertoire as an expandable tree. They can name nodes (e.g., "Ruy Lopez"), add notes, view a mini-board for any position, and launch scoped practice or delete subtrees.

### Architecture Position

```
  ──► browse.js ◄──   ← YOU ARE HERE
        │
  board.js (Doc 4) + dag.js (Doc 2)
        │
      db.js (Doc 1)
```

---

## 2. Page Layout

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
│  │      ► 1...c5 (Sicilian)    │  │                          │  │
│  │    ► 1. d4                  │  │  Notes: [text area]      │  │
│  │                             │  │                          │  │
│  │  [Search: _________ ]      │  │  Reason for arriving     │  │
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

---

## 3. Left Panel — Repertoire Tree

### 3.1 Tree Rendering

The DAG is rendered as an expandable/collapsible tree, starting from the root(s) returned by `dag.getRoots()`.

```
Algorithm:
1. roots = await dag.getRoots()
2. For each root, render a tree node
3. Each node shows:
   - ► (collapsed) or ▼ (expanded) toggle
   - Move number + SAN (e.g., "1. e4", "1...e5")
   - Node name in quotes if set (e.g., '"Ruy Lopez"')
4. Clicking ► expands the node:
   - children = await dag.getChildren(currentFen)
   - Render each child as a nested tree node
5. Clicking ▼ collapses the node, hides children
```

### 3.2 Move Numbering

Display moves with proper chess move numbering:
- White moves: `1. e4`, `2. Nf3`, `3. Bb5`
- Black moves: `1...e5`, `2...Nc6`

Derive the move number from the position in the tree depth. The root node (starting position) is at depth 0, move 1 starts at depth 1.

### 3.3 Color Coding

Edges played by White shown in one color, Black in another — visual distinction in the tree. Use CSS classes like `move-white` and `move-black`.

### 3.4 Search / Filter

A search input at the top of the tree panel. Filters nodes by name (case-insensitive substring match). When filtering:
- Show only nodes whose name matches (and their ancestor path to root)
- Automatically expand the tree to show matching nodes

### 3.5 Node Selection

Clicking a node in the tree selects it and populates the right panel (Position Detail).

---

## 4. Right Panel — Position Detail

When a node is selected:

### 4.1 Mini-Board
- Create a small chessground board (read-only, no moves allowed) showing the selected position.
- Use `board.createBoard(miniEl, { fen: selectedFen, movableColor: 'none' })` — or similar config to make it non-interactive.

### 4.2 Name Field
- Editable text input showing the node's `name` (or empty if unnamed).
- Save on blur or Enter: `db.put("nodes", { ...node, name: newName })`.

### 4.3 Full Name
- Read-only display of the full hierarchical name computed by `dag.getFullName(fen)`.
- Example: `"Ruy Lopez > Berlin Defense > Rio de Janeiro Variation"`

### 4.4 Notes Field
- Editable textarea for free-text notes about this position.
- Save on blur: `db.put("nodes", { ...node, notes: newNotes })`.

### 4.5 Arriving Move Reason
- Read-only display of the `reason` field from the edge that led to this node.
- If multiple edges lead to this node (transposition), show the reason from the primary (earliest-created) edge.

### 4.6 Statistics
- **Lines through here:** Count of lines whose `fens[]` includes this FEN. Use `dag.getLinesBySubtree(fen).length`.
- **Children:** Count of child edges from this position. Use `dag.getChildren(fen).length`.

### 4.7 Action Buttons

**Practice Subtree:** Navigates to `#/practice?fen=<selectedFen>`. This scopes the Practice page to only drill lines passing through this position.

**Delete Subtree:**
1. Show confirmation dialog: "Delete all positions and lines under {name}? This cannot be undone."
2. On confirm: call `dag.deleteSubtree(fen)`
3. Refresh the tree

---

## 5. Page Lifecycle

```javascript
// browse.js — ES module
export default {
    mount(container, params) {
        // 1. Render the two-panel layout into container
        // 2. Load roots via dag.getRoots(), render tree
        // 3. Create mini-board (initially empty or showing start position)
        // 4. Set up event listeners for tree clicks, search, name/notes editing, action buttons
    },
    unmount() {
        // Destroy mini-board, clean up listeners
    }
};
```

---

## 6. Testing Checklist

- [ ] Tree renders correctly from DAG roots
- [ ] Expanding a node loads and shows its children
- [ ] Collapsing a node hides children
- [ ] Move numbering is correct (1. e4, 1...e5, 2. Nf3, etc.)
- [ ] Node names appear in the tree next to moves
- [ ] Clicking a node populates the right panel
- [ ] Mini-board shows the correct position for the selected node
- [ ] Editing the name field saves to IndexedDB on blur/Enter
- [ ] Full name auto-computes from ancestor names
- [ ] Notes field saves on blur
- [ ] Arriving move reason is displayed correctly
- [ ] Line count and children count are accurate
- [ ] Practice Subtree navigates to `#/practice?fen=...`
- [ ] Delete Subtree shows confirmation and removes the subtree
- [ ] Tree refreshes after deletion
- [ ] Search filters nodes by name and expands matching paths
- [ ] White/Black moves have distinct visual styling
- [ ] Nodes with no children show no expand toggle
- [ ] Transposition nodes (multiple parents) render correctly in the tree
