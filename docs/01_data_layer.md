# Design Doc 1: Data Layer & FEN Normalization

**Modules:** `js/db.js`, `js/fen.js`, `js/utils.js`
**Dependencies:** None (foundation layer — other modules depend on this)
**Parallel with:** Doc 4 (Board Integration)

---

## 1. Context

You are building the storage foundation for a fully offline, browser-based chess opening trainer. All data lives in **IndexedDB** — there is no server. Every other module (`dag.js`, `sm2.js`, pages) depends on the API you expose here.

### Project Structure (your files)

```
js/
├── db.js        # IndexedDB wrapper (open, get, put, getAll, delete, query by index)
├── fen.js       # FEN normalization utility
└── utils.js     # Shared helpers
```

### Architecture Position

```
Pages (study, browse, practice, manage)
        │
   dag.js / sm2.js
        │
  ──► db.js ◄──   ← YOU ARE HERE
        │
    IndexedDB
```

---

## 2. FEN Normalization (`fen.js`)

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

### Export

```javascript
// fen.js — ES module
export function normalizeFen(fen) { /* ... */ }
```

---

## 3. IndexedDB Wrapper (`db.js`)

Database name: `chess-opening-trainer`, version `1`.

### 3.1 Object Store: `nodes`

Each node represents a unique chess position in the user's repertoire.

| Field | Type | Description |
|-------|------|-------------|
| `fen` | `string` (PK) | Normalized FEN (see §2). Primary key. |
| `name` | `string \| null` | User-given name for this position (e.g., "Ruy Lopez", "Berlin Defense") |
| `notes` | `string` | Free-text notes about this position |
| `createdAt` | `number` | Unix timestamp (ms) when the node was first created |

**Indexes:**
- Primary key: `fen` (unique, inline)
- `byName`: index on `name` — look up nodes by their user-assigned name

Each edge represents a move connecting two positions in the DAG.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` (PK) | Auto-increment primary key |
| `parentFen` | `string` | Normalized FEN of the position before the move |
| `childFen` | `string` | Normalized FEN of the position after the move |
| `moveSan` | `string` | Standard Algebraic Notation (e.g., `"Nf3"`) |
| `moveUci` | `string` | UCI notation (e.g., `"g1f3"`) |
| `color` | `string` | `"white"` or `"black"` — which side plays this move |
| `reasons` | `object` | Map of line name → reason string. Each line traversing this edge has its own reason for the move. E.g., `{ "Ruy Lopez": "Pin the knight" }`. Empty `{}` if no reasons provided. |
| `createdAt` | `number` | Unix timestamp (ms) |

**Indexes:**
- Primary key: `id` (auto-increment, inline)
- `byParent`: index on `parentFen` — find all moves from a position
- `byChild`: index on `childFen` — find all moves leading to a position
- `byParentMove`: **unique** compound index on `[parentFen, moveSan]` — prevent duplicate edges

### 3.3 Object Store: `lines`

Each line represents a complete opening variation from root to a leaf. Lines are the unit of SM2 scheduling.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` (PK) | Auto-increment primary key |
| `color` | `string` | The color the user is studying as (`"white"` or `"black"`) |
| `rootFen` | `string` | FEN of the starting position (usually the standard start position) |
| `leafFen` | `string` | FEN of the terminal position of this line |
| `fens` | `string[]` | Ordered array of normalized FENs from root to leaf (the path through the DAG) |
| `moves` | `string[]` | Ordered array of SAN moves corresponding to each step in `fens` |
| `label` | `string` | Composite name of the line (e.g., `"Ruy Lopez > Berlin Defense > Rio de Janeiro Variation"`). Derived from the `names` store record for this line. See Doc 2 §2.1. |
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

### 3.4 Object Store: `names`

Structured 3-part naming table. Every line gets a record here. Supports cascading dropdown UI (part1 → part2 → part3) and reverse lookups from names back to FENs/lines.

| Field | Type | Description |
|-------|------|-------------|
| `id` | `number` (PK) | Auto-increment primary key |
| `lineId` | `number` | Foreign key to the `lines` store |
| `part1` | `string` | Top-level opening name — first named node walking root → leaf (e.g., `"Ruy Lopez"`) |
| `part2` | `string` | Variation name — second named node (e.g., `"Berlin Defense"`). Empty string if only one named node. |
| `part3` | `string` | Sub-variation — remainder: third named node or auto-generated from the divergence point (e.g., `"Rio de Janeiro Variation"`, `"Bc4 variation"`). Empty string if ≤2 named nodes. |
| `rootFen` | `string` | FEN of the line's root position (denormalized for quick lookup) |
| `leafFen` | `string` | FEN of the line's leaf position (denormalized) |
| `sourceFen` | `string` | FEN of the node whose `name` field determined `part1` (reverse mapping) |
| `createdAt` | `number` | Unix timestamp (ms) |

**Indexes:**
- Primary key: `id` (auto-increment, inline)
- `byLineId`: unique index on `lineId` — one name record per line
- `byPart1`: index on `part1` — first dropdown
- `byPart1Part2`: compound index on `[part1, part2]` — second dropdown filtered by first
- `byPart1Part2Part3`: compound index on `[part1, part2, part3]` — third dropdown
- `bySourceFen`: index on `sourceFen` — find all name records derived from a given node (used for cascade updates)

**ECO alignment:** The 3-part structure naturally maps to how chess openings are classified:
- Part 1 = Opening family ("Ruy Lopez", "Sicilian Defense", "Queen's Gambit")
- Part 2 = Variation ("Berlin Defense", "Najdorf Variation", "Declined")
- Part 3 = Sub-variation or specific line qualifier

### 3.5 Object Store: `settings`

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

### 3.5 API to Expose

`db.js` must export a **promise-based** API wrapping IndexedDB. All functions return Promises.

```javascript
// db.js — ES module

// Initialize / open the database. Call once on app startup.
export async function openDB() { /* ... */ }

// Generic CRUD — used by dag.js, sm2.js, and pages
export async function get(storeName, key) { /* ... */ }
export async function getAll(storeName) { /* ... */ }
export async function put(storeName, record) { /* ... */ }
export async function add(storeName, record) { /* ... */ }
export async function del(storeName, key) { /* ... */ }

// Index queries
export async function getAllByIndex(storeName, indexName, value) { /* ... */ }

// Range queries (used by SM2 for nextReviewDate <= now)
export async function getAllByIndexRange(storeName, indexName, upper) { /* ... */ }

// Bulk operations (used by import/export)
export async function clearStore(storeName) { /* ... */ }
export async function bulkPut(storeName, records) { /* ... */ }
```

### 3.6 Implementation Notes

- Use the standard `indexedDB.open()` API with an `onupgradeneeded` handler to create stores and indexes.
- All read/write operations should use transactions. Reads use `"readonly"`, writes use `"readwrite"`.
- `getAllByIndexRange(storeName, indexName, upper)` should use `IDBKeyRange.upperBound(upper)` to query records where the indexed field is ≤ the given value.
- Wrap each IDB operation in a Promise that resolves on `onsuccess` and rejects on `onerror`.
- The database connection should be opened once and reused (module-level variable).

---

## 4. Shared Helpers (`utils.js`)

Minimal shared utilities. Add as needed; keep this small.

```javascript
// utils.js — ES module

// Generate a Unix timestamp in ms
export function now() { return Date.now(); }

// Format a date for display
export function formatDate(timestamp) { /* ... */ }

// Deep clone a plain object (for immutable updates)
export function clone(obj) { return JSON.parse(JSON.stringify(obj)); }
```

---

## 5. Testing Checklist

- [ ] `normalizeFen` correctly strips halfmove clock and fullmove number
- [ ] `normalizeFen` preserves en passant and castling fields
- [ ] Database opens successfully and creates all 4 stores with correct indexes
- [ ] CRUD operations work for each store
- [ ] `getAllByIndex` returns correct results for each index
- [ ] `getAllByIndexRange` returns records with `nextReviewDate <= now`
- [ ] `byParentMove` unique compound index prevents duplicate edges
- [ ] `clearStore` and `bulkPut` work for import/export scenarios
- [ ] Database persists across page reloads
