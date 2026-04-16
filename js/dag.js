// dag.js — DAG operations module (ES module)
//
// Provides all operations for creating, querying, and deleting
// opening lines in the FEN-keyed directed acyclic graph.

import * as db from './db.js';
import { normalizeFen } from './fen.js';
import { Chess } from '../lib/chess.min.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** Return current timestamp (ms). */
function now() {
  return Date.now();
}

/**
 * Return the opposite color string.
 * @param {"white"|"black"} c
 * @returns {"white"|"black"}
 */
function oppositeColor(c) {
  return c === 'white' ? 'black' : 'white';
}

// ---------------------------------------------------------------------------
// 3.2  getChildren
// ---------------------------------------------------------------------------

/**
 * Return all edges where parentFen === fen.
 * @param {string} fen — normalized FEN
 * @returns {Promise<Array>}
 */
export async function getChildren(fen) {
  return db.getAllByIndex('edges', 'byParent', fen);
}

// ---------------------------------------------------------------------------
// 3.3  _getSubtree  (private)
// ---------------------------------------------------------------------------

/**
 * BFS from `fen`. Returns { nodes, edges, fens (Set) }.
 * @param {string} fen
 * @returns {Promise<{nodes: Array, edges: Array, fens: Set<string>}>}
 */
async function _getSubtree(fen) {
  const queue = [fen];
  const visited = new Set();
  const nodes = [];
  const edges = [];

  while (queue.length > 0) {
    const current = queue.shift();
    if (visited.has(current)) continue;
    visited.add(current);

    const node = await db.get('nodes', current);
    if (node) nodes.push(node);

    const children = await getChildren(current);
    for (const edge of children) {
      edges.push(edge);
      queue.push(edge.childFen);
    }
  }

  return { nodes, edges, fens: visited };
}

// ---------------------------------------------------------------------------
// 3.2 (cont.)  generateLineName
// ---------------------------------------------------------------------------

/**
 * Generate a structured 3-part name for a line.
 *
 * @param {string[]} fens  — ordered FENs of the line (root → leaf)
 * @param {string[]} moves — SAN moves parallel to fens (length = fens.length - 1)
 * @param {"white"|"black"} color — the side the user studies as
 * @param {number} [excludeLineId] — optional lineId to exclude from divergence computation
 * @returns {Promise<{label:string, part1:string, part2:string, part3:string, sourceFen:string}>}
 */
export async function generateLineName(fens, moves, color, excludeLineId) {
  // 1. Collect named nodes in order
  const namedNodes = [];
  for (let i = 0; i < fens.length; i++) {
    const node = await db.get('nodes', fens[i]);
    if (node && node.name) {
      namedNodes.push({ name: node.name, fen: node.fen, index: i });
    }
  }

  // 2. Determine divergence point
  const allLines = await db.getAll('lines');
  const otherFens = new Set();
  for (const line of allLines) {
    if (excludeLineId !== undefined && line.id === excludeLineId) continue;
    for (const f of line.fens) {
      otherFens.add(f);
    }
  }
  const firstUniqueIndex = fens.findIndex((f) => !otherFens.has(f));

  // 3. Build auto-suffix from divergence
  let autoSuffix = '';
  if (firstUniqueIndex >= 1) {
    const moveSan = moves[firstUniqueIndex - 1];
    // Determine active color from the root FEN's active-color field
    const activeColorField = fens[0].split(' ')[1]; // 'w' or 'b'
    const activeColor = activeColorField === 'w' ? 'white' : 'black';
    // The move at index i is made from fens[i], so:
    // if i is even → same side as activeColor, else opposite
    const moveIndex = firstUniqueIndex - 1;
    const sideOfMove =
      moveIndex % 2 === 0 ? activeColor : oppositeColor(activeColor);
    if (sideOfMove === color) {
      autoSuffix = moveSan + ' variation';
    } else {
      autoSuffix = 'respond to ' + moveSan;
    }
  }

  // 4. Assign parts
  let part1, part2, part3, sourceFen;

  if (namedNodes.length >= 3) {
    part1 = namedNodes[0].name;
    part2 = namedNodes[1].name;
    part3 = namedNodes[2].name;
    sourceFen = namedNodes[0].fen;
  } else if (namedNodes.length === 2) {
    part1 = namedNodes[0].name;
    part2 = namedNodes[1].name;
    part3 = autoSuffix || '';
    sourceFen = namedNodes[0].fen;
  } else if (namedNodes.length === 1) {
    part1 = namedNodes[0].name;
    part2 = '';
    part3 = autoSuffix || '';
    sourceFen = namedNodes[0].fen;
  } else {
    // 0 named nodes
    const firstMove = moves[0] || '?';
    part1 = '1.' + firstMove + ' lines';
    part2 = '';
    part3 = autoSuffix || '';
    sourceFen = fens[0];
  }

  // 5. Compose label
  const label = [part1, part2, part3].filter(Boolean).join(' > ');

  return { label, part1, part2, part3, sourceFen };
}

// ---------------------------------------------------------------------------
// 3.1  addLine
// ---------------------------------------------------------------------------

/**
 * Insert a new opening line into the DAG.
 *
 * @param {string} startingFen — full FEN of the start position
 * @param {string[]} moves — SAN moves from startingFen onward
 * @param {"white"|"black"} color — the side the user studies as
 * @param {string[]} reasons — parallel array of reason strings
 * @param {string[]} [tags=[]] — optional array of tag names
 * @returns {Promise<number>} the auto-generated line id
 */
export async function addLine(startingFen, moves, color, reasons, tags = []) {
  // Phase 1 — Walk moves, collect FENs, upsert nodes
  const chess = new Chess(startingFen);
  let previousFen = normalizeFen(startingFen);

  // Upsert root node
  const existingRoot = await db.get('nodes', previousFen);
  if (!existingRoot) {
    await db.put('nodes', {
      fen: previousFen,
      name: null,
      notes: '',
      createdAt: now(),
    });
  }

  const fens = [previousFen];

  // Determine activeColor from startingFen
  const activeColorField = startingFen.split(' ')[1]; // 'w' or 'b'
  const activeColor = activeColorField === 'w' ? 'white' : 'black';

  for (let i = 0; i < moves.length; i++) {
    chess.move(moves[i]);
    const currentFen = normalizeFen(chess.fen());

    // Upsert node
    const existingNode = await db.get('nodes', currentFen);
    if (!existingNode) {
      await db.put('nodes', {
        fen: currentFen,
        name: null,
        notes: '',
        createdAt: now(),
      });
    }

    fens.push(currentFen);
    previousFen = currentFen;
  }

  // Phase 2 — Compute line name
  const { label, part1, part2, part3, sourceFen } = await generateLineName(
    fens,
    moves,
    color
  );

  // Phase 3 — Upsert edges with tagged reasons
  for (let i = 0; i < moves.length; i++) {
    const parentFen = fens[i];
    const childFen = fens[i + 1];
    const sideToMove =
      i % 2 === 0 ? activeColor : oppositeColor(activeColor);

    // Check for existing edge
    const existing = await db.getAllByIndex('edges', 'byParentMove', [
      parentFen,
      moves[i],
    ]);

    if (existing.length > 0) {
      const edge = existing[0];
      if (!edge.reasons) edge.reasons = {};
      if (reasons[i]) {
        edge.reasons[label] = reasons[i];
      }
      await db.put('edges', edge);
    } else {
      const reasonsMap = {};
      if (reasons[i]) {
        reasonsMap[label] = reasons[i];
      }
      await db.add('edges', {
        parentFen,
        childFen,
        moveSan: moves[i],
        moveUci: '',
        color: sideToMove,
        reasons: reasonsMap,
        createdAt: now(),
      });
    }
  }

  // Phase 4 — Create line record
  const lineRecord = {
    label,
    color,
    rootFen: fens[0],
    leafFen: fens[fens.length - 1],
    fens,
    moves,
    tags: Array.isArray(tags) ? tags : (tags ? [tags] : []),
    easeFactor: 2.5,
    interval: 0,
    repetitions: 0,
    nextReviewDate: 0,
    lastReviewDate: null,
    createdAt: now(),
  };
  const lineId = await db.add('lines', lineRecord);

  // Phase 5 — Create names record
  await db.add('names', {
    lineId,
    part1,
    part2,
    part3,
    rootFen: fens[0],
    leafFen: fens[fens.length - 1],
    sourceFen,
    createdAt: now(),
  });

  return lineId;
}

// ---------------------------------------------------------------------------
// 3.4  getFullName
// ---------------------------------------------------------------------------

/**
 * Walk up the DAG to build the full hierarchical name.
 * Named nodes contribute their name; unnamed nodes contribute
 * the moveSan of the edge leading to them.
 *
 * @param {string} fen — normalized FEN
 * @returns {Promise<string>}
 */
export async function getFullName(fen) {
  const segments = [];
  let current = fen;

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const parentEdges = await db.getAllByIndex('edges', 'byChild', current);

    if (parentEdges.length === 0) {
      // Root node — check if it has a name
      const rootNode = await db.get('nodes', current);
      if (rootNode && rootNode.name) {
        segments.unshift(rootNode.name);
      }
      break;
    }

    // Pick parent edge with earliest createdAt (primary line)
    const parentEdge = parentEdges.reduce((earliest, e) =>
      e.createdAt < earliest.createdAt ? e : earliest
    );

    const node = await db.get('nodes', current);
    if (node && node.name) {
      segments.unshift(node.name);
    } else {
      segments.unshift(parentEdge.moveSan);
    }

    current = parentEdge.parentFen;
  }

  return segments.join(' > ');
}

// ---------------------------------------------------------------------------
// 3.5  getRoots
// ---------------------------------------------------------------------------

/**
 * Return all nodes with no incoming edges.
 * @returns {Promise<Array>}
 */
export async function getRoots() {
  const allNodes = await db.getAll('nodes');
  const roots = [];

  for (const node of allNodes) {
    const incoming = await db.getAllByIndex('edges', 'byChild', node.fen);
    if (incoming.length === 0) {
      roots.push(node);
    }
  }

  return roots;
}

// ---------------------------------------------------------------------------
// 3.6  getLinesByName
// ---------------------------------------------------------------------------

/**
 * Query lines by structured name parts (progressive filtering).
 *
 * @param {string} part1
 * @param {string} [part2]
 * @param {string} [part3]
 * @returns {Promise<Array>}
 */
export async function getLinesByName(part1, part2, part3) {
  let records;

  if (part3 !== undefined && part2 !== undefined) {
    records = await db.getAllByIndex('names', 'byPart1Part2Part3', [
      part1,
      part2,
      part3,
    ]);
  } else if (part2 !== undefined) {
    records = await db.getAllByIndex('names', 'byPart1Part2', [part1, part2]);
  } else {
    records = await db.getAllByIndex('names', 'byPart1', part1);
  }

  const lineIds = records.map((r) => r.lineId);
  return Promise.all(lineIds.map((id) => db.get('lines', id)));
}

// ---------------------------------------------------------------------------
// 3.7  getDistinctNames
// ---------------------------------------------------------------------------

/**
 * Return distinct values for the next dropdown level.
 *
 * @param {string} [part1]
 * @param {string} [part2]
 * @returns {Promise<string[]>}
 */
export async function getDistinctNames(part1, part2) {
  if (part1 === undefined) {
    const all = await db.getAll('names');
    return [...new Set(all.map((r) => r.part1))].sort();
  }

  if (part2 === undefined) {
    const records = await db.getAllByIndex('names', 'byPart1', part1);
    return [
      ...new Set(records.map((r) => r.part2).filter(Boolean)),
    ].sort();
  }

  const records = await db.getAllByIndex('names', 'byPart1Part2', [
    part1,
    part2,
  ]);
  return [
    ...new Set(records.map((r) => r.part3).filter(Boolean)),
  ].sort();
}

// ---------------------------------------------------------------------------
// 3.8  renameNode
// ---------------------------------------------------------------------------

/**
 * Rename a node and cascade changes to all affected name records
 * and line labels.
 *
 * @param {string} fen — normalized FEN of the node to rename
 * @param {string} newName — the new name (or empty string to clear)
 * @returns {Promise<void>}
 */
export async function renameNode(fen, newName) {
  // 1-4. Update the node
  const node = await db.get('nodes', fen);
  node.name = newName || null;
  await db.put('nodes', node);

  // 5. Find all lines that pass through this FEN
  const allLines = await db.getAll('lines');
  const affectedLines = allLines.filter((line) => line.fens.includes(fen));

  // 6. Cascade changes
  for (const line of affectedLines) {
    const oldLabel = line.label;

    // Recompute name
    const { label, part1, part2, part3, sourceFen } = await generateLineName(
      line.fens,
      line.moves,
      line.color,
      line.id
    );

    // Update edge reason keys if label changed
    if (label !== oldLabel) {
      for (let i = 0; i < line.moves.length; i++) {
        const edgeResults = await db.getAllByIndex('edges', 'byParentMove', [
          line.fens[i],
          line.moves[i],
        ]);
        if (edgeResults.length > 0) {
          const edge = edgeResults[0];
          if (edge.reasons && edge.reasons[oldLabel] !== undefined) {
            edge.reasons[label] = edge.reasons[oldLabel];
            delete edge.reasons[oldLabel];
            await db.put('edges', edge);
          }
        }
      }

      // Update line label
      line.label = label;
      await db.put('lines', line);
    }

    // Update names record
    const nameRecs = await db.getAllByIndex('names', 'byLineId', line.id);
    if (nameRecs.length > 0) {
      const nameRec = nameRecs[0];
      nameRec.part1 = part1;
      nameRec.part2 = part2;
      nameRec.part3 = part3;
      nameRec.sourceFen = sourceFen;
      await db.put('names', nameRec);
    }
  }
}

// ---------------------------------------------------------------------------
// 3.9  getLinesBySubtree
// ---------------------------------------------------------------------------

/**
 * Return all lines records that overlap with the subtree rooted at fen.
 * A line is included if any of its fens[] entries fall within the subtree.
 *
 * @param {string} fen
 * @returns {Promise<Array>}
 */
export async function getLinesBySubtree(fen) {
  const subtree = await _getSubtree(fen);
  const reachableFens = subtree.fens;
  const allLines = await db.getAll('lines');
  return allLines.filter((line) => line.fens.some((f) => reachableFens.has(f)));
}

// ---------------------------------------------------------------------------
// 3.10  getLinesFromNode
// ---------------------------------------------------------------------------

/**
 * Like getLinesBySubtree, but excludes lines whose ONLY intersection
 * with the subtree is their leafFen.
 *
 * @param {string} fen
 * @returns {Promise<Array>}
 */
export async function getLinesFromNode(fen) {
  const subtree = await _getSubtree(fen);
  const reachableFens = subtree.fens;
  const allLines = await db.getAll('lines');

  return allLines.filter((line) => {
    const overlapping = line.fens.filter((f) => reachableFens.has(f));
    if (overlapping.length === 0) return false;
    // Exclude if the only overlap is at the leaf
    if (
      overlapping.length === 1 &&
      overlapping[0] === line.fens[line.fens.length - 1]
    ) {
      return false;
    }
    return true;
  });
}

// ---------------------------------------------------------------------------
// 3.11  deleteLine
// ---------------------------------------------------------------------------

/**
 * Delete a line, its name record, clean up tagged reasons,
 * and garbage-collect orphaned nodes/edges.
 *
 * @param {number} lineId
 * @returns {Promise<void>}
 */
export async function deleteLine(lineId) {
  // 1. Read the line record
  const line = await db.get('lines', lineId);
  if (!line) return;

  const { label, fens, moves } = line;

  // 2. Delete the line record
  await db.del('lines', lineId);

  // 3. Delete the names record
  const nameRecs = await db.getAllByIndex('names', 'byLineId', lineId);
  if (nameRecs.length > 0) {
    await db.del('names', nameRecs[0].id);
  }

  // 4. Clean up edges
  for (let i = 0; i < moves.length; i++) {
    const parentFen = fens[i];
    const edgeResults = await db.getAllByIndex('edges', 'byParentMove', [
      parentFen,
      moves[i],
    ]);
    if (edgeResults.length === 0) continue;

    const edge = edgeResults[0];

    // Check if any other line still traverses this edge
    const remainingLines = await db.getAll('lines');
    const edgeStillUsed = remainingLines.some(
      (rl) =>
        rl.fens.includes(parentFen) &&
        rl.fens.includes(edge.childFen) &&
        rl.moves.some(
          (m, idx) => m === moves[i] && rl.fens[idx] === parentFen
        )
    );

    if (edgeStillUsed) {
      // Remove deleted line's reason entry
      if (edge.reasons && edge.reasons[label] !== undefined) {
        delete edge.reasons[label];
        await db.put('edges', edge);
      }
    } else {
      // No other line uses this edge — delete it
      await db.del('edges', edge.id);
    }
  }

  // 5. Garbage-collect orphaned nodes
  const remainingLines = await db.getAll('lines');
  const allEdges = await db.getAll('edges');
  const usedFens = new Set();

  for (const rl of remainingLines) {
    for (const f of rl.fens) usedFens.add(f);
  }
  for (const e of allEdges) {
    usedFens.add(e.parentFen);
    usedFens.add(e.childFen);
  }

  for (const f of fens) {
    if (!usedFens.has(f)) {
      await db.del('nodes', f);
    }
  }
}

// ---------------------------------------------------------------------------
// 3.12  deleteSubtree
// ---------------------------------------------------------------------------

/**
 * Delete all lines passing through fen, then clean up orphaned
 * nodes and edges in the subtree that are no longer referenced
 * by any surviving line.
 *
 * @param {string} fen
 * @returns {Promise<void>}
 */
export async function deleteSubtree(fen) {
  // 1. Delete only lines that pass through the clicked node itself
  const allLines = await db.getAll('lines');
  for (const line of allLines) {
    if (line.fens.includes(fen)) {
      const nameRecs = await db.getAllByIndex('names', 'byLineId', line.id);
      if (nameRecs.length > 0) {
        await db.del('names', nameRecs[0].id);
      }
      await db.del('lines', line.id);
    }
  }

  // 2. Collect FENs still referenced by surviving lines
  const remainingLines = await db.getAll('lines');
  const liveFens = new Set();
  for (const line of remainingLines) {
    for (const f of line.fens) liveFens.add(f);
  }

  // 3. Walk the subtree from fen; delete orphaned nodes and edges
  const subtree = await _getSubtree(fen);

  for (const edge of subtree.edges) {
    if (!liveFens.has(edge.parentFen) || !liveFens.has(edge.childFen)) {
      await db.del('edges', edge.id);
    }
  }

  for (const node of subtree.nodes) {
    if (!liveFens.has(node.fen)) {
      await db.del('nodes', node.fen);
    }
  }

  // 4. Delete incoming edges to the subtree root if it was removed
  if (!liveFens.has(fen)) {
    const incoming = await db.getAllByIndex('edges', 'byChild', fen);
    for (const edge of incoming) {
      await db.del('edges', edge.id);
    }
  }
}
