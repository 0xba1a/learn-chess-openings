// sm2.js — SM2 Spaced Repetition Engine (ES module)
//
// Implements the SM2 algorithm for scheduling opening line reviews.

import * as db from './db.js';

// ---------------------------------------------------------------------------
// 4.1  sm2Update
// ---------------------------------------------------------------------------

/**
 * Core SM2 algorithm. Mutates and returns the item.
 *
 * @param {Object} item — a line record with SM2 fields
 * @param {number} quality — 0..5 quality grade
 * @returns {Object} the mutated item
 */
export function sm2Update(item, quality) {
  if (quality >= 3) {
    // Correct response
    if (item.repetitions === 0) {
      item.interval = 1;
    } else if (item.repetitions === 1) {
      item.interval = 6;
    } else {
      item.interval = Math.round(item.interval * item.easeFactor);
    }
    item.repetitions += 1;
  } else {
    // Incorrect response — reset
    item.repetitions = 0;
    item.interval = 1;
  }

  // Update ease factor
  item.easeFactor =
    item.easeFactor +
    (0.1 - (5 - quality) * (0.08 + (5 - quality) * 0.02));
  item.easeFactor = Math.max(1.3, item.easeFactor);

  // Schedule next review
  item.nextReviewDate = Date.now() + item.interval * 24 * 60 * 60 * 1000;
  item.lastReviewDate = Date.now();

  return item;
}

// ---------------------------------------------------------------------------
// 4.2  getDueLines
// ---------------------------------------------------------------------------

/**
 * Query lines that are due for review.
 *
 * @param {string} [subtreeFen] — if provided, only lines whose fens[] includes this
 * @param {string} [color] — "white" or "black" filter
 * @returns {Promise<Array>} lines sorted by most overdue first
 */
export async function getDueLines(subtreeFen, color) {
  let lines = await db.getAllByIndexRange(
    'lines',
    'byNextReview',
    Date.now()
  );

  if (subtreeFen) {
    lines = lines.filter((l) => l.fens.includes(subtreeFen));
  }

  if (color) {
    lines = lines.filter((l) => l.color === color);
  }

  // Sort by most overdue first (lowest nextReviewDate)
  lines.sort((a, b) => a.nextReviewDate - b.nextReviewDate);

  return lines;
}

// ---------------------------------------------------------------------------
// 4.3  gradeLine
// ---------------------------------------------------------------------------

/**
 * Apply SM2 update to a line and persist it.
 *
 * @param {number} lineId
 * @param {number} quality — 0..5
 * @returns {Promise<Object>} the updated line record
 */
export async function gradeLine(lineId, quality) {
  let line = await db.get('lines', lineId);
  line = sm2Update(line, quality);
  await db.put('lines', line);
  return line;
}

// ---------------------------------------------------------------------------
// 4.4  autoQuality
// ---------------------------------------------------------------------------

/**
 * Auto-calculate quality from practice session accuracy.
 *
 * @param {number} totalMoves
 * @param {number} correctMoves
 * @param {boolean} hintUsed
 * @returns {number} quality 0..5
 */
export function autoQuality(totalMoves, correctMoves, hintUsed) {
  const accuracy = correctMoves / totalMoves;

  if (accuracy === 1.0 && !hintUsed) return 5;
  if (accuracy === 1.0 && hintUsed) return 4;
  if (accuracy >= 0.8) return 3;
  if (accuracy >= 0.5) return 2;
  if (accuracy >= 0.2) return 1;
  return 0;
}

// ---------------------------------------------------------------------------
// 4.5  isLineMastered
// ---------------------------------------------------------------------------

/**
 * Check if a line is considered "mastered."
 *
 * @param {Object} line — a line record
 * @returns {boolean}
 */
export function isLineMastered(line) {
  return line.repetitions >= 3 && line.easeFactor >= 2.0;
}
