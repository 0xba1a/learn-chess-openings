// fen.js — FEN normalization utility (ES module)

/**
 * Normalize a FEN string by stripping the halfmove clock and fullmove number.
 *
 * Chess FEN has six space-separated fields:
 *   <pieces> <active-color> <castling> <en-passant> <halfmove-clock> <fullmove-number>
 *
 * The last two fields are irrelevant for position identity — the same position
 * can be reached at different move numbers. Normalized FEN keeps only the first
 * four fields.
 *
 * @param {string} fen - A full or already-normalized FEN string.
 * @returns {string} Normalized FEN (first 4 fields only).
 *
 * @example
 * normalizeFen("rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3 0 1")
 * // → "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq e3"
 */
export function normalizeFen(fen) {
  const parts = fen.split(' ');
  return parts.slice(0, 4).join(' ');
}
