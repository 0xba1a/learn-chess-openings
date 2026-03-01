# Design Doc 3: SM2 Spaced Repetition Engine

**Module:** `js/sm2.js`
**Dependencies:** `js/db.js` (Doc 1)
**Parallel with:** Doc 2 (DAG), Doc 4 (Board) — after Doc 1 interfaces are agreed upon

---

## 1. Context

The user practices opening lines via **SM2 spaced repetition**. Each `line` record in IndexedDB carries SM2 scheduling state. Your module implements the SM2 algorithm and provides queries for finding lines that are due for review.

### Architecture Position

```
Pages (practice, manage)
        │
  ──► sm2.js ◄──   ← YOU ARE HERE
        │
      db.js (Doc 1)
        │
    IndexedDB
```

---

## 2. SM2 State Fields (on each `line` record)

These fields are defined in the `lines` store (Doc 1):

| Field | Type | Default | Description |
|-------|------|---------|-------------|
| `easeFactor` | `number` | `2.5` | How easy the line is for the user. Min `1.3`. |
| `interval` | `number` | `0` | Days until next review. |
| `repetitions` | `number` | `0` | Consecutive correct reviews. |
| `nextReviewDate` | `number` | `0` | Unix timestamp (ms) of next scheduled review. `0` = immediately due. |
| `lastReviewDate` | `number \| null` | `null` | Unix timestamp (ms) of last review. |

---

## 3. Quality Scale

| Grade | Meaning | Trigger |
|-------|---------|---------|
| 5 | Perfect — instant recall, no mistakes | All moves correct, no hesitation |
| 4 | Correct with hesitation | All moves correct, but took time |
| 3 | Correct with difficulty | Minor mistakes, self-corrected |
| 2 | Wrong but recognized the right answer | Made errors, recognized correct move when shown |
| 1 | Wrong — vaguely familiar | Failed most moves, slight recognition |
| 0 | Blackout — no recall | Total failure |

---

## 4. Functions to Implement

### 4.1 `sm2Update(item, quality)`

Core SM2 algorithm. Mutates and returns the item.

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

### 4.2 `getDueLines(subtreeFen?, color?)`

Query lines that are due for review.

```
Algorithm:
1. Query `lines` store using `byNextReview` index: nextReviewDate <= Date.now()
2. If subtreeFen is specified, filter to lines whose fens[] includes subtreeFen
3. If color is specified, filter by color
4. Sort by most overdue first (lowest nextReviewDate)
5. Return results
```

**Implementation:** Use `db.getAllByIndexRange("lines", "byNextReview", Date.now())` then filter in JS.

### 4.3 `gradeLine(lineId, quality)`

Apply SM2 update to a line and persist it.

```
Algorithm:
1. line = db.get("lines", lineId)
2. line = sm2Update(line, quality)
3. db.put("lines", line)
```

### 4.4 `autoQuality(totalMoves, correctMoves, hintUsed)`

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

### 4.5 `isLineMastered(line)`

Utility used by the Practice Engine (Doc 5) to check if a line is considered "mastered."

```
function isLineMastered(line):
    return line.repetitions >= 3 AND line.easeFactor >= 2.0
```

---

## 5. Module Interface Summary

```javascript
// sm2.js — ES module
import * as db from './db.js';

export function sm2Update(item, quality) { /* ... */ }
export async function getDueLines(subtreeFen, color) { /* ... */ }
export async function gradeLine(lineId, quality) { /* ... */ }
export function autoQuality(totalMoves, correctMoves, hintUsed) { /* ... */ }
export function isLineMastered(line) { /* ... */ }
```

---

## 6. SM2 Worked Example

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

## 7. Testing Checklist

- [ ] `sm2Update` with quality 5: interval progresses 1 → 6 → `round(6 * EF)`
- [ ] `sm2Update` with quality < 3: resets repetitions to 0, interval to 1
- [ ] `sm2Update` never lets easeFactor drop below 1.3
- [ ] `sm2Update` updates `nextReviewDate` and `lastReviewDate` correctly
- [ ] `getDueLines()` returns lines with `nextReviewDate <= now`, sorted most overdue first
- [ ] `getDueLines(subtreeFen)` filters to lines containing the given FEN
- [ ] `getDueLines(null, "white")` filters by color
- [ ] `gradeLine` persists the updated SM2 state to IndexedDB
- [ ] `autoQuality` returns correct grades for edge cases: 100% with/without hint, 0 moves correct
- [ ] `isLineMastered` returns `true` only when reps ≥ 3 AND EF ≥ 2.0
- [ ] Verify worked example: reproduce the 7-review sequence and confirm every value matches
