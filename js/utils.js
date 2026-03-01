// utils.js — Shared helpers (ES module)

/**
 * Generate a Unix timestamp in milliseconds.
 * @returns {number}
 */
export function now() {
  return Date.now();
}

/**
 * Format a Unix timestamp (ms) into a human-readable date string.
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string} Formatted date string (e.g., "Mar 1, 2026").
 */
export function formatDate(timestamp) {
  if (!timestamp) return 'Never';
  return new Date(timestamp).toLocaleDateString('en-US', {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
  });
}

/**
 * Format a Unix timestamp (ms) as a relative time string (e.g., "in 3 days", "2 days ago").
 * @param {number} timestamp - Unix timestamp in milliseconds.
 * @returns {string}
 */
export function formatRelativeDate(timestamp) {
  if (!timestamp) return 'never';
  const diffMs = timestamp - Date.now();
  const diffDays = Math.round(diffMs / (24 * 60 * 60 * 1000));
  if (diffDays === 0) return 'today';
  if (diffDays === 1) return 'tomorrow';
  if (diffDays === -1) return 'yesterday';
  if (diffDays > 0) return `in ${diffDays} days`;
  return `${Math.abs(diffDays)} days ago`;
}

/**
 * Deep clone a plain object (for immutable updates).
 * @param {*} obj - A JSON-serializable value.
 * @returns {*} Deep clone.
 */
export function clone(obj) {
  return JSON.parse(JSON.stringify(obj));
}
